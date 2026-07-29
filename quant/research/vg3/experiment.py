"""Sealed public-only V-G3 Spot volume-shock mean-reversion experiment.

The module has five explicit lifecycle commands:

``discover`` -> ``freeze`` -> ``acquire`` -> ``run`` -> ``verify``.

Raw archives, complete manifests, and one-use markers stay outside Git.  The
tracked result is deliberately compact and binds the full external evidence by
digest.  Evaluation never calls a private endpoint, places an order, or imports
production strategy code.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import os
import platform
import random
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from array import array
from collections.abc import Iterable, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from datetime import time as daytime
from decimal import ROUND_HALF_EVEN, Decimal, getcontext
from fractions import Fraction
from pathlib import Path
from threading import Lock
from typing import Any, Final, cast
from xml.etree import ElementTree

getcontext().prec = 50

HERE: Final = Path(__file__).resolve().parent
QUANT_ROOT: Final = HERE.parents[1]
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
SOURCE_RECEIPTS_PATH: Final = HERE / "source-receipts.v1.json"
README_PATH: Final = HERE / "README.md"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
SHA256SUMS_PATH: Final = HERE / "SHA256SUMS"
SCRIPT_PATH: Final = HERE / "experiment.py"
TEST_PATH: Final = HERE / "test_experiment.py"
PYPROJECT_PATH: Final = QUANT_ROOT / "pyproject.toml"
UV_LOCK_PATH: Final = QUANT_ROOT / "uv.lock"

BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
PROTOCOL_SHA256: Final = "107d0c734f5ae622ae756aa7c9cf2650fdc2118f7f718fd0d3ee65678c6e8117"
DEFAULT_STATE_ROOT: Final = Path(
    "/Users/cosmosgeek/.codex/evidence/cosmos-vg3-public-volume-v1-4ddd-r5"
)
DATA_ORIGIN: Final = "https://data.binance.vision"
LISTING_ORIGIN: Final = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
PUBLIC_DATA_COMMIT: Final = "5c7f3197591c0d54d85dc43066226bc4c671d47a"
SPOT_DOCS_COMMIT: Final = "6b8372cad7cecbdf5dd88a3372eafff51988c5cf"
FEE_SOURCE_URL: Final = "https://www.binance.com/en/fee/trading"
FEE_RENDERED_ROW: Final = (
    "Regular User | < 1,000,000 USD | or | ≥ 0 BNB | "
    "0.100% / 0.100% | 0.07500% / 0.07500% | "
    "Standard /0.095% | Standard /0.07125%"
)
PINNED_SOURCE_SPECS: Final = (
    (
        "BINANCE_PUBLIC_DATA_README",
        (
            "https://raw.githubusercontent.com/binance/binance-public-data/"
            f"{PUBLIC_DATA_COMMIT}/README.md"
        ),
        PUBLIC_DATA_COMMIT,
    ),
    (
        "BINANCE_MARKET_DATA_ONLY",
        (
            "https://raw.githubusercontent.com/binance/binance-spot-api-docs/"
            f"{SPOT_DOCS_COMMIT}/faqs/market_data_only.md"
        ),
        SPOT_DOCS_COMMIT,
    ),
    (
        "BINANCE_SPOT_REST_API",
        (
            "https://raw.githubusercontent.com/binance/binance-spot-api-docs/"
            f"{SPOT_DOCS_COMMIT}/rest-api.md"
        ),
        SPOT_DOCS_COMMIT,
    ),
    (
        "BINANCE_SPOT_FILTERS",
        (
            "https://raw.githubusercontent.com/binance/binance-spot-api-docs/"
            f"{SPOT_DOCS_COMMIT}/filters.md"
        ),
        SPOT_DOCS_COMMIT,
    ),
    (
        "BINANCE_COMMISSION_FAQ",
        (
            "https://raw.githubusercontent.com/binance/binance-spot-api-docs/"
            f"{SPOT_DOCS_COMMIT}/faqs/commission_faq.md"
        ),
        SPOT_DOCS_COMMIT,
    ),
)
ALLOWED_HOSTS: Final = frozenset(
    {
        "data.binance.vision",
        "raw.githubusercontent.com",
        "s3-ap-northeast-1.amazonaws.com",
    }
)
USER_AGENT: Final = "cosmos-vg3-public-research/1.0"
MAX_HTTP_BYTES: Final = 64 * 1024 * 1024
MAX_SIDECAR_BYTES: Final = 4 * 1024
DOWNLOAD_WORKERS: Final = 8
MAX_FORMATION_COMPRESSED_BYTES: Final = 512 * 1024 * 1024
MAX_DEVELOPMENT_COMPRESSED_BYTES: Final = 4 * 1024 * 1024 * 1024
MAX_HOLDOUT_COMPRESSED_BYTES: Final = 4 * 1024 * 1024 * 1024
MAX_ARCHIVE_RECORDS: Final = 4_000
MAX_DISCOVERY_PAGES: Final = 16
MAX_DISCOVERY_PREFIXES: Final = 10_000
MAX_DISCOVERY_XML_BYTES: Final = 128 * 1024 * 1024
BOOTSTRAP_SEEDS: Final = {
    "developmentPrimary7Day": 2026072903,
    "developmentSensitivity14Day": 2026072914,
    "holdoutPrimary7Day": 2026072923,
    "holdoutSensitivity14Day": 2026072934,
}
STAT_SCALE: Final = 10**12
STAT_QUANTUM: Final = Decimal(1) / Decimal(STAT_SCALE)
MONEY_QUANTUM: Final = Decimal("0.000001")
RATE_QUANTUM: Final = Decimal("0.000000000001")
FEE_BPS_DENOMINATOR: Final = Decimal(10_000)
CHECKSUM_RE: Final = re.compile(r"^([0-9a-f]{64})\s+\*?(\S+)\s*$")
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")

STABLE_OR_FIAT_BASES: Final = frozenset(
    {
        "AEUR",
        "AUD",
        "BFUSD",
        "BKRW",
        "BUSD",
        "DAI",
        "EURI",
        "EUR",
        "FDUSD",
        "FRAX",
        "GBP",
        "PAX",
        "RLUSD",
        "SUSD",
        "TUSD",
        "USD1",
        "USDC",
        "USDE",
        "USDP",
        "USDS",
        "USDSOLD",
        "UST",
        "USTC",
        "XUSD",
    }
)


class EvidenceError(RuntimeError):
    """Fail-closed evidence or protocol violation."""


class ArchiveMissing(EvidenceError):
    """An official archive or its sidecar returned HTTP 404."""


def state_root() -> Path:
    """Return the external state root, never a Git path."""

    configured = os.environ.get("VG3_STATE_ROOT")
    root = DEFAULT_STATE_ROOT if configured is None else Path(configured)
    if root.is_symlink():
        raise EvidenceError("VG3_STATE_ROOT itself may not be a symlink")
    resolved = root.resolve()
    if HERE in resolved.parents or resolved == HERE:
        raise EvidenceError("VG3_STATE_ROOT must be outside the Git research directory")
    if not resolved.is_absolute():
        raise EvidenceError("VG3_STATE_ROOT must resolve to an absolute path")
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            raise EvidenceError("VG3_STATE_ROOT may not be inside any Git repository")
    return resolved


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _guard_external_path(path: Path, *, create_parent: bool = False) -> None:
    """Reject descendant symlinks for paths inside the configured evidence root."""

    root = state_root()
    absolute = path.absolute()
    try:
        relative = absolute.relative_to(root)
    except ValueError:
        return
    if not relative.parts:
        raise EvidenceError("external evidence operation requires a child path")
    if create_parent:
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not root.exists() or root.is_symlink() or not root.is_dir():
        raise EvidenceError("external evidence root is missing, linked, or not a directory")
    current = root
    for part in relative.parts[:-1]:
        if part in {"", ".", ".."}:
            raise EvidenceError("external evidence path contains unsafe traversal")
        current = current / part
        if os.path.lexists(current):
            if current.is_symlink() or not current.is_dir():
                raise EvidenceError(f"external evidence parent is unsafe: {current}")
        elif create_parent:
            with suppress(FileExistsError):
                current.mkdir(mode=0o700)
            if current.is_symlink() or not current.is_dir():
                raise EvidenceError(f"external evidence parent is unsafe: {current}")
        else:
            raise EvidenceError(f"external evidence parent is missing: {current}")
    if os.path.lexists(absolute) and absolute.is_symlink():
        raise EvidenceError(f"external evidence file may not be a symlink: {absolute}")
    resolved_parent = absolute.parent.resolve()
    if resolved_parent != root and root not in resolved_parent.parents:
        raise EvidenceError("external evidence descendant escaped configured root")


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sha256_file(path: Path) -> str:
    _guard_external_path(path)
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _reject_float(value: object, path: str = "$") -> None:
    if isinstance(value, float):
        raise EvidenceError(f"floating JSON value forbidden at {path}")
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _reject_float(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            _reject_float(item, f"{path}.{key}")


def canonical_json_bytes(value: object) -> bytes:
    _reject_float(value)
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        + b"\n"
    )


def load_json(path: Path) -> dict[str, Any]:
    _guard_external_path(path)
    loaded = cast(object, json.loads(path.read_text(encoding="utf-8")))
    if not isinstance(loaded, dict) or any(not isinstance(key, str) for key in loaded):
        raise EvidenceError(f"{path.name} must contain a JSON object")
    _reject_float(loaded)
    return cast(dict[str, Any], loaded)


def atomic_write(path: Path, payload: bytes) -> None:
    _guard_external_path(path, create_parent=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def exclusive_write(path: Path, payload: bytes) -> None:
    _guard_external_path(path, create_parent=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def utc_now_text() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def git_output(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", "-C", str(HERE), *arguments),
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def git_blob_at_head(path: str) -> bytes:
    completed = subprocess.run(
        ("git", "-C", str(HERE), "show", f"HEAD:{path}"),
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise EvidenceError(f"required frozen Git blob is absent from HEAD: {path}")
    return completed.stdout


def protocol() -> dict[str, Any]:
    if sha256_file(PROTOCOL_PATH) != PROTOCOL_SHA256:
        raise EvidenceError("protocol bytes drifted from evaluator contract")
    value = load_json(PROTOCOL_PATH)
    if value.get("schema") != "VG3SpotVolumeShockMeanReversionProtocolV1":
        raise EvidenceError("protocol schema mismatch")
    if value.get("canonicalBaseCommit") != BASE_COMMIT:
        raise EvidenceError("protocol base commit mismatch")
    trials = require_mapping(value.get("trials"), "trials")
    if trials.get("attemptedCount") != 12:
        raise EvidenceError("protocol must freeze exactly twelve local attempts")
    universe = require_mapping(value.get("universe"), "universe")
    exclusions = universe.get("stableOrFiatBaseExclusions")
    if exclusions != sorted(STABLE_OR_FIAT_BASES):
        raise EvidenceError("protocol stable/fiat exclusions drifted from evaluator")
    return value


def require_mapping(value: object, field: str) -> Mapping[str, Any]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise EvidenceError(f"{field} must be an object")
    return cast(Mapping[str, Any], value)


def require_list(value: object, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise EvidenceError(f"{field} must be a list")
    return value


def require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field} must be non-empty text")
    return value


def require_int(value: object, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise EvidenceError(f"{field} must be an integer")
    return value


def require_exact_keys(
    value: Mapping[str, Any],
    expected: set[str],
    field: str,
) -> None:
    actual = set(value)
    if actual != expected:
        raise EvidenceError(
            f"{field} key set mismatch: missing={sorted(expected - actual)} "
            f"extra={sorted(actual - expected)}"
        )


def _validate_response_origin(response: Any, requested_url: str) -> None:
    final_url = str(response.geturl())
    parsed = urllib.parse.urlparse(final_url)
    if (
        final_url != requested_url
        or parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_HOSTS
    ):
        raise EvidenceError(
            "official fetch final URL differs from pinned request: "
            f"requested={requested_url} final={final_url}"
        )


def _http_bytes(url: str, *, maximum_bytes: int, retries: int = 4) -> tuple[bytes, str | None]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise EvidenceError(f"non-official URL rejected: {url}")
    request = urllib.request.Request(
        url,
        headers={"Accept": "*/*", "User-Agent": USER_AGENT},
        method="GET",
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                _validate_response_origin(response, url)
                payload = response.read(maximum_bytes + 1)
                if len(payload) > maximum_bytes:
                    raise EvidenceError(f"official response exceeded byte bound: {url}")
                return payload, response.headers.get("Last-Modified")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise ArchiveMissing(url) from error
            if error.code not in {429, 500, 502, 503, 504} or attempt + 1 == retries:
                raise EvidenceError(f"official HTTP {error.code}: {url}") from error
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt
            time.sleep(min(delay, 20))
        except (TimeoutError, urllib.error.URLError) as error:
            if attempt + 1 == retries:
                raise EvidenceError(f"official fetch failed: {url}: {error}") from error
            time.sleep(2**attempt)
    raise AssertionError("unreachable retry loop")


@dataclass(slots=True)
class _CompressedByteBudget:
    maximum_bytes: int
    consumed_bytes: int = 0
    _lock: Lock = field(default_factory=Lock, repr=False)

    def reserve(self, amount: int) -> None:
        if amount < 0:
            raise EvidenceError("compressed-byte reservation may not be negative")
        with self._lock:
            if self.consumed_bytes + amount > self.maximum_bytes:
                raise EvidenceError(
                    "partition compressed-byte budget exceeded: "
                    f"{self.consumed_bytes + amount}>{self.maximum_bytes}"
                )
            self.consumed_bytes += amount

    def release(self, amount: int) -> None:
        with self._lock:
            self.consumed_bytes -= amount
            if self.consumed_bytes < 0:
                raise AssertionError("compressed-byte budget underflow")


def _http_stream_to_path(
    url: str,
    destination: Path,
    *,
    expected_sha256: str,
    budget: _CompressedByteBudget,
    retries: int = 4,
) -> str | None:
    """Stream one official archive to disk under checksum and byte bounds."""

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise EvidenceError(f"non-official URL rejected: {url}")
    request = urllib.request.Request(
        url,
        headers={"Accept": "*/*", "User-Agent": USER_AGENT},
        method="GET",
    )
    _guard_external_path(destination, create_parent=True)
    for attempt in range(retries):
        transferred = 0
        temporary: Path | None = None
        committed = False
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                _validate_response_origin(response, url)
                descriptor, temporary_name = tempfile.mkstemp(
                    prefix=f".{destination.name}.",
                    dir=destination.parent,
                )
                temporary = Path(temporary_name)
                digest = hashlib.sha256()
                with os.fdopen(descriptor, "wb") as handle:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        if transferred + len(chunk) > MAX_HTTP_BYTES:
                            raise EvidenceError(f"official archive exceeded byte bound: {url}")
                        budget.reserve(len(chunk))
                        transferred += len(chunk)
                        digest.update(chunk)
                        handle.write(chunk)
                    handle.flush()
                    os.fsync(handle.fileno())
                if digest.hexdigest() != expected_sha256:
                    raise EvidenceError(f"downloaded ZIP checksum mismatch: {url}")
                os.replace(temporary, destination)
                committed = True
                last_modified = response.headers.get("Last-Modified")
                return None if last_modified is None else str(last_modified)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise ArchiveMissing(url) from error
            if error.code not in {429, 500, 502, 503, 504} or attempt + 1 == retries:
                raise EvidenceError(f"official HTTP {error.code}: {url}") from error
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt
            time.sleep(min(delay, 20))
        except (TimeoutError, urllib.error.URLError) as error:
            if attempt + 1 == retries:
                raise EvidenceError(f"official fetch failed: {url}: {error}") from error
            time.sleep(2**attempt)
        finally:
            if not committed and transferred:
                budget.release(transferred)
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    raise AssertionError("unreachable retry loop")


def collect_source_receipts() -> dict[str, object]:
    entries: list[dict[str, object]] = []
    source_dir = state_root() / "official-source-pages"
    for source_id, url, commit in PINNED_SOURCE_SPECS:
        payload, _ = _http_bytes(url, maximum_bytes=2 * 1024 * 1024)
        local_name = f"{source_id.lower()}.md"
        atomic_write(source_dir / local_name, payload)
        entries.append(
            {
                "byteLength": len(payload),
                "commit": commit,
                "contentSha256": sha256_bytes(payload),
                "externalLocalName": local_name,
                "sourceId": source_id,
                "url": url,
            }
        )
    fee_payload = FEE_RENDERED_ROW.encode("utf-8")
    entries.append(
        {
            "byteLength": len(fee_payload),
            "contentSha256": sha256_bytes(fee_payload),
            "evidenceClass": "MANUAL_ATTESTATION_NOT_PUBLISHER_BYTES",
            "exactRenderedRow": FEE_RENDERED_ROW,
            "rawResponseStatus": "UNAVAILABLE_ANTI_BOT_EMPTY",
            "renderedSourceLine": 41,
            "retrievalTransport": "MANUAL_TRANSCRIPTION_FROM_OPENAI_WEB_READER",
            "sourceId": "BINANCE_REGULAR_USER_SPOT_FEE_MANUAL_ATTESTATION",
            "url": FEE_SOURCE_URL,
        }
    )
    receipt: dict[str, object] = {
        "schema": "VG3OfficialSourceReceiptsV1",
        "retrievedForDateUtc": "2026-07-29",
        "sources": entries,
    }
    payload = canonical_json_bytes(receipt)
    if SOURCE_RECEIPTS_PATH.exists():
        if SOURCE_RECEIPTS_PATH.read_bytes() != payload:
            raise EvidenceError("tracked official-source receipt differs from pinned sources")
    else:
        exclusive_write(SOURCE_RECEIPTS_PATH, payload)
    external = state_root() / "source-receipts.v1.json"
    if external.exists():
        if external.read_bytes() != payload:
            raise EvidenceError("external official-source receipt differs from pinned sources")
    else:
        exclusive_write(external, payload)
    return receipt


def validate_source_receipts() -> dict[str, Any]:
    external = state_root() / "source-receipts.v1.json"
    if not SOURCE_RECEIPTS_PATH.exists() or not external.exists():
        raise EvidenceError("tracked and external official-source receipts are required")
    _guard_external_path(external)
    if SOURCE_RECEIPTS_PATH.read_bytes() != external.read_bytes():
        raise EvidenceError("tracked and external official-source receipts differ")
    receipt = load_json(SOURCE_RECEIPTS_PATH)
    if SOURCE_RECEIPTS_PATH.read_bytes() != canonical_json_bytes(receipt):
        raise EvidenceError("official-source receipt is not canonical JSON")
    require_exact_keys(
        receipt,
        {"retrievedForDateUtc", "schema", "sources"},
        "sourceReceipts",
    )
    if receipt.get("schema") != "VG3OfficialSourceReceiptsV1":
        raise EvidenceError("official-source receipt schema mismatch")
    if receipt.get("retrievedForDateUtc") != "2026-07-29":
        raise EvidenceError("official-source receipt date drifted")
    sources = require_list(receipt.get("sources"), "sourceReceipts.sources")
    if len(sources) != 6:
        raise EvidenceError("official-source receipt count mismatch")
    source_dir = state_root() / "official-source-pages"
    expected_sources = {
        source_id: {
            "commit": commit,
            "externalLocalName": f"{source_id.lower()}.md",
            "url": url,
        }
        for source_id, url, commit in PINNED_SOURCE_SPECS
    }
    seen: set[str] = set()
    for raw_source in sources:
        source = require_mapping(raw_source, "sourceReceipts.sources[]")
        source_id = require_text(source.get("sourceId"), "sourceId")
        if source_id in seen:
            raise EvidenceError("duplicate official source receipt")
        seen.add(source_id)
        expected_digest = require_text(source.get("contentSha256"), "contentSha256")
        expected_length = require_int(source.get("byteLength"), "byteLength")
        local_name = source.get("externalLocalName")
        if isinstance(local_name, str):
            expected_identity = expected_sources.get(source_id)
            if expected_identity is None:
                raise EvidenceError(f"unexpected pinned official source: {source_id}")
            for key, value in expected_identity.items():
                if source.get(key) != value:
                    raise EvidenceError(f"pinned official source identity drifted: {source_id}")
            local_path = source_dir / local_name
            if (
                not local_path.exists()
                or local_path.stat().st_size != expected_length
                or sha256_file(local_path) != expected_digest
            ):
                raise EvidenceError(f"pinned official source bytes drifted: {source_id}")
        else:
            require_exact_keys(
                source,
                {
                    "byteLength",
                    "contentSha256",
                    "evidenceClass",
                    "exactRenderedRow",
                    "rawResponseStatus",
                    "renderedSourceLine",
                    "retrievalTransport",
                    "sourceId",
                    "url",
                },
                "sourceReceipts.manualFeeAttestation",
            )
            if (
                source_id != "BINANCE_REGULAR_USER_SPOT_FEE_MANUAL_ATTESTATION"
                or source.get("url") != FEE_SOURCE_URL
                or source.get("evidenceClass") != "MANUAL_ATTESTATION_NOT_PUBLISHER_BYTES"
                or source.get("rawResponseStatus") != "UNAVAILABLE_ANTI_BOT_EMPTY"
                or source.get("renderedSourceLine") != 41
                or source.get("retrievalTransport") != "MANUAL_TRANSCRIPTION_FROM_OPENAI_WEB_READER"
            ):
                raise EvidenceError("frozen manual fee attestation identity drifted")
            rendered = require_text(source.get("exactRenderedRow"), "exactRenderedRow")
            if (
                rendered != FEE_RENDERED_ROW
                or len(rendered.encode("utf-8")) != expected_length
                or sha256_bytes(rendered.encode("utf-8")) != expected_digest
            ):
                raise EvidenceError("frozen rendered fee row drifted")
    if seen != {*expected_sources, "BINANCE_REGULAR_USER_SPOT_FEE_MANUAL_ATTESTATION"}:
        raise EvidenceError("official-source receipt identifiers drifted")
    return receipt


def _xml_text(root: ElementTree.Element, name: str) -> str | None:
    node = root.find(f"{{*}}{name}")
    return None if node is None else node.text


def _classify_prefixes(
    sorted_prefixes: Sequence[str],
) -> tuple[list[dict[str, str]], list[str]]:
    symbols = [
        prefix.removeprefix("data/spot/monthly/klines/").removesuffix("/")
        for prefix in sorted_prefixes
    ]
    leveraged = leveraged_symbols(
        tuple(symbol for symbol in symbols if SYMBOL_RE.fullmatch(symbol))
    )
    classifications: list[dict[str, str]] = []
    eligible: list[str] = []
    for symbol in symbols:
        if not SYMBOL_RE.fullmatch(symbol):
            reason = "SYMBOL_PATTERN_INELIGIBLE"
        elif symbol[:-4] in STABLE_OR_FIAT_BASES:
            reason = "STABLE_OR_FIAT_BASE_INELIGIBLE"
        elif symbol in leveraged:
            reason = "PAIRED_LEVERAGED_TOKEN_INELIGIBLE"
        else:
            reason = "FORMATION_ELIGIBLE"
            eligible.append(symbol)
        classifications.append({"classification": reason, "symbol": symbol})
    return classifications, eligible


def validate_discovery_receipt() -> dict[str, Any]:
    validate_source_receipts()
    discovery_path = state_root() / "discovery.v1.json"
    if not discovery_path.exists():
        raise EvidenceError("archive discovery receipt is missing")
    discovery = load_json(discovery_path)
    if discovery_path.read_bytes() != canonical_json_bytes(discovery):
        raise EvidenceError("archive discovery receipt is not canonical JSON")
    if discovery.get("schema") != "VG3ArchiveDiscoveryV1":
        raise EvidenceError("archive discovery schema mismatch")
    page_count = require_int(discovery.get("pageCount"), "discovery.pageCount")
    pages = require_list(discovery.get("pages"), "discovery.pages")
    if len(pages) != page_count or page_count < 1 or page_count > MAX_DISCOVERY_PAGES:
        raise EvidenceError("archive discovery page count mismatch")
    prefixes: list[str] = []
    total_xml_bytes = 0
    for page_number, raw_page in enumerate(pages, start=1):
        page = require_mapping(raw_page, "discovery.pages[]")
        if page.get("page") != page_number:
            raise EvidenceError("archive discovery page order mismatch")
        page_path = state_root() / "listing-pages" / f"page-{page_number:03d}.xml"
        if not page_path.exists():
            raise EvidenceError("archive discovery raw page is missing")
        _guard_external_path(page_path)
        payload = page_path.read_bytes()
        total_xml_bytes += len(payload)
        if total_xml_bytes > MAX_DISCOVERY_XML_BYTES:
            raise EvidenceError("archive discovery XML byte budget exceeded")
        if sha256_bytes(payload) != page.get("rawSha256"):
            raise EvidenceError("archive discovery raw page digest mismatch")
        try:
            root = ElementTree.fromstring(payload)
        except ElementTree.ParseError as error:
            raise EvidenceError("stored archive discovery XML is malformed") from error
        page_prefixes = [
            require_text(node.text, "CommonPrefixes.Prefix")
            for node in root.findall("{*}CommonPrefixes/{*}Prefix")
        ]
        if (
            page.get("commonPrefixCount") != len(page_prefixes)
            or page.get("firstPrefix") != (None if not page_prefixes else page_prefixes[0])
            or page.get("lastPrefix") != (None if not page_prefixes else page_prefixes[-1])
        ):
            raise EvidenceError("archive discovery page summary mismatch")
        expected_truncated = "false" if page_number == page_count else "true"
        if _xml_text(root, "IsTruncated") != expected_truncated:
            raise EvidenceError("archive discovery pagination boundary mismatch")
        prefixes.extend(page_prefixes)
        if len(prefixes) > MAX_DISCOVERY_PREFIXES:
            raise EvidenceError("archive discovery prefix budget exceeded")
    if len(prefixes) != len(set(prefixes)):
        raise EvidenceError("duplicate prefix in stored archive discovery")
    sorted_prefixes = sorted(prefixes)
    classifications, eligible = _classify_prefixes(sorted_prefixes)
    expected: dict[str, object] = {
        "eligibleFormationSymbolCount": len(eligible),
        "eligibleFormationSymbols": eligible,
        "normalizedClassificationSha256": sha256_bytes(canonical_json_bytes(classifications)),
        "normalizedPrefixSha256": sha256_bytes(("\n".join(sorted_prefixes) + "\n").encode()),
        "officialSourceReceiptsSha256": sha256_file(SOURCE_RECEIPTS_PATH),
        "prefixCount": len(sorted_prefixes),
        "preservedClassificationCount": len(classifications),
        "preservedClassifications": classifications,
        "totalXmlBytes": total_xml_bytes,
    }
    for key, value in expected.items():
        if discovery.get(key) != value:
            raise EvidenceError(f"archive discovery reconstructed field mismatch: {key}")
    return discovery


def discover_symbols() -> dict[str, object]:
    root_path = state_root()
    collect_source_receipts()
    discovery_path = root_path / "discovery.v1.json"
    if discovery_path.exists():
        if not (root_path / "freeze.v1.json").exists():
            raise EvidenceError(
                "unsealed existing discovery is not reusable; use an empty state root"
            )
        return cast(dict[str, object], validate_discovery_receipt())

    page_number = 0
    token: str | None = None
    seen_tokens: set[str] = set()
    prefixes: list[str] = []
    pages: list[dict[str, object]] = []
    raw_pages_dir = root_path / "listing-pages"
    total_xml_bytes = 0
    while True:
        if page_number >= MAX_DISCOVERY_PAGES:
            raise EvidenceError("archive discovery page budget exceeded")
        page_number += 1
        query: dict[str, str] = {
            "delimiter": "/",
            "list-type": "2",
            "max-keys": "1000",
            "prefix": "data/spot/monthly/klines/",
        }
        if token is not None:
            query["continuation-token"] = token
        url = f"{LISTING_ORIGIN}?{urllib.parse.urlencode(query)}"
        payload, _ = _http_bytes(url, maximum_bytes=16 * 1024 * 1024)
        total_xml_bytes += len(payload)
        if total_xml_bytes > MAX_DISCOVERY_XML_BYTES:
            raise EvidenceError("archive discovery XML byte budget exceeded")
        atomic_write(raw_pages_dir / f"page-{page_number:03d}.xml", payload)
        try:
            xml_root = ElementTree.fromstring(payload)
        except ElementTree.ParseError as error:
            raise EvidenceError("official S3 listing XML is malformed") from error
        page_prefixes = [
            require_text(node.text, "CommonPrefixes.Prefix")
            for node in xml_root.findall("{*}CommonPrefixes/{*}Prefix")
        ]
        prefixes.extend(page_prefixes)
        if len(prefixes) > MAX_DISCOVERY_PREFIXES:
            raise EvidenceError("archive discovery prefix budget exceeded")
        pages.append(
            {
                "commonPrefixCount": len(page_prefixes),
                "firstPrefix": None if not page_prefixes else page_prefixes[0],
                "lastPrefix": None if not page_prefixes else page_prefixes[-1],
                "page": page_number,
                "rawSha256": sha256_bytes(payload),
            }
        )
        truncated = _xml_text(xml_root, "IsTruncated")
        if truncated == "false":
            if _xml_text(xml_root, "NextContinuationToken") not in {None, ""}:
                raise EvidenceError("terminal S3 listing unexpectedly has continuation token")
            break
        if truncated != "true":
            raise EvidenceError("official S3 listing has invalid IsTruncated")
        next_token = _xml_text(xml_root, "NextContinuationToken")
        if next_token is None or not next_token or next_token in seen_tokens:
            raise EvidenceError("official S3 listing continuation token missing or repeated")
        seen_tokens.add(next_token)
        token = next_token

    if len(prefixes) != len(set(prefixes)):
        raise EvidenceError("duplicate symbol prefix in complete S3 listing")
    sorted_prefixes = sorted(prefixes)
    classifications, eligible = _classify_prefixes(sorted_prefixes)
    discovery: dict[str, object] = {
        "schema": "VG3ArchiveDiscoveryV1",
        "discoveredAtUtc": utc_now_text(),
        "endpoint": LISTING_ORIGIN,
        "eligibleFormationSymbolCount": len(eligible),
        "eligibleFormationSymbols": eligible,
        "normalizedClassificationSha256": sha256_bytes(canonical_json_bytes(classifications)),
        "normalizedPrefixSha256": sha256_bytes(("\n".join(sorted_prefixes) + "\n").encode()),
        "officialSourceReceiptsSha256": sha256_file(SOURCE_RECEIPTS_PATH),
        "pageCount": page_number,
        "pages": pages,
        "prefixCount": len(sorted_prefixes),
        "preservedClassificationCount": len(classifications),
        "preservedClassifications": classifications,
        "totalXmlBytes": total_xml_bytes,
    }
    exclusive_write(discovery_path, canonical_json_bytes(discovery))
    validate_discovery_receipt()
    return discovery


def leveraged_symbols(candidates: Sequence[str]) -> frozenset[str]:
    bases = {symbol[:-4] for symbol in candidates}
    excluded: set[str] = set()
    for base in bases:
        for left, right in (("UP", "DOWN"), ("BULL", "BEAR")):
            if base.endswith(left):
                stem = base[: -len(left)]
                paired = f"{stem}{right}"
                if paired in bases:
                    excluded.add(f"{base}USDT")
                    excluded.add(f"{paired}USDT")
    return frozenset(excluded)


@dataclass(frozen=True, slots=True, order=True)
class ArchiveSpec:
    partition: str
    cadence: str
    interval: str
    symbol: str
    period: str

    def __post_init__(self) -> None:
        if self.partition not in {"FORMATION", "DEVELOPMENT", "HOLDOUT"}:
            raise EvidenceError("invalid archive partition")
        if self.cadence not in {"monthly", "daily"}:
            raise EvidenceError("invalid archive cadence")
        if self.interval not in {"1d", "1m"}:
            raise EvidenceError("invalid archive interval")
        if not SYMBOL_RE.fullmatch(self.symbol):
            raise EvidenceError(f"invalid archive symbol: {self.symbol}")
        period_pattern = r"^\d{4}-\d{2}$" if self.cadence == "monthly" else r"^\d{4}-\d{2}-\d{2}$"
        if re.fullmatch(period_pattern, self.period) is None:
            raise EvidenceError(f"invalid archive period: {self.period}")

    @property
    def filename(self) -> str:
        return f"{self.symbol}-{self.interval}-{self.period}.zip"

    @property
    def key(self) -> str:
        return f"data/spot/{self.cadence}/klines/{self.symbol}/{self.interval}/{self.filename}"

    @property
    def url(self) -> str:
        return f"{DATA_ORIGIN}/{self.key}"

    @property
    def sidecar_url(self) -> str:
        return f"{self.url}.CHECKSUM"

    @property
    def identity(self) -> str:
        return ":".join(
            (self.partition, self.cadence.upper(), self.interval, self.symbol, self.period)
        )

    def local_path(self) -> Path:
        return state_root() / "archives" / self.key


@dataclass(frozen=True, slots=True)
class ArchiveRecord:
    spec: ArchiveSpec
    state: str
    zip_sha256: str | None
    checksum_text_sha256: str | None
    compressed_bytes: int
    last_modified: str | None

    def as_mapping(self) -> dict[str, object]:
        return {
            "cadence": self.spec.cadence,
            "checksumTextSha256": self.checksum_text_sha256,
            "compressedBytes": self.compressed_bytes,
            "interval": self.spec.interval,
            "lastModified": self.last_modified,
            "partition": self.spec.partition,
            "period": self.spec.period,
            "sourceKey": self.spec.key,
            "state": self.state,
            "symbol": self.spec.symbol,
            "zipSha256": self.zip_sha256,
        }


def _parse_sidecar(payload: bytes, expected_filename: str) -> str:
    try:
        text = payload.decode("ascii")
    except UnicodeDecodeError as error:
        raise EvidenceError("official checksum sidecar is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise EvidenceError("official checksum sidecar grammar mismatch")
    digest, filename = match.groups()
    if filename != expected_filename:
        raise EvidenceError(
            f"checksum sidecar filename mismatch: expected {expected_filename}, found {filename}"
        )
    return digest


def download_archive(
    spec: ArchiveSpec,
    *,
    allow_missing: bool,
    budget: _CompressedByteBudget,
) -> ArchiveRecord:
    zip_path = spec.local_path()
    sidecar_path = zip_path.with_name(f"{zip_path.name}.CHECKSUM")
    _guard_external_path(zip_path, create_parent=True)
    _guard_external_path(sidecar_path, create_parent=True)
    if zip_path.exists() and not sidecar_path.exists():
        raise EvidenceError(f"orphan local ZIP is not resumable: {spec.identity}")

    if sidecar_path.exists():
        sidecar = sidecar_path.read_bytes()
        expected_digest = _parse_sidecar(sidecar, spec.filename)
        downloaded = not zip_path.exists()
        if not zip_path.exists():
            try:
                last_modified = _http_stream_to_path(
                    spec.url,
                    zip_path,
                    expected_sha256=expected_digest,
                    budget=budget,
                )
            except ArchiveMissing:
                if not allow_missing:
                    raise EvidenceError(
                        f"official checksum exists but archive body is absent: {spec.identity}"
                    ) from None
                return ArchiveRecord(
                    spec=spec,
                    state="MISSING_BODY",
                    zip_sha256=None,
                    checksum_text_sha256=sha256_bytes(sidecar),
                    compressed_bytes=0,
                    last_modified=None,
                )
        else:
            last_modified = None
        actual_digest = sha256_file(zip_path)
        if actual_digest != expected_digest:
            raise EvidenceError(f"resumed ZIP checksum mismatch: {spec.identity}")
        if not downloaded:
            existing_size = zip_path.stat().st_size
            if existing_size > MAX_HTTP_BYTES:
                raise EvidenceError(f"local ZIP exceeded byte bound: {spec.identity}")
            budget.reserve(existing_size)
        return ArchiveRecord(
            spec=spec,
            state="VERIFIED",
            zip_sha256=actual_digest,
            checksum_text_sha256=sha256_bytes(sidecar),
            compressed_bytes=zip_path.stat().st_size,
            last_modified=last_modified,
        )

    try:
        sidecar, _ = _http_bytes(spec.sidecar_url, maximum_bytes=MAX_SIDECAR_BYTES)
    except ArchiveMissing:
        if not allow_missing:
            raise EvidenceError(f"required official archive is absent: {spec.identity}") from None
        return ArchiveRecord(
            spec=spec,
            state="MISSING",
            zip_sha256=None,
            checksum_text_sha256=None,
            compressed_bytes=0,
            last_modified=None,
        )
    expected_digest = _parse_sidecar(sidecar, spec.filename)
    atomic_write(sidecar_path, sidecar)
    try:
        last_modified = _http_stream_to_path(
            spec.url,
            zip_path,
            expected_sha256=expected_digest,
            budget=budget,
        )
    except ArchiveMissing:
        if not allow_missing:
            raise EvidenceError(
                f"official checksum exists but archive body is absent: {spec.identity}"
            ) from None
        return ArchiveRecord(
            spec=spec,
            state="MISSING_BODY",
            zip_sha256=None,
            checksum_text_sha256=sha256_bytes(sidecar),
            compressed_bytes=0,
            last_modified=None,
        )
    actual_digest = sha256_file(zip_path)
    return ArchiveRecord(
        spec=spec,
        state="VERIFIED",
        zip_sha256=actual_digest,
        checksum_text_sha256=sha256_bytes(sidecar),
        compressed_bytes=zip_path.stat().st_size,
        last_modified=last_modified,
    )


def download_many(
    specs: Sequence[ArchiveSpec],
    *,
    allow_missing: bool,
    maximum_total_bytes: int,
    optional_identities: frozenset[str] = frozenset(),
) -> tuple[ArchiveRecord, ...]:
    identities = [spec.identity for spec in specs]
    if len(identities) != len(set(identities)):
        raise EvidenceError("duplicate archive identity in acquisition plan")
    records: list[ArchiveRecord] = []
    total = len(specs)
    budget = _CompressedByteBudget(maximum_total_bytes)
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
        futures: dict[Future[ArchiveRecord], ArchiveSpec] = {
            executor.submit(
                download_archive,
                spec,
                allow_missing=allow_missing or spec.identity in optional_identities,
                budget=budget,
            ): spec
            for spec in specs
        }
        for index, future in enumerate(as_completed(futures), start=1):
            spec = futures[future]
            try:
                records.append(future.result())
            except Exception as error:
                for pending in futures:
                    pending.cancel()
                if isinstance(error, EvidenceError):
                    raise
                raise EvidenceError(
                    f"archive acquisition failed: {spec.identity}: {error}"
                ) from error
            if index % 100 == 0 or index == total:
                print(f"verified archive receipts {index}/{total}", flush=True)
    ordered = tuple(sorted(records, key=lambda item: item.spec.identity))
    if sum(record.compressed_bytes for record in ordered) != budget.consumed_bytes:
        raise EvidenceError("partition compressed-byte accounting mismatch")
    return ordered


def month_range(start: str, end: str) -> tuple[str, ...]:
    current = date.fromisoformat(f"{start}-01")
    finish = date.fromisoformat(f"{end}-01")
    values: list[str] = []
    while current <= finish:
        values.append(current.strftime("%Y-%m"))
        current = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
    return tuple(values)


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    return tuple(start + timedelta(days=offset) for offset in range((end_exclusive - start).days))


def formation_specs(symbols: Sequence[str]) -> tuple[ArchiveSpec, ...]:
    return tuple(
        ArchiveSpec("FORMATION", "monthly", "1d", symbol, month)
        for symbol in sorted(symbols)
        for month in ("2025-03", "2025-04", "2025-05")
    )


def development_specs(symbols: Sequence[str]) -> tuple[ArchiveSpec, ...]:
    specs: list[ArchiveSpec] = []
    for symbol in sorted(symbols):
        specs.extend(
            ArchiveSpec("DEVELOPMENT", "monthly", "1d", symbol, month)
            for month in month_range("2025-06", "2026-01")
        )
        specs.extend(
            ArchiveSpec("DEVELOPMENT", "daily", "1d", symbol, day.isoformat())
            for day in date_range(date(2026, 2, 1), date(2026, 2, 9))
        )
        specs.extend(
            ArchiveSpec("DEVELOPMENT", "monthly", "1m", symbol, month)
            for month in month_range("2025-07", "2026-01")
        )
        specs.extend(
            ArchiveSpec("DEVELOPMENT", "daily", "1m", symbol, day.isoformat())
            for day in date_range(date(2026, 2, 1), date(2026, 2, 11))
        )
    return tuple(specs)


def holdout_specs(symbols: Sequence[str]) -> tuple[ArchiveSpec, ...]:
    specs: list[ArchiveSpec] = []
    for symbol in sorted(symbols):
        specs.extend(
            ArchiveSpec("HOLDOUT", "monthly", "1d", symbol, month)
            for month in month_range("2026-02", "2026-06")
        )
        specs.extend(
            ArchiveSpec("HOLDOUT", "monthly", "1m", symbol, month)
            for month in month_range("2026-02", "2026-06")
        )
        specs.append(ArchiveSpec("HOLDOUT", "daily", "1m", symbol, "2026-07-01"))
    return tuple(specs)


@dataclass(frozen=True, slots=True)
class Bar:
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    trade_count: int


def _timestamp(raw: str) -> datetime:
    try:
        integer = int(raw)
    except ValueError as error:
        raise EvidenceError(f"invalid kline timestamp: {raw}") from error
    if integer < 10**15 or integer >= 10**17:
        raise EvidenceError("scoped post-2025 kline timestamp is not microseconds")
    return datetime(1970, 1, 1, tzinfo=UTC) + timedelta(microseconds=integer)


def _validate_kline_time(spec: ArchiveSpec, opened: datetime, close_raw: str) -> None:
    if spec.cadence == "monthly":
        start = date.fromisoformat(f"{spec.period}-01")
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    else:
        start = date.fromisoformat(spec.period)
        end = start + timedelta(days=1)
    if not start <= opened.date() < end:
        raise EvidenceError(f"kline row escaped requested archive period: {spec.identity}")
    expected_duration = timedelta(days=1) if spec.interval == "1d" else timedelta(minutes=1)
    expected_close = opened + expected_duration - timedelta(microseconds=1)
    if _timestamp(close_raw) != expected_close:
        raise EvidenceError(f"kline close-time boundary mismatch: {spec.identity}")


def _verified_csv_rows(
    spec: ArchiveSpec,
    expected_hashes: Mapping[str, tuple[str, str]] | None = None,
) -> Iterable[list[str]]:
    path = spec.local_path()
    sidecar_path = path.with_name(f"{path.name}.CHECKSUM")
    if not path.exists() or not sidecar_path.exists():
        raise EvidenceError(f"verified local source missing: {spec.identity}")
    sidecar_payload = sidecar_path.read_bytes()
    expected = _parse_sidecar(sidecar_payload, spec.filename)
    actual_sidecar_digest = sha256_bytes(sidecar_payload)
    actual_zip_digest = sha256_file(path)
    if expected_hashes is not None:
        sealed = expected_hashes.get(spec.identity)
        if sealed is None:
            raise EvidenceError(f"archive identity absent from sealed acquisition: {spec.identity}")
        sealed_zip_digest, sealed_sidecar_digest = sealed
        if actual_zip_digest != sealed_zip_digest or actual_sidecar_digest != sealed_sidecar_digest:
            raise EvidenceError(f"archive bytes differ from sealed acquisition: {spec.identity}")
    if actual_zip_digest != expected:
        raise EvidenceError(f"source drift since acquisition: {spec.identity}")
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise EvidenceError(f"invalid official ZIP: {spec.identity}") from error
    expected_member = spec.filename.removesuffix(".zip") + ".csv"
    members = archive.infolist()
    if len(members) != 1 or members[0].filename != expected_member:
        archive.close()
        raise EvidenceError(f"ZIP member identity mismatch: {spec.identity}")
    if members[0].file_size > MAX_HTTP_BYTES:
        archive.close()
        raise EvidenceError(f"uncompressed archive exceeds bound: {spec.identity}")
    with (
        archive,
        archive.open(members[0], "r") as raw,
        io.TextIOWrapper(raw, encoding="utf-8", newline="") as text,
    ):
        reader = csv.reader(text)
        for row in reader:
            if row and row[0] in {"open_time", "Open time"}:
                continue
            yield row


def read_daily_bars(
    specs: Sequence[ArchiveSpec],
    expected_hashes: Mapping[str, tuple[str, str]] | None = None,
) -> dict[str, dict[date, Bar]]:
    output: dict[str, dict[date, Bar]] = {}
    for spec in specs:
        if spec.interval != "1d":
            raise EvidenceError("daily parser received non-daily interval")
        by_day = output.setdefault(spec.symbol, {})
        row_count = 0
        for row in _verified_csv_rows(spec, expected_hashes):
            if len(row) < 9:
                raise EvidenceError(f"short daily kline row: {spec.identity}")
            opened = _timestamp(row[0])
            _validate_kline_time(spec, opened, row[6])
            row_count += 1
            if opened.time() != daytime(0, 0):
                raise EvidenceError(f"daily kline is not UTC-midnight aligned: {spec.identity}")
            day = opened.date()
            if day in by_day:
                raise EvidenceError(f"duplicate daily bar: {spec.symbol} {day}")
            try:
                bar = Bar(
                    day=day,
                    open=Decimal(row[1]),
                    high=Decimal(row[2]),
                    low=Decimal(row[3]),
                    close=Decimal(row[4]),
                    quote_volume=Decimal(row[7]),
                    trade_count=int(row[8]),
                )
            except (ValueError, ArithmeticError) as error:
                raise EvidenceError(f"invalid daily kline numeric: {spec.identity}") from error
            if (
                bar.open <= 0
                or bar.high <= 0
                or bar.low <= 0
                or bar.close <= 0
                or bar.quote_volume < 0
                or bar.trade_count < 0
                or bar.low > min(bar.open, bar.close)
                or bar.high < max(bar.open, bar.close)
            ):
                raise EvidenceError(f"invalid daily OHLCV relation: {spec.identity}")
            by_day[day] = bar
        if spec.cadence == "daily" and row_count != 1:
            raise EvidenceError(f"daily 1d archive row count is not one: {spec.identity}")
    return output


def _decimal_median(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("median requires values")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def select_universe(
    symbols: Sequence[str],
    records: Sequence[ArchiveRecord],
) -> dict[str, object]:
    record_by_identity = {record.spec.identity: record for record in records}
    age_days = date_range(date(2025, 3, 3), date(2025, 6, 1))
    liquidity_days = date_range(date(2025, 4, 2), date(2025, 6, 1))
    classifications: list[dict[str, object]] = []
    accepted: list[tuple[Decimal, str]] = []
    formation_hashes = {
        record.spec.identity: (
            require_text(record.zip_sha256, "formation.zipSha256"),
            require_text(record.checksum_text_sha256, "formation.checksumTextSha256"),
        )
        for record in records
        if record.state == "VERIFIED"
    }
    for symbol in sorted(symbols):
        specs = formation_specs((symbol,))
        if any(record_by_identity[spec.identity].state != "VERIFIED" for spec in specs):
            classifications.append({"reason": "FORMATION_ARCHIVE_MISSING", "symbol": symbol})
            continue
        try:
            bars = read_daily_bars(specs, formation_hashes)[symbol]
        except EvidenceError as error:
            classifications.append(
                {"reason": "FORMATION_ARCHIVE_INVALID", "symbol": symbol, "detail": str(error)}
            )
            continue
        if any(day not in bars for day in age_days):
            classifications.append({"reason": "AGE_WINDOW_INCOMPLETE", "symbol": symbol})
            continue
        volumes = [bars[day].quote_volume for day in liquidity_days]
        if len(volumes) != 60:
            classifications.append({"reason": "LIQUIDITY_WINDOW_INCOMPLETE", "symbol": symbol})
            continue
        median_volume = _decimal_median(volumes)
        if median_volume < Decimal("5000000"):
            classifications.append(
                {
                    "medianDailyQuoteVolumeUsdt": decimal_text(median_volume),
                    "reason": "LIQUIDITY_FLOOR_FAILED",
                    "symbol": symbol,
                }
            )
            continue
        accepted.append((median_volume, symbol))
        classifications.append(
            {
                "medianDailyQuoteVolumeUsdt": decimal_text(median_volume),
                "reason": "FORMATION_ACCEPTED",
                "symbol": symbol,
            }
        )
    accepted.sort(key=lambda item: (-item[0], item[1]))
    selected = accepted[:40]
    if len(selected) != 40:
        raise EvidenceError(f"formation produced {len(selected)} names, exactly 40 required")
    result: dict[str, object] = {
        "schema": "VG3UniverseSealV1",
        "asOfUtc": "2025-06-01T00:00:00Z",
        "classificationCount": len(classifications),
        "classificationSha256": sha256_bytes(canonical_json_bytes(classifications)),
        "eligibleLiquidityCount": len(accepted),
        "selected": [
            {
                "medianDailyQuoteVolumeUsdt": decimal_text(volume),
                "rank": index,
                "symbol": symbol,
            }
            for index, (volume, symbol) in enumerate(selected, start=1)
        ],
        "selectedSymbols": [symbol for _, symbol in selected],
    }
    return result


@dataclass(slots=True)
class _ExecutionAccumulator:
    reference_entry: Decimal | None = None
    reference_exit: Decimal | None = None
    entry_high: Decimal | None = None
    exit_low: Decimal | None = None
    holding_low: Decimal | None = None
    entry_quote_volume: Decimal = Decimal(0)
    exit_quote_volume: Decimal = Decimal(0)
    entry_count: int = 0
    exit_count: int = 0
    holding_count: int = 0


@dataclass(frozen=True, slots=True)
class ExecutionEvidence:
    entry_date: date
    reference_entry: Decimal
    reference_exit: Decimal
    entry_price: Decimal
    exit_price: Decimal
    holding_low: Decimal
    entry_quote_volume: Decimal
    exit_quote_volume: Decimal


def read_execution_evidence(
    specs: Sequence[ArchiveSpec],
    entry_dates: Sequence[date],
    expected_hashes: Mapping[str, tuple[str, str]] | None = None,
) -> dict[str, dict[date, ExecutionEvidence]]:
    target_dates = frozenset(entry_dates)
    output: dict[str, dict[date, ExecutionEvidence]] = {}
    by_symbol: dict[str, list[ArchiveSpec]] = {}
    for spec in specs:
        if spec.interval != "1m":
            raise EvidenceError("execution parser received non-minute interval")
        by_symbol.setdefault(spec.symbol, []).append(spec)
    for symbol, symbol_specs in sorted(by_symbol.items()):
        accumulators = {day: _ExecutionAccumulator() for day in target_dates}
        seen_minutes: set[datetime] = set()
        for spec in sorted(symbol_specs):
            spec_row_count = 0
            for row in _verified_csv_rows(spec, expected_hashes):
                if len(row) < 9:
                    raise EvidenceError(f"short minute kline row: {spec.identity}")
                opened = _timestamp(row[0])
                _validate_kline_time(spec, opened, row[6])
                spec_row_count += 1
                if opened.second != 0 or opened.microsecond != 0:
                    raise EvidenceError(f"minute kline is not minute aligned: {spec.identity}")
                if opened in seen_minutes:
                    raise EvidenceError(f"duplicate minute bar for {symbol}: {opened.isoformat()}")
                seen_minutes.add(opened)
                try:
                    open_price = Decimal(row[1])
                    high = Decimal(row[2])
                    low = Decimal(row[3])
                    quote_volume = Decimal(row[7])
                except ArithmeticError as error:
                    raise EvidenceError(f"invalid minute numeric: {spec.identity}") from error
                if (
                    open_price <= 0
                    or high <= 0
                    or low <= 0
                    or quote_volume < 0
                    or high < open_price
                    or low > open_price
                ):
                    raise EvidenceError(f"invalid minute OHLCV relation: {spec.identity}")
                minute = opened.hour * 60 + opened.minute
                current_day = opened.date()
                if current_day in target_dates:
                    current = accumulators[current_day]
                    if minute == 0:
                        current.reference_entry = open_price
                    if 5 <= minute < 10:
                        current.entry_high = (
                            high if current.entry_high is None else max(current.entry_high, high)
                        )
                        current.entry_quote_volume += quote_volume
                        current.entry_count += 1
                    if minute >= 10:
                        current.holding_low = (
                            low if current.holding_low is None else min(current.holding_low, low)
                        )
                        current.holding_count += 1
                previous_day = current_day - timedelta(days=1)
                if previous_day in target_dates and minute < 10:
                    previous = accumulators[previous_day]
                    if minute == 0:
                        previous.reference_exit = open_price
                    previous.holding_low = (
                        low if previous.holding_low is None else min(previous.holding_low, low)
                    )
                    previous.holding_count += 1
                    if 5 <= minute < 10:
                        previous.exit_low = (
                            low if previous.exit_low is None else min(previous.exit_low, low)
                        )
                        previous.exit_quote_volume += quote_volume
                        previous.exit_count += 1
            if spec.cadence == "daily" and spec_row_count != 1440:
                raise EvidenceError(f"daily 1m archive row count is not 1440: {spec.identity}")
        evidence: dict[date, ExecutionEvidence] = {}
        for day, accumulator in sorted(accumulators.items()):
            if (
                accumulator.reference_entry is None
                or accumulator.reference_exit is None
                or accumulator.entry_high is None
                or accumulator.exit_low is None
                or accumulator.holding_low is None
                or accumulator.entry_count != 5
                or accumulator.exit_count != 5
                or accumulator.holding_count != 1440
            ):
                raise EvidenceError(
                    f"incomplete execution window: {symbol} {day} "
                    f"entry={accumulator.entry_count} exit={accumulator.exit_count} "
                    f"holding={accumulator.holding_count}"
                )
            evidence[day] = ExecutionEvidence(
                entry_date=day,
                reference_entry=accumulator.reference_entry,
                reference_exit=accumulator.reference_exit,
                entry_price=accumulator.entry_high,
                exit_price=accumulator.exit_low,
                holding_low=accumulator.holding_low,
                entry_quote_volume=accumulator.entry_quote_volume,
                exit_quote_volume=accumulator.exit_quote_volume,
            )
        output[symbol] = evidence
    return output


def decimal_text(value: Decimal, quantum: Decimal = RATE_QUANTUM) -> str:
    quantized = value.quantize(quantum, rounding=ROUND_HALF_EVEN)
    rendered = format(quantized, "f").rstrip("0").rstrip(".")
    return "0" if rendered in {"", "-0"} else rendered


def _reported_money_positive(value: Decimal) -> bool:
    return Decimal(decimal_text(value, MONEY_QUANTUM)) > 0


def _reported_rate_bps_positive(value: Decimal) -> bool:
    return Decimal(decimal_text(value * 10_000)) > STAT_QUANTUM * 10_000


def _reported_bps_at_most(value: Decimal, maximum: Decimal) -> bool:
    return Decimal(decimal_text(value)) <= maximum


def _assert_scope_from_base(head: str) -> None:
    completed = subprocess.run(
        ("git", "-C", str(HERE), "merge-base", "--is-ancestor", BASE_COMMIT, head),
        check=False,
    )
    if completed.returncode != 0:
        raise EvidenceError("current commit is not a descendant of the exact canonical base")
    changed = tuple(
        line
        for line in git_output("diff", "--name-only", f"{BASE_COMMIT}...{head}").splitlines()
        if line
    )
    prefix = "quant/research/vg3/"
    outside = tuple(path for path in changed if not path.startswith(prefix))
    if outside:
        raise EvidenceError(f"Git delta escaped exclusive V-G3 scope: {outside}")


def _runtime_contract() -> dict[str, object]:
    return {
        "decimalPrecision": getcontext().prec,
        "machine": platform.machine(),
        "platformRelease": platform.release(),
        "platformSystem": platform.system(),
        "pythonImplementation": platform.python_implementation(),
        "pythonVersion": platform.python_version(),
        "pyprojectSha256": sha256_file(PYPROJECT_PATH),
        "uvLockSha256": sha256_file(UV_LOCK_PATH),
    }


def create_freeze() -> dict[str, object]:
    if FREEZE_PATH.exists():
        raise EvidenceError("tracked freeze receipt already exists")
    if RESULT_PATH.exists():
        raise EvidenceError("result exists before freeze")
    discovery_path = state_root() / "discovery.v1.json"
    if not discovery_path.exists():
        raise EvidenceError("discover must complete before freeze")
    source_receipts = validate_source_receipts()
    discovery = validate_discovery_receipt()
    protocol_value = protocol()
    if git_output("status", "--porcelain"):
        raise EvidenceError("freeze requires a clean pre-outcome protocol commit")
    head = git_output("rev-parse", "HEAD")
    _assert_scope_from_base(head)
    inputs: dict[str, str] = {}
    for path in (
        PROTOCOL_PATH,
        SOURCE_RESEARCH_PATH,
        SOURCE_RECEIPTS_PATH,
        README_PATH,
        SCRIPT_PATH,
        TEST_PATH,
    ):
        if not path.exists():
            raise EvidenceError(f"frozen input missing: {path.name}")
        inputs[path.name] = sha256_file(path)
    freeze: dict[str, object] = {
        "schema": "VG3FreezeV1",
        "baseCommit": BASE_COMMIT,
        "discovery": {
            "eligibleFormationSymbolCount": discovery.get("eligibleFormationSymbolCount"),
            "normalizedClassificationSha256": discovery.get("normalizedClassificationSha256"),
            "normalizedPrefixSha256": discovery.get("normalizedPrefixSha256"),
            "pageCount": discovery.get("pageCount"),
            "prefixCount": discovery.get("prefixCount"),
            "receiptSha256": sha256_file(discovery_path),
            "totalXmlBytes": discovery.get("totalXmlBytes"),
        },
        "frozenAtUtc": utc_now_text(),
        "frozenInputs": inputs,
        "outcomeArchiveOpened": False,
        "protocolCommit": head,
        "protocolId": protocol_value["protocolId"],
        "runtime": _runtime_contract(),
        "seeds": BOOTSTRAP_SEEDS,
        "sourceReceiptsSha256": sha256_bytes(canonical_json_bytes(source_receipts)),
        "stateRoot": str(state_root()),
    }
    external_path = state_root() / "freeze.v1.json"
    if external_path.exists():
        external_freeze = load_json(external_path)
        expected_recovery = {
            **freeze,
            "frozenAtUtc": external_freeze.get("frozenAtUtc"),
        }
        if (
            external_path.read_bytes() != canonical_json_bytes(external_freeze)
            or external_freeze != expected_recovery
        ):
            raise EvidenceError("stranded external freeze does not match current inputs")
        exclusive_write(FREEZE_PATH, external_path.read_bytes())
        return cast(dict[str, object], external_freeze)
    payload = canonical_json_bytes(freeze)
    exclusive_write(external_path, payload)
    exclusive_write(FREEZE_PATH, payload)
    return freeze


def verify_freeze() -> dict[str, Any]:
    external_path = state_root() / "freeze.v1.json"
    if not FREEZE_PATH.exists() or not external_path.exists():
        raise EvidenceError("tracked and external freeze receipts are both required")
    _guard_external_path(external_path)
    tracked = FREEZE_PATH.read_bytes()
    external = external_path.read_bytes()
    if tracked != external:
        raise EvidenceError("tracked and external freeze receipts differ")
    freeze = load_json(FREEZE_PATH)
    if tracked != canonical_json_bytes(freeze):
        raise EvidenceError("freeze receipt is not canonical JSON")
    require_exact_keys(
        freeze,
        {
            "baseCommit",
            "discovery",
            "frozenAtUtc",
            "frozenInputs",
            "outcomeArchiveOpened",
            "protocolCommit",
            "protocolId",
            "runtime",
            "schema",
            "seeds",
            "sourceReceiptsSha256",
            "stateRoot",
        },
        "freeze",
    )
    if freeze.get("schema") != "VG3FreezeV1" or freeze.get("baseCommit") != BASE_COMMIT:
        raise EvidenceError("freeze identity mismatch")
    if freeze.get("outcomeArchiveOpened") is not False or freeze.get("stateRoot") != str(
        state_root()
    ):
        raise EvidenceError("freeze outcome or external-root identity mismatch")
    require_text(freeze.get("frozenAtUtc"), "freeze.frozenAtUtc")
    frozen_inputs = require_mapping(freeze.get("frozenInputs"), "freeze.frozenInputs")
    expected_names = {
        PROTOCOL_PATH.name,
        SOURCE_RESEARCH_PATH.name,
        SOURCE_RECEIPTS_PATH.name,
        README_PATH.name,
        SCRIPT_PATH.name,
        TEST_PATH.name,
    }
    if set(frozen_inputs) != expected_names:
        raise EvidenceError("freeze input set mismatch")
    by_name = {
        PROTOCOL_PATH.name: PROTOCOL_PATH,
        SOURCE_RESEARCH_PATH.name: SOURCE_RESEARCH_PATH,
        SOURCE_RECEIPTS_PATH.name: SOURCE_RECEIPTS_PATH,
        README_PATH.name: README_PATH,
        SCRIPT_PATH.name: SCRIPT_PATH,
        TEST_PATH.name: TEST_PATH,
    }
    for name, path in by_name.items():
        expected = require_text(frozen_inputs.get(name), f"frozenInputs.{name}")
        if sha256_file(path) != expected:
            raise EvidenceError(f"frozen input drift: {name}")
    protocol_value = protocol()
    if freeze.get("protocolId") != protocol_value.get("protocolId"):
        raise EvidenceError("frozen protocol id drift")
    source_receipts = validate_source_receipts()
    discovery = validate_discovery_receipt()
    if freeze.get("runtime") != _runtime_contract():
        raise EvidenceError("frozen evaluator runtime drift")
    if freeze.get("seeds") != BOOTSTRAP_SEEDS:
        raise EvidenceError("frozen bootstrap seeds drift")
    if freeze.get("sourceReceiptsSha256") != sha256_bytes(canonical_json_bytes(source_receipts)):
        raise EvidenceError("frozen official-source receipt drift")
    frozen_discovery = require_mapping(freeze.get("discovery"), "freeze.discovery")
    if frozen_discovery.get("receiptSha256") != sha256_file(state_root() / "discovery.v1.json"):
        raise EvidenceError("frozen discovery receipt drift")
    for key in (
        "eligibleFormationSymbolCount",
        "normalizedClassificationSha256",
        "normalizedPrefixSha256",
        "pageCount",
        "prefixCount",
        "totalXmlBytes",
    ):
        if frozen_discovery.get(key) != discovery.get(key):
            raise EvidenceError(f"frozen discovery field drift: {key}")
    protocol_commit = require_text(freeze.get("protocolCommit"), "protocolCommit")
    _assert_scope_from_base(protocol_commit)
    current_head = git_output("rev-parse", "HEAD")
    if (
        subprocess.run(
            (
                "git",
                "-C",
                str(HERE),
                "merge-base",
                "--is-ancestor",
                protocol_commit,
                current_head,
            ),
            check=False,
        ).returncode
        != 0
    ):
        raise EvidenceError("current HEAD does not descend from the frozen protocol commit")
    _assert_scope_from_base(current_head)
    dirty_lines = tuple(line for line in git_output("status", "--porcelain").splitlines() if line)
    if dirty_lines:
        external_result = state_root() / "result.v1.json"
        exact_recovering_result = (
            RESULT_PATH.exists()
            and external_result.exists()
            and RESULT_PATH.read_bytes() == external_result.read_bytes()
        )
        dirty_paths = tuple(line[3:] if len(line) > 3 else "" for line in dirty_lines)
        if not (exact_recovering_result and dirty_paths == ("quant/research/vg3/result.v1.json",)):
            raise EvidenceError(
                "pre-outcome lifecycle requires a clean worktree; "
                "only an exact recovering result may be dirty"
            )
    if git_blob_at_head("quant/research/vg3/freeze.v1.json") != tracked:
        raise EvidenceError("freeze receipt must be committed unchanged before acquisition")
    return freeze


def _selected_symbols(universe: Mapping[str, Any]) -> tuple[str, ...]:
    values = require_list(universe.get("selectedSymbols"), "universe.selectedSymbols")
    symbols = tuple(require_text(value, "selectedSymbols[]") for value in values)
    if len(symbols) != 40 or len(symbols) != len(set(symbols)):
        raise EvidenceError("universe seal must contain exactly 40 unique symbols")
    if tuple(sorted(symbols)) == symbols:
        # Liquidity ranking is expected, so an alphabetic list is suspicious but can
        # legitimately occur. The explicit selected rows below carry the binding.
        pass
    return symbols


def acquire_archives() -> dict[str, object]:
    freeze = verify_freeze()
    if (state_root() / "development-opened.v1.json").exists():
        raise EvidenceError("acquisition cannot run after development opened")
    acquisition_path = state_root() / "acquisition.v1.json"
    if acquisition_path.exists():
        existing_acquisition, _, _ = verify_acquisition()
        return cast(dict[str, object], existing_acquisition)
    discovery = validate_discovery_receipt()
    eligible_values = require_list(
        discovery.get("eligibleFormationSymbols"),
        "discovery.eligibleFormationSymbols",
    )
    eligible = tuple(require_text(value, "eligibleFormationSymbols[]") for value in eligible_values)
    formation_plan = formation_specs(eligible)
    if len(formation_plan) > MAX_ARCHIVE_RECORDS:
        raise EvidenceError("formation archive plan exceeds record bound")
    formation = download_many(
        formation_plan,
        allow_missing=True,
        maximum_total_bytes=MAX_FORMATION_COMPRESSED_BYTES,
    )
    formation_receipt: dict[str, object] = {
        "schema": "VG3FormationAcquisitionV1",
        "recordCount": len(formation),
        "records": [record.as_mapping() for record in formation],
    }
    atomic_write(
        state_root() / "formation-acquisition.v1.json",
        canonical_json_bytes(formation_receipt),
    )

    universe_path = state_root() / "universe-seal.v1.json"
    computed_universe = cast(dict[str, Any], select_universe(eligible, formation))
    discovery_digest = sha256_file(state_root() / "discovery.v1.json")
    freeze_digest = sha256_file(FREEZE_PATH)
    if universe_path.exists():
        universe = load_json(universe_path)
        sealed_at = require_text(universe.get("sealedAtUtc"), "universe.sealedAtUtc")
        expected_universe = {
            **computed_universe,
            "discoveryReceiptSha256": discovery_digest,
            "freezeReceiptSha256": freeze_digest,
            "sealedAtUtc": sealed_at,
        }
        if universe != expected_universe:
            raise EvidenceError("existing universe seal differs from deterministic formation")
    else:
        universe = computed_universe
        universe["discoveryReceiptSha256"] = discovery_digest
        universe["freezeReceiptSha256"] = freeze_digest
        universe["sealedAtUtc"] = utc_now_text()
        exclusive_write(universe_path, canonical_json_bytes(universe))
    symbols = _selected_symbols(universe)

    development_plan = development_specs(symbols)
    holdout_plan = holdout_specs(symbols)
    planned_count = len(formation_plan) + len(development_plan) + len(holdout_plan)
    if planned_count > MAX_ARCHIVE_RECORDS:
        raise EvidenceError(f"archive acquisition plan exceeds record bound: {planned_count}")
    development = download_many(
        development_plan,
        allow_missing=True,
        maximum_total_bytes=MAX_DEVELOPMENT_COMPRESSED_BYTES,
        optional_identities=frozenset(
            spec.identity for spec in development_plan if spec.interval == "1m"
        ),
    )
    holdout = download_many(
        holdout_plan,
        allow_missing=True,
        maximum_total_bytes=MAX_HOLDOUT_COMPRESSED_BYTES,
        optional_identities=frozenset(
            spec.identity for spec in holdout_plan if spec.interval == "1m"
        ),
    )
    all_records = tuple(
        sorted((*formation, *development, *holdout), key=lambda item: item.spec.identity)
    )
    record_mappings = [record.as_mapping() for record in all_records]
    record_digest = sha256_bytes(canonical_json_bytes(record_mappings))
    acquisition: dict[str, object] = {
        "schema": "VG3AcquisitionV1",
        "acquiredAtUtc": utc_now_text(),
        "compressedBytes": sum(record.compressed_bytes for record in all_records),
        "discoveryReceiptSha256": sha256_file(state_root() / "discovery.v1.json"),
        "freezeReceiptSha256": sha256_file(FREEZE_PATH),
        "missingFormationArchiveCount": sum(record.state != "VERIFIED" for record in formation),
        "missingOptionalMinuteArchiveCount": sum(
            record.state != "VERIFIED" and record.spec.interval == "1m"
            for record in (*development, *holdout)
        ),
        "missingRequiredDailyArchiveCount": sum(
            record.state != "VERIFIED" and record.spec.interval == "1d"
            for record in (*development, *holdout)
        ),
        "officialSourceReceiptsSha256": sha256_file(SOURCE_RECEIPTS_PATH),
        "partitionCounts": {
            "DEVELOPMENT": len(development),
            "FORMATION": len(formation),
            "HOLDOUT": len(holdout),
        },
        "protocolCommit": freeze["protocolCommit"],
        "recordCount": len(all_records),
        "records": record_mappings,
        "recordsSha256": record_digest,
        "universeSealSha256": sha256_file(universe_path),
        "verifiedArchiveCount": sum(record.state == "VERIFIED" for record in all_records),
    }
    payload = canonical_json_bytes(acquisition)
    exclusive_write(acquisition_path, payload)
    return acquisition


def _archive_record_from_mapping(raw_record: object) -> ArchiveRecord:
    record = require_mapping(raw_record, "acquisition.records[]")
    require_exact_keys(
        record,
        {
            "cadence",
            "checksumTextSha256",
            "compressedBytes",
            "interval",
            "lastModified",
            "partition",
            "period",
            "sourceKey",
            "state",
            "symbol",
            "zipSha256",
        },
        "acquisition.records[]",
    )
    spec = ArchiveSpec(
        require_text(record.get("partition"), "record.partition"),
        require_text(record.get("cadence"), "record.cadence"),
        require_text(record.get("interval"), "record.interval"),
        require_text(record.get("symbol"), "record.symbol"),
        require_text(record.get("period"), "record.period"),
    )
    if record.get("sourceKey") != spec.key:
        raise EvidenceError(f"acquisition source key mismatch: {spec.identity}")
    state = require_text(record.get("state"), "record.state")
    compressed_bytes = require_int(record.get("compressedBytes"), "record.compressedBytes")
    last_modified_value = record.get("lastModified")
    if last_modified_value is not None and not isinstance(last_modified_value, str):
        raise EvidenceError("record.lastModified must be text or null")
    last_modified = last_modified_value
    zip_value = record.get("zipSha256")
    sidecar_value = record.get("checksumTextSha256")
    if state == "MISSING":
        path = spec.local_path()
        sidecar_path = path.with_name(f"{path.name}.CHECKSUM")
        if (
            compressed_bytes != 0
            or zip_value is not None
            or sidecar_value is not None
            or last_modified is not None
            or path.exists()
            or sidecar_path.exists()
        ):
            raise EvidenceError(f"invalid missing archive record: {spec.identity}")
        return ArchiveRecord(spec, state, None, None, 0, None)
    if state == "MISSING_BODY":
        sidecar_digest = require_text(sidecar_value, "record.checksumTextSha256")
        path = spec.local_path()
        sidecar_path = path.with_name(f"{path.name}.CHECKSUM")
        if (
            compressed_bytes != 0
            or zip_value is not None
            or re.fullmatch(r"[0-9a-f]{64}", sidecar_digest) is None
            or last_modified is not None
            or path.exists()
            or not sidecar_path.exists()
            or sha256_file(sidecar_path) != sidecar_digest
        ):
            raise EvidenceError(f"invalid missing-body archive record: {spec.identity}")
        _parse_sidecar(sidecar_path.read_bytes(), spec.filename)
        return ArchiveRecord(spec, state, None, sidecar_digest, 0, None)
    if state != "VERIFIED":
        raise EvidenceError(f"invalid archive record state: {spec.identity}")
    zip_digest = require_text(zip_value, "record.zipSha256")
    sidecar_digest = require_text(sidecar_value, "record.checksumTextSha256")
    if (
        re.fullmatch(r"[0-9a-f]{64}", zip_digest) is None
        or re.fullmatch(r"[0-9a-f]{64}", sidecar_digest) is None
        or compressed_bytes <= 0
        or compressed_bytes > MAX_HTTP_BYTES
    ):
        raise EvidenceError(f"invalid verified archive receipt: {spec.identity}")
    path = spec.local_path()
    sidecar_path = path.with_name(f"{path.name}.CHECKSUM")
    if (
        not path.exists()
        or not sidecar_path.exists()
        or path.stat().st_size != compressed_bytes
        or sha256_file(path) != zip_digest
        or sha256_file(sidecar_path) != sidecar_digest
        or _parse_sidecar(sidecar_path.read_bytes(), spec.filename) != zip_digest
    ):
        raise EvidenceError(f"local archive bytes differ from receipt: {spec.identity}")
    return ArchiveRecord(
        spec,
        state,
        zip_digest,
        sidecar_digest,
        compressed_bytes,
        last_modified,
    )


def verify_acquisition() -> tuple[
    dict[str, Any],
    dict[str, Any],
    dict[str, tuple[str, str]],
]:
    freeze = verify_freeze()
    discovery = validate_discovery_receipt()
    acquisition_path = state_root() / "acquisition.v1.json"
    universe_path = state_root() / "universe-seal.v1.json"
    if not acquisition_path.exists() or not universe_path.exists():
        raise EvidenceError("acquire must complete before run")
    acquisition = load_json(acquisition_path)
    universe = load_json(universe_path)
    if acquisition.get("schema") != "VG3AcquisitionV1":
        raise EvidenceError("acquisition schema mismatch")
    if acquisition_path.read_bytes() != canonical_json_bytes(acquisition):
        raise EvidenceError("acquisition receipt is not canonical JSON")
    require_exact_keys(
        acquisition,
        {
            "acquiredAtUtc",
            "compressedBytes",
            "discoveryReceiptSha256",
            "freezeReceiptSha256",
            "missingFormationArchiveCount",
            "missingOptionalMinuteArchiveCount",
            "missingRequiredDailyArchiveCount",
            "officialSourceReceiptsSha256",
            "partitionCounts",
            "protocolCommit",
            "recordCount",
            "records",
            "recordsSha256",
            "schema",
            "universeSealSha256",
            "verifiedArchiveCount",
        },
        "acquisition",
    )
    for field_name in (
        "compressedBytes",
        "missingFormationArchiveCount",
        "missingOptionalMinuteArchiveCount",
        "missingRequiredDailyArchiveCount",
        "recordCount",
        "verifiedArchiveCount",
    ):
        require_int(acquisition.get(field_name), f"acquisition.{field_name}")
    raw_partition_counts = require_mapping(
        acquisition.get("partitionCounts"),
        "acquisition.partitionCounts",
    )
    require_exact_keys(
        raw_partition_counts,
        {"DEVELOPMENT", "FORMATION", "HOLDOUT"},
        "acquisition.partitionCounts",
    )
    for partition in ("DEVELOPMENT", "FORMATION", "HOLDOUT"):
        require_int(
            raw_partition_counts.get(partition),
            f"acquisition.partitionCounts.{partition}",
        )
    raw_records = require_list(acquisition.get("records"), "acquisition.records")
    if sha256_bytes(canonical_json_bytes(raw_records)) != acquisition.get("recordsSha256"):
        raise EvidenceError("acquisition record digest mismatch")
    if acquisition.get("discoveryReceiptSha256") != sha256_file(state_root() / "discovery.v1.json"):
        raise EvidenceError("acquisition discovery receipt drift")
    if acquisition.get("freezeReceiptSha256") != sha256_file(FREEZE_PATH):
        raise EvidenceError("acquisition freeze receipt drift")
    if acquisition.get("officialSourceReceiptsSha256") != sha256_file(SOURCE_RECEIPTS_PATH):
        raise EvidenceError("acquisition official-source receipt drift")
    if acquisition.get("protocolCommit") != freeze.get("protocolCommit"):
        raise EvidenceError("acquisition protocol commit drift")
    if sha256_file(universe_path) != acquisition.get("universeSealSha256"):
        raise EvidenceError("universe seal drift")

    eligible = tuple(
        require_text(value, "eligibleFormationSymbols[]")
        for value in require_list(
            discovery.get("eligibleFormationSymbols"),
            "discovery.eligibleFormationSymbols",
        )
    )
    symbols = _selected_symbols(universe)
    formation_plan = formation_specs(eligible)
    development_plan = development_specs(symbols)
    holdout_plan = holdout_specs(symbols)
    expected_specs = tuple(
        sorted(
            (*formation_plan, *development_plan, *holdout_plan),
            key=lambda spec: spec.identity,
        )
    )
    if len(expected_specs) > MAX_ARCHIVE_RECORDS:
        raise EvidenceError("verified archive plan exceeds record bound")
    records = tuple(_archive_record_from_mapping(raw) for raw in raw_records)
    identities = tuple(record.spec.identity for record in records)
    expected_identities = tuple(spec.identity for spec in expected_specs)
    if identities != expected_identities:
        raise EvidenceError("acquisition record identities or order drifted")

    expected_hashes: dict[str, tuple[str, str]] = {}
    for record in records:
        if record.state == "VERIFIED":
            expected_hashes[record.spec.identity] = (
                require_text(record.zip_sha256, "record.zipSha256"),
                require_text(record.checksum_text_sha256, "record.checksumTextSha256"),
            )
    formation = tuple(record for record in records if record.spec.partition == "FORMATION")
    computed_universe = cast(dict[str, Any], select_universe(eligible, formation))
    sealed_at = require_text(universe.get("sealedAtUtc"), "universe.sealedAtUtc")
    expected_universe = {
        **computed_universe,
        "discoveryReceiptSha256": sha256_file(state_root() / "discovery.v1.json"),
        "freezeReceiptSha256": sha256_file(FREEZE_PATH),
        "sealedAtUtc": sealed_at,
    }
    if universe != expected_universe:
        raise EvidenceError("universe seal differs from deterministic formation")

    formation_receipt_path = state_root() / "formation-acquisition.v1.json"
    if not formation_receipt_path.exists():
        raise EvidenceError("formation acquisition receipt is missing")
    formation_receipt = load_json(formation_receipt_path)
    expected_formation_mappings = [record.as_mapping() for record in formation]
    if formation_receipt != {
        "schema": "VG3FormationAcquisitionV1",
        "recordCount": len(formation),
        "records": expected_formation_mappings,
    }:
        raise EvidenceError("formation acquisition receipt drift")

    partition_counts = {
        partition: sum(record.spec.partition == partition for record in records)
        for partition in ("DEVELOPMENT", "FORMATION", "HOLDOUT")
    }
    compressed_by_partition = {
        partition: sum(
            record.compressed_bytes for record in records if record.spec.partition == partition
        )
        for partition in ("DEVELOPMENT", "FORMATION", "HOLDOUT")
    }
    if (
        compressed_by_partition["FORMATION"] > MAX_FORMATION_COMPRESSED_BYTES
        or compressed_by_partition["DEVELOPMENT"] > MAX_DEVELOPMENT_COMPRESSED_BYTES
        or compressed_by_partition["HOLDOUT"] > MAX_HOLDOUT_COMPRESSED_BYTES
    ):
        raise EvidenceError("acquisition partition byte budget exceeded")
    expected_summary: dict[str, object] = {
        "compressedBytes": sum(record.compressed_bytes for record in records),
        "missingFormationArchiveCount": sum(record.state != "VERIFIED" for record in formation),
        "missingOptionalMinuteArchiveCount": sum(
            record.state != "VERIFIED"
            and record.spec.interval == "1m"
            and record.spec.partition in {"DEVELOPMENT", "HOLDOUT"}
            for record in records
        ),
        "missingRequiredDailyArchiveCount": sum(
            record.state != "VERIFIED"
            and record.spec.interval == "1d"
            and record.spec.partition in {"DEVELOPMENT", "HOLDOUT"}
            for record in records
        ),
        "partitionCounts": partition_counts,
        "recordCount": len(records),
        "verifiedArchiveCount": sum(record.state == "VERIFIED" for record in records),
    }
    for key, value in expected_summary.items():
        if acquisition.get(key) != value:
            raise EvidenceError(f"acquisition summary drift: {key}")
    return acquisition, universe, expected_hashes


@dataclass(frozen=True, slots=True, order=True)
class Trial:
    trial_id: str
    loss_threshold_bps: int
    volume_multiple_milli: int
    slots: int

    @property
    def loss_threshold(self) -> Decimal:
        return Decimal(self.loss_threshold_bps) / FEE_BPS_DENOMINATOR

    @property
    def volume_multiple(self) -> Decimal:
        return Decimal(self.volume_multiple_milli) / Decimal(1000)


def trial_family() -> tuple[Trial, ...]:
    trials = tuple(
        Trial(
            trial_id=f"VG3_L{loss:04d}_V{volume:04d}_K{slots:02d}",
            loss_threshold_bps=loss,
            volume_multiple_milli=volume,
            slots=slots,
        )
        for loss in (200, 400, 600)
        for volume in (2000, 4000)
        for slots in (3, 5)
    )
    ordered = tuple(sorted(trials))
    if len(ordered) != 12 or len({trial.trial_id for trial in ordered}) != 12:
        raise EvidenceError("trial family is not exactly twelve unique attempts")
    return ordered


@dataclass(frozen=True, slots=True)
class Candidate:
    symbol: str
    raw_return: Decimal
    idiosyncratic_return: Decimal
    volume_multiple: Decimal


@dataclass(frozen=True, slots=True)
class DailySelection:
    entry_date: date
    symbols: tuple[str, ...]


def build_selections(
    bars: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    entry_dates: Sequence[date],
    trials: Sequence[Trial],
) -> dict[str, tuple[DailySelection, ...]]:
    if len(symbols) != 40:
        raise EvidenceError("signal requires the exact frozen 40-name cross-section")
    output: dict[str, list[DailySelection]] = {trial.trial_id: [] for trial in trials}
    for entry_date in entry_dates:
        signal_day = entry_date - timedelta(days=1)
        previous_day = signal_day - timedelta(days=1)
        raw_returns: dict[str, Decimal] = {}
        volume_multiples: dict[str, Decimal] = {}
        for symbol in symbols:
            series = bars.get(symbol)
            if series is None or signal_day not in series or previous_day not in series:
                raise EvidenceError(f"missing signal price evidence: {symbol} {signal_day}")
            current = series[signal_day]
            previous = series[previous_day]
            trailing_days = tuple(
                signal_day - timedelta(days=offset) for offset in range(20, 0, -1)
            )
            if any(day not in series for day in trailing_days):
                raise EvidenceError(f"missing trailing volume evidence: {symbol} {signal_day}")
            baseline = _decimal_median([series[day].quote_volume for day in trailing_days])
            if baseline <= 0:
                raise EvidenceError(f"non-positive trailing volume baseline: {symbol} {signal_day}")
            raw_returns[symbol] = current.close / previous.close - 1
            volume_multiples[symbol] = current.quote_volume / baseline
        cross_median = _decimal_median(list(raw_returns.values()))
        candidates = tuple(
            Candidate(
                symbol=symbol,
                raw_return=raw_returns[symbol],
                idiosyncratic_return=raw_returns[symbol] - cross_median,
                volume_multiple=volume_multiples[symbol],
            )
            for symbol in symbols
        )
        for trial in trials:
            qualifying = [
                candidate
                for candidate in candidates
                if candidate.raw_return < 0
                and candidate.idiosyncratic_return <= -trial.loss_threshold
                and candidate.volume_multiple >= trial.volume_multiple
            ]
            qualifying.sort(
                key=lambda item: (
                    item.idiosyncratic_return,
                    -item.volume_multiple,
                    item.symbol,
                )
            )
            output[trial.trial_id].append(
                DailySelection(
                    entry_date=entry_date,
                    symbols=tuple(item.symbol for item in qualifying[: trial.slots]),
                )
            )
    return {trial_id: tuple(rows) for trial_id, rows in output.items()}


@dataclass(frozen=True, slots=True)
class CostScenario:
    scenario_id: str
    total_asset_deduction_bps_per_fill: int

    @property
    def rate(self) -> Decimal:
        return Decimal(self.total_asset_deduction_bps_per_fill) / FEE_BPS_DENOMINATOR


PUBLIC_SCENARIO: Final = CostScenario("PUBLIC_FEE_10_BPS_PER_FILL", 10)
STRESS_SCENARIO: Final = CostScenario(
    "STRESS_ALL_IN_ASSET_DEDUCTION_12_BPS_PER_FILL",
    12,
)
SEVERE_SCENARIO: Final = CostScenario(
    "SEVERE_ALL_IN_ASSET_DEDUCTION_20_BPS_PER_FILL",
    20,
)


@dataclass(frozen=True, slots=True)
class ScenarioRun:
    scenario_id: str
    final_nav: Decimal
    net_usd: Decimal
    daily_returns_scaled: tuple[int, ...]
    round_trips: int
    signal_dates: int
    active_weeks: int
    active_symbols: tuple[str, ...]
    maximum_drawdown_bps: Decimal
    drawdown_peak_date: str
    drawdown_trough_date: str
    capacity_every_sleeve_fits: bool
    capacity_p05_headroom: Decimal
    minimum_capacity_usdt: Decimal
    reference_gross_pnl_usd: Decimal
    adverse_execution_gross_pnl_usd: Decimal
    public_fee_terminal_drag_usd: Decimal
    public_fill_commission_quote_value_usd: Decimal
    extra_stress_terminal_drag_usd: Decimal
    one_way_turnover_usd: Decimal

    def compact_mapping(self) -> dict[str, object]:
        return {
            "activeSymbols": len(self.active_symbols),
            "activeWeeks": self.active_weeks,
            "capacityEverySleeveFits": self.capacity_every_sleeve_fits,
            "capacityP05Headroom": decimal_text(self.capacity_p05_headroom),
            "finalNavUsdt": decimal_text(self.final_nav, MONEY_QUANTUM),
            "maximumDrawdownBps": decimal_text(self.maximum_drawdown_bps),
            "netUsdPer1000": decimal_text(self.net_usd, MONEY_QUANTUM),
            "roundTrips": self.round_trips,
            "scenarioId": self.scenario_id,
            "signalDates": self.signal_dates,
        }


def _scaled_rate(value: Decimal) -> int:
    """Apply the protocol-frozen 1e-12 half-even inference quantization."""

    return int((value * STAT_SCALE).to_integral_value(rounding=ROUND_HALF_EVEN))


def _empirical_quantile_decimal(
    values: Sequence[Decimal],
    numerator: int,
    denominator: int,
) -> Decimal:
    if not values:
        raise EvidenceError("quantile requires values")
    ordered = sorted(values)
    index = (numerator * len(ordered) + denominator - 1) // denominator - 1
    return ordered[max(index, 0)]


def simulate(
    trial: Trial,
    selections: Sequence[DailySelection],
    execution: Mapping[str, Mapping[date, ExecutionEvidence]],
    scenario: CostScenario,
) -> ScenarioRun:
    nav = Decimal(1000)
    peak = nav
    peak_date = selections[0].entry_date.isoformat() if selections else "NONE"
    maximum_drawdown_peak_date = peak_date
    trough_date = peak_date
    maximum_drawdown = Decimal(0)
    daily_returns: list[int] = []
    round_trips = 0
    signal_dates = 0
    active_weeks: set[tuple[int, int]] = set()
    active_symbols: set[str] = set()
    capacity_by_window: dict[tuple[str, date], Decimal] = {}
    notional_by_window: dict[tuple[str, date], Decimal] = {}
    reference_gross = Decimal(0)
    adverse_gross = Decimal(0)
    public_fee_terminal_drag = Decimal(0)
    public_fill_commission_quote_value = Decimal(0)
    extra_stress_terminal_drag = Decimal(0)
    turnover = Decimal(0)
    public_rate = Decimal(10) / FEE_BPS_DENOMINATOR

    for row in selections:
        start_nav = nav
        sleeve = start_nav / Decimal(trial.slots)
        cash = start_nav - sleeve * len(row.symbols)
        proceeds_total = cash
        conservative_low_nav = cash
        if row.symbols:
            signal_dates += 1
            iso = row.entry_date.isocalendar()
            active_weeks.add((iso.year, iso.week))
        for symbol in row.symbols:
            by_day = execution.get(symbol)
            if by_day is None or row.entry_date not in by_day:
                raise EvidenceError(
                    f"selected execution evidence missing: {symbol} {row.entry_date}"
                )
            evidence = by_day[row.entry_date]
            gross_quantity = sleeve / evidence.entry_price
            quantity = gross_quantity * (1 - scenario.rate)
            buy_notional = sleeve
            sell_notional = quantity * evidence.exit_price
            proceeds = sell_notional * (1 - scenario.rate)
            proceeds_total += proceeds
            conservative_low_nav += quantity * evidence.holding_low * (1 - scenario.rate)
            reference_gross += sleeve * (evidence.reference_exit / evidence.reference_entry - 1)
            execution_ratio = evidence.exit_price / evidence.entry_price
            adverse_gross += sleeve * (execution_ratio - 1)
            public_fee_fraction = 2 * public_rate - public_rate * public_rate
            total_fee_fraction = 2 * scenario.rate - scenario.rate * scenario.rate
            public_fee_terminal_drag += sleeve * execution_ratio * public_fee_fraction
            public_fill_commission_quote_value += sleeve * public_rate + sell_notional * public_rate
            extra_stress_terminal_drag += (
                sleeve * execution_ratio * (total_fee_fraction - public_fee_fraction)
            )
            turnover += buy_notional + sell_notional
            capacity_windows = (
                (
                    (symbol, row.entry_date),
                    evidence.entry_quote_volume / Decimal(1000),
                    buy_notional,
                ),
                (
                    (symbol, row.entry_date + timedelta(days=1)),
                    evidence.exit_quote_volume / Decimal(1000),
                    sell_notional,
                ),
            )
            for window, capacity, required_notional in capacity_windows:
                prior_capacity = capacity_by_window.get(window)
                if prior_capacity is not None and prior_capacity != capacity:
                    raise EvidenceError(f"same execution window has conflicting capacity: {window}")
                capacity_by_window[window] = capacity
                notional_by_window[window] = (
                    notional_by_window.get(window, Decimal(0)) + required_notional
                )
            round_trips += 1
            active_symbols.add(symbol)
        nav = proceeds_total
        daily_returns.append(_scaled_rate(nav / start_nav - 1))
        low_drawdown = (
            (peak - conservative_low_nav) / peak if conservative_low_nav < peak else Decimal(0)
        )
        close_drawdown = (peak - nav) / peak if nav < peak else Decimal(0)
        if low_drawdown > maximum_drawdown:
            maximum_drawdown = low_drawdown
            maximum_drawdown_peak_date = peak_date
            trough_date = f"{row.entry_date.isoformat()}_CONSERVATIVE_INTRADAY"
        if close_drawdown > maximum_drawdown:
            maximum_drawdown = close_drawdown
            maximum_drawdown_peak_date = peak_date
            trough_date = f"{(row.entry_date + timedelta(days=1)).isoformat()}_EXIT"
        if nav > peak:
            peak = nav
            peak_date = f"{(row.entry_date + timedelta(days=1)).isoformat()}_EXIT"
    if capacity_by_window:
        headrooms = [
            capacity_by_window[window] / notional_by_window[window]
            for window in sorted(capacity_by_window)
        ]
        p05 = _empirical_quantile_decimal(headrooms, 5, 100)
        minimum_capacity = min(capacity_by_window.values())
        every_fits = min(headrooms) >= 1
    else:
        p05 = Decimal(0)
        minimum_capacity = Decimal(0)
        every_fits = False
    return ScenarioRun(
        scenario_id=scenario.scenario_id,
        final_nav=nav,
        net_usd=nav - Decimal(1000),
        daily_returns_scaled=tuple(daily_returns),
        round_trips=round_trips,
        signal_dates=signal_dates,
        active_weeks=len(active_weeks),
        active_symbols=tuple(sorted(active_symbols)),
        maximum_drawdown_bps=maximum_drawdown * 10_000,
        drawdown_peak_date=maximum_drawdown_peak_date,
        drawdown_trough_date=trough_date,
        capacity_every_sleeve_fits=every_fits,
        capacity_p05_headroom=p05,
        minimum_capacity_usdt=minimum_capacity,
        reference_gross_pnl_usd=reference_gross,
        adverse_execution_gross_pnl_usd=adverse_gross,
        public_fee_terminal_drag_usd=public_fee_terminal_drag,
        public_fill_commission_quote_value_usd=public_fill_commission_quote_value,
        extra_stress_terminal_drag_usd=extra_stress_terminal_drag,
        one_way_turnover_usd=turnover,
    )


@dataclass(frozen=True, slots=True)
class TrialRun:
    trial: Trial
    public: ScenarioRun
    stress: ScenarioRun
    severe: ScenarioRun
    break_even_all_in_asset_deduction_bps_per_fill: Decimal


def _terminal_nav_at_rate(
    trial: Trial,
    selections: Sequence[DailySelection],
    execution: Mapping[str, Mapping[date, ExecutionEvidence]],
    rate: Decimal,
) -> Decimal:
    nav = Decimal(1000)
    for row in selections:
        sleeve = nav / Decimal(trial.slots)
        next_nav = nav - sleeve * len(row.symbols)
        for symbol in row.symbols:
            evidence = execution[symbol][row.entry_date]
            quantity = sleeve / evidence.entry_price * (1 - rate)
            next_nav += quantity * evidence.exit_price * (1 - rate)
        nav = next_nav
    return nav


def break_even_all_in_asset_deduction_bps(
    trial: Trial,
    selections: Sequence[DailySelection],
    execution: Mapping[str, Mapping[date, ExecutionEvidence]],
) -> Decimal:
    if _terminal_nav_at_rate(trial, selections, execution, Decimal(0)) <= 1000:
        return Decimal(0)
    low = Decimal(0)
    high = Decimal(1)
    for _ in range(80):
        middle = (low + high) / 2
        if _terminal_nav_at_rate(trial, selections, execution, middle) > 1000:
            low = middle
        else:
            high = middle
    return low * 10_000


def run_trial(
    trial: Trial,
    selections: Sequence[DailySelection],
    execution: Mapping[str, Mapping[date, ExecutionEvidence]],
) -> TrialRun:
    public = simulate(trial, selections, execution, PUBLIC_SCENARIO)
    stress = simulate(trial, selections, execution, STRESS_SCENARIO)
    severe = simulate(trial, selections, execution, SEVERE_SCENARIO)
    return TrialRun(
        trial=trial,
        public=public,
        stress=stress,
        severe=severe,
        break_even_all_in_asset_deduction_bps_per_fill=(
            break_even_all_in_asset_deduction_bps(trial, selections, execution)
        ),
    )


@dataclass(frozen=True, slots=True)
class InferenceRow:
    trial_id: str
    mean_daily_return: Decimal
    local_lcb: Decimal
    simultaneous_95_lcb: Decimal
    simultaneous_n3_lcb: Decimal
    raw_p_value: Fraction
    max_t_p_value: Fraction
    standard_error: Decimal

    def as_mapping(self) -> dict[str, object]:
        return {
            "localOneSided95LowerBps": decimal_text(self.local_lcb * 10_000),
            "maxTAdjustedPValue": fraction_mapping(self.max_t_p_value),
            "meanDailyReturnBps": decimal_text(self.mean_daily_return * 10_000),
            "n3Simultaneous279Of280LowerBps": decimal_text(self.simultaneous_n3_lcb * 10_000),
            "rawPValue": fraction_mapping(self.raw_p_value),
            "simultaneous95LowerBps": decimal_text(self.simultaneous_95_lcb * 10_000),
            "standardErrorBps": decimal_text(self.standard_error * 10_000),
            "trialId": self.trial_id,
        }


@dataclass(frozen=True, slots=True)
class BootstrapFamily:
    block_days: int
    replicates: int
    seed: int
    rows: Mapping[str, InferenceRow]

    def as_mapping(self) -> dict[str, object]:
        return {
            "blockDays": self.block_days,
            "replicates": self.replicates,
            "rows": [self.rows[trial_id].as_mapping() for trial_id in sorted(self.rows)],
            "seed": self.seed,
        }


def _quantile_index(count: int, numerator: int, denominator: int) -> int:
    return max((numerator * count + denominator - 1) // denominator - 1, 0)


def _decimal_from_scaled_fraction(numerator: int, denominator: int) -> Decimal:
    return Decimal(numerator) / Decimal(denominator) / Decimal(STAT_SCALE)


def bootstrap_family(
    matrix: Mapping[str, Sequence[int]],
    *,
    block_days: int,
    replicates: int,
    seed: int,
) -> BootstrapFamily:
    trial_ids = tuple(sorted(matrix))
    if not trial_ids:
        raise EvidenceError("bootstrap matrix is empty")
    row_count = len(matrix[trial_ids[0]])
    if row_count < block_days or row_count % block_days != 0:
        raise EvidenceError("bootstrap row count must be a positive multiple of block length")
    if any(len(matrix[trial_id]) != row_count for trial_id in trial_ids):
        raise EvidenceError("bootstrap matrix is not synchronous")
    sums = [sum(matrix[trial_id]) for trial_id in trial_ids]
    centered: list[list[int]] = [
        [value * row_count - sums[index] for value in matrix[trial_id]]
        for index, trial_id in enumerate(trial_ids)
    ]
    block_sums: list[list[int]] = []
    for values in centered:
        blocks: list[int] = []
        for start in range(row_count):
            blocks.append(sum(values[(start + offset) % row_count] for offset in range(block_days)))
        block_sums.append(blocks)
    draws_needed = row_count // block_days
    rng = random.Random(seed)
    errors = [array("q") for _ in trial_ids]
    for _ in range(replicates):
        starts = tuple(rng.randrange(row_count) for _ in range(draws_needed))
        for index, blocks in enumerate(block_sums):
            value = sum(blocks[start] for start in starts)
            if value < -(2**63) or value >= 2**63:
                raise EvidenceError("bootstrap accumulator exceeded signed 64-bit bound")
            errors[index].append(value)
    se_numerators: list[Decimal] = []
    for error_values in errors:
        squared_sum = sum(value * value for value in error_values)
        variance = Decimal(squared_sum) / Decimal(replicates)
        se_numerators.append(variance.sqrt())
    for index, standard_error_numerator in enumerate(se_numerators):
        if standard_error_numerator == 0 and sums[index] != 0:
            raise EvidenceError("non-zero constant-return trial has undefined inference")

    max_t_values: list[Decimal] = []
    for replicate in range(replicates):
        max_t_values.append(
            max(
                (
                    Decimal(errors[index][replicate]) / se_numerators[index]
                    if se_numerators[index] > 0
                    else Decimal(0)
                )
                for index in range(len(trial_ids))
            )
        )
    max_t_values.sort()
    simultaneous_95_quantile = max_t_values[_quantile_index(replicates, 95, 100)]
    simultaneous_n3_quantile = max_t_values[_quantile_index(replicates, 279, 280)]
    rows: dict[str, InferenceRow] = {}
    for index, trial_id in enumerate(trial_ids):
        ordered_errors = sorted(errors[index])
        local_error = ordered_errors[_quantile_index(replicates, 95, 100)]
        observed_scaled = Decimal(sums[index]) / Decimal(row_count)
        standard_error_scaled = se_numerators[index] / Decimal(row_count * row_count)
        local_lcb = _decimal_from_scaled_fraction(
            sums[index] * row_count - local_error,
            row_count * row_count,
        )
        simultaneous_95_lcb = (
            observed_scaled - simultaneous_95_quantile * standard_error_scaled
        ) / Decimal(STAT_SCALE)
        simultaneous_n3_lcb = (
            observed_scaled - simultaneous_n3_quantile * standard_error_scaled
        ) / Decimal(STAT_SCALE)
        threshold = sums[index] * row_count
        raw_exceedances = sum(value >= threshold for value in errors[index])
        observed_t = (
            Decimal(threshold) / se_numerators[index] if se_numerators[index] > 0 else Decimal(0)
        )
        max_t_exceedances = sum(value >= observed_t for value in max_t_values)
        rows[trial_id] = InferenceRow(
            trial_id=trial_id,
            mean_daily_return=observed_scaled / Decimal(STAT_SCALE),
            local_lcb=local_lcb,
            simultaneous_95_lcb=simultaneous_95_lcb,
            simultaneous_n3_lcb=simultaneous_n3_lcb,
            raw_p_value=Fraction(raw_exceedances + 1, replicates + 1),
            max_t_p_value=Fraction(max_t_exceedances + 1, replicates + 1),
            standard_error=standard_error_scaled / Decimal(STAT_SCALE),
        )
    return BootstrapFamily(
        block_days=block_days,
        replicates=replicates,
        seed=seed,
        rows=rows,
    )


def fraction_mapping(value: Fraction) -> dict[str, object]:
    return {
        "decimal": decimal_text(Decimal(value.numerator) / Decimal(value.denominator)),
        "denominator": value.denominator,
        "numerator": value.numerator,
    }


def holm_decisions(
    p_values: Mapping[str, Fraction],
    *,
    alpha: Fraction = Fraction(5, 100),
) -> dict[str, dict[str, object]]:
    ordered = sorted((value, trial_id) for trial_id, value in p_values.items())
    total = len(ordered)
    latched_failure = False
    selected: set[str] = set()
    thresholds: dict[str, Fraction] = {}
    for index, (value, trial_id) in enumerate(ordered):
        threshold = alpha / (total - index)
        thresholds[trial_id] = threshold
        passes = not latched_failure and value <= threshold
        if not passes:
            latched_failure = True
        else:
            selected.add(trial_id)
    return {
        trial_id: {
            "rawPValue": fraction_mapping(p_values[trial_id]),
            "rejected": trial_id in selected,
            "threshold": fraction_mapping(thresholds[trial_id]),
        }
        for trial_id in sorted(p_values)
    }


def cscv_pbo(matrix: Mapping[str, Sequence[int]]) -> dict[str, object]:
    trial_ids = tuple(sorted(matrix))
    if len(trial_ids) < 2:
        raise EvidenceError("CSCV requires at least two trials")
    row_count = len(matrix[trial_ids[0]])
    if row_count != 224 or any(len(matrix[trial_id]) != row_count for trial_id in trial_ids):
        raise EvidenceError("CSCV requires the exact 224-row synchronous development matrix")
    block_scores = [
        [sum(matrix[trial_id][block * 14 : (block + 1) * 14]) for block in range(16)]
        for trial_id in trial_ids
    ]
    split_count = 0
    underperform_count = 0
    for in_sample in itertools.combinations(range(16), 8):
        split_count += 1
        in_set = frozenset(in_sample)
        out_sample = tuple(block for block in range(16) if block not in in_set)
        in_scores = [sum(row[block] for block in in_sample) for row in block_scores]
        winner = max(range(len(trial_ids)), key=lambda index: (in_scores[index], -index))
        out_scores = [sum(row[block] for block in out_sample) for row in block_scores]
        ordered = sorted(out_scores)
        median_twice = ordered[(len(ordered) - 1) // 2] + ordered[len(ordered) // 2]
        if out_scores[winner] * 2 <= median_twice:
            underperform_count += 1
    if split_count != 12_870:
        raise EvidenceError("CSCV split count drift")
    pbo = Fraction(underperform_count, split_count)
    return {
        "blockCount": 16,
        "blockDays": 14,
        "pbo": fraction_mapping(pbo),
        "role": "DIAGNOSTIC_ONLY",
        "splitCount": split_count,
        "status": "AVAILABLE",
        "underperformCount": underperform_count,
    }


def walk_forward(
    matrix: Mapping[str, Sequence[int]],
    champion_trial_id: str,
) -> dict[str, object]:
    trial_ids = tuple(sorted(matrix))
    folds: list[dict[str, object]] = []
    champion_selected = 0
    champion_positive_validation = 0
    selected_positive_validation = 0
    for fold in range(6):
        training_end = 56 + fold * 28
        purge_index = training_end
        validation_start = purge_index + 1
        validation_end = training_end + 28
        training_scores = {trial_id: sum(matrix[trial_id][:training_end]) for trial_id in trial_ids}
        positive = tuple(trial_id for trial_id in trial_ids if training_scores[trial_id] > 0)
        if positive:
            selected = max(positive, key=lambda item: (training_scores[item], _reverse_id(item)))
            selected_validation_score = sum(matrix[selected][validation_start:validation_end])
        else:
            selected = "CASH"
            selected_validation_score = 0
        champion_validation_score = sum(matrix[champion_trial_id][validation_start:validation_end])
        if selected == champion_trial_id:
            champion_selected += 1
        if champion_validation_score > 0:
            champion_positive_validation += 1
        if selected_validation_score > 0:
            selected_positive_validation += 1
        folds.append(
            {
                "championValidationMeanBps": decimal_text(
                    Decimal(champion_validation_score) / Decimal(27 * STAT_SCALE) * 10_000
                ),
                "championValidationPositive": champion_validation_score > 0,
                "fold": fold + 1,
                "purgedDays": 1,
                "selectedTrialId": selected,
                "selectedValidationMeanBps": decimal_text(
                    Decimal(selected_validation_score) / Decimal(27 * STAT_SCALE) * 10_000
                ),
                "trainingDays": training_end,
                "validationDays": 27,
                "validationPositive": selected_validation_score > 0,
            }
        )
    return {
        "championPositiveValidationFolds": champion_positive_validation,
        "championSelectedFolds": champion_selected,
        "folds": folds,
        "pass": champion_selected >= 3 and selected_positive_validation >= 4,
        "selectedPositiveValidationFolds": selected_positive_validation,
    }


def _reverse_id(value: str) -> tuple[int, ...]:
    return tuple(-ord(character) for character in value)


def _merge_daily_bars(
    *parts: Mapping[str, Mapping[date, Bar]],
) -> dict[str, dict[date, Bar]]:
    merged: dict[str, dict[date, Bar]] = {}
    for part in parts:
        for symbol, rows in part.items():
            target = merged.setdefault(symbol, {})
            for day, bar in rows.items():
                prior = target.get(day)
                if prior is not None and prior != bar:
                    raise EvidenceError(f"overlapping daily sources disagree: {symbol} {day}")
                target[day] = bar
    return merged


def _read_execution_parallel(
    specs: Sequence[ArchiveSpec],
    entry_dates_by_symbol: Mapping[str, Sequence[date]],
    expected_hashes: Mapping[str, tuple[str, str]],
) -> dict[str, dict[date, ExecutionEvidence]]:
    grouped: dict[str, list[ArchiveSpec]] = {}
    for spec in specs:
        entry_dates = entry_dates_by_symbol.get(spec.symbol)
        if not entry_dates:
            continue
        required_days = {
            required_day
            for entry_date in entry_dates
            for required_day in (entry_date, entry_date + timedelta(days=1))
        }
        needed = (
            any(day.strftime("%Y-%m") == spec.period for day in required_days)
            if spec.cadence == "monthly"
            else any(day.isoformat() == spec.period for day in required_days)
        )
        if needed:
            grouped.setdefault(spec.symbol, []).append(spec)
    output: dict[str, dict[date, ExecutionEvidence]] = {}
    if not grouped:
        return output
    with ThreadPoolExecutor(max_workers=min(8, len(grouped))) as executor:
        futures: dict[Future[dict[str, dict[date, ExecutionEvidence]]], str] = {
            executor.submit(
                read_execution_evidence,
                symbol_specs,
                entry_dates_by_symbol[symbol],
                expected_hashes,
            ): symbol
            for symbol, symbol_specs in sorted(grouped.items())
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                parsed = future.result()
            except Exception as error:
                if isinstance(error, EvidenceError):
                    raise
                raise EvidenceError(f"minute parsing failed for {symbol}: {error}") from error
            if tuple(parsed) != (symbol,):
                raise EvidenceError("parallel execution parser returned unexpected symbol set")
            output[symbol] = parsed[symbol]
    return output


def _required_execution_dates(
    selections: Mapping[str, Sequence[DailySelection]],
) -> dict[str, tuple[date, ...]]:
    required: dict[str, set[date]] = {}
    for rows in selections.values():
        for row in rows:
            for symbol in row.symbols:
                required.setdefault(symbol, set()).add(row.entry_date)
    return {symbol: tuple(sorted(entry_dates)) for symbol, entry_dates in sorted(required.items())}


def _scenario_detail(run: ScenarioRun) -> dict[str, object]:
    mapping = run.compact_mapping()
    mapping.update(
        {
            "activeSymbolList": list(run.active_symbols),
            "adverseExecutionGrossPnlUsd": decimal_text(
                run.adverse_execution_gross_pnl_usd, MONEY_QUANTUM
            ),
            "drawdownPeak": run.drawdown_peak_date,
            "drawdownTrough": run.drawdown_trough_date,
            "extraStressTerminalPnlDragUsd": decimal_text(
                run.extra_stress_terminal_drag_usd, MONEY_QUANTUM
            ),
            "minimumPublicPrintCapacityUsdt": decimal_text(
                run.minimum_capacity_usdt, MONEY_QUANTUM
            ),
            "grossTwoWayTurnoverUsd": decimal_text(run.one_way_turnover_usd, MONEY_QUANTUM),
            "publicFeeTerminalPnlDragUsd": decimal_text(
                run.public_fee_terminal_drag_usd, MONEY_QUANTUM
            ),
            "publicFillCommissionQuoteValueUsd": decimal_text(
                run.public_fill_commission_quote_value_usd, MONEY_QUANTUM
            ),
            "referenceGrossPnlUsd": decimal_text(run.reference_gross_pnl_usd, MONEY_QUANTUM),
        }
    )
    return mapping


def _trial_report(
    run: TrialRun,
    primary: BootstrapFamily,
    sensitivity: BootstrapFamily,
    primary_holm: Mapping[str, Mapping[str, object]],
    sensitivity_holm: Mapping[str, Mapping[str, object]],
) -> dict[str, object]:
    trial_id = run.trial.trial_id
    return {
        "breakEvenAllInAssetDeductionBpsPerFill": decimal_text(
            run.break_even_all_in_asset_deduction_bps_per_fill
        ),
        "inference": {
            "primary7Day": primary.rows[trial_id].as_mapping(),
            "sensitivity14Day": sensitivity.rows[trial_id].as_mapping(),
        },
        "parameters": {
            "idiosyncraticLossThresholdBps": run.trial.loss_threshold_bps,
            "portfolioSlots": run.trial.slots,
            "volumeShockMultipleMilli": run.trial.volume_multiple_milli,
        },
        "public": _scenario_detail(run.public),
        "severe": _scenario_detail(run.severe),
        "stress": _scenario_detail(run.stress),
        "trialId": trial_id,
        "multiplicity": {
            "primaryHolm": primary_holm[trial_id],
            "sensitivityHolm": sensitivity_holm[trial_id],
        },
    }


@dataclass(frozen=True, slots=True)
class DevelopmentEvaluation:
    report: dict[str, object]
    passed: bool
    champion: Trial
    champion_run: TrialRun
    bars: Mapping[str, Mapping[date, Bar]]


def evaluate_development(
    symbols: Sequence[str],
    expected_hashes: Mapping[str, tuple[str, str]],
) -> DevelopmentEvaluation:
    entry_dates = date_range(date(2025, 7, 1), date(2026, 2, 10))
    if len(entry_dates) != 224:
        raise EvidenceError("development calendar drift")
    all_specs = development_specs(symbols)
    daily_specs = tuple(spec for spec in all_specs if spec.interval == "1d")
    minute_specs = tuple(spec for spec in all_specs if spec.interval == "1m")
    bars = read_daily_bars(daily_specs, expected_hashes)
    trials = trial_family()
    selections = build_selections(bars, symbols, entry_dates, trials)
    executions = _read_execution_parallel(
        minute_specs,
        _required_execution_dates(selections),
        expected_hashes,
    )
    runs = tuple(run_trial(trial, selections[trial.trial_id], executions) for trial in trials)
    matrix = {run.trial.trial_id: run.stress.daily_returns_scaled for run in runs}
    print("development sources parsed; running synchronized bootstrap", flush=True)
    primary = bootstrap_family(
        matrix,
        block_days=7,
        replicates=65_536,
        seed=BOOTSTRAP_SEEDS["developmentPrimary7Day"],
    )
    sensitivity = bootstrap_family(
        matrix,
        block_days=14,
        replicates=65_536,
        seed=BOOTSTRAP_SEEDS["developmentSensitivity14Day"],
    )
    primary_holm = holm_decisions(
        {trial_id: row.raw_p_value for trial_id, row in primary.rows.items()}
    )
    sensitivity_holm = holm_decisions(
        {trial_id: row.raw_p_value for trial_id, row in sensitivity.rows.items()}
    )
    by_id = {run.trial.trial_id: run for run in runs}
    champion = max(
        trials,
        key=lambda trial: (
            primary.rows[trial.trial_id].simultaneous_95_lcb,
            by_id[trial.trial_id].stress.net_usd,
            _reverse_id(trial.trial_id),
        ),
    )
    champion_run = by_id[champion.trial_id]
    champion_primary = primary.rows[champion.trial_id]
    champion_sensitivity = sensitivity.rows[champion.trial_id]
    walk = walk_forward(matrix, champion.trial_id)
    pbo = cscv_pbo(matrix)
    gates: dict[str, bool] = {
        "capacityProxy": (
            champion_run.public.capacity_every_sleeve_fits
            and champion_run.stress.capacity_every_sleeve_fits
            and champion_run.public.capacity_p05_headroom >= 1
            and champion_run.stress.capacity_p05_headroom >= 1
        ),
        "drawdown": (
            _reported_bps_at_most(
                champion_run.public.maximum_drawdown_bps,
                Decimal(4000),
            )
            and _reported_bps_at_most(
                champion_run.stress.maximum_drawdown_bps,
                Decimal(4000),
            )
        ),
        "holmPrimary": bool(primary_holm[champion.trial_id]["rejected"]),
        "holmSensitivity": bool(sensitivity_holm[champion.trial_id]["rejected"]),
        "localLowerBounds": (
            _reported_rate_bps_positive(champion_primary.local_lcb)
            and _reported_rate_bps_positive(champion_sensitivity.local_lcb)
        ),
        "maxTPrimary": champion_primary.max_t_p_value <= Fraction(5, 100),
        "maxTSensitivity": champion_sensitivity.max_t_p_value <= Fraction(5, 100),
        "n3SimultaneousLowerBounds": (
            _reported_rate_bps_positive(champion_primary.simultaneous_n3_lcb)
            and _reported_rate_bps_positive(champion_sensitivity.simultaneous_n3_lcb)
        ),
        "netPublicPositive": _reported_money_positive(champion_run.public.net_usd),
        "netStressPositive": _reported_money_positive(champion_run.stress.net_usd),
        "sampleFloor": (
            champion_run.stress.round_trips >= 128
            and champion_run.stress.active_weeks >= 16
            and len(champion_run.stress.active_symbols) >= 12
            and champion_run.stress.signal_dates >= 32
        ),
        "scheduledRows": len(champion_run.stress.daily_returns_scaled) == 224,
        "simultaneous95LowerBounds": (
            _reported_rate_bps_positive(champion_primary.simultaneous_95_lcb)
            and _reported_rate_bps_positive(champion_sensitivity.simultaneous_95_lcb)
        ),
        "walkForward": bool(walk["pass"]),
    }
    passed = all(gates.values())
    report: dict[str, object] = {
        "candidateSealEligible": passed,
        "championTrialId": champion.trial_id,
        "gates": gates,
        "inference": {
            "cscvPbo": pbo,
            "primary7Day": primary.as_mapping(),
            "sensitivity14Day": sensitivity.as_mapping(),
        },
        "rows": 224,
        "status": "MEASURED",
        "trialLedger": {
            "attemptedCount": len(trials),
            "globalAttemptCount": "UNKNOWN",
            "globalFamilyMapping": "UNADJUDICATED_IN_CANONICAL_BASE",
            "trials": [
                _trial_report(
                    run,
                    primary,
                    sensitivity,
                    primary_holm,
                    sensitivity_holm,
                )
                for run in runs
            ],
        },
        "walkForward": walk,
    }
    return DevelopmentEvaluation(
        report=report,
        passed=passed,
        champion=champion,
        champion_run=champion_run,
        bars=bars,
    )


def evaluate_holdout(
    symbols: Sequence[str],
    development_bars: Mapping[str, Mapping[date, Bar]],
    champion: Trial,
    expected_hashes: Mapping[str, tuple[str, str]],
) -> tuple[dict[str, object], bool, TrialRun]:
    entry_dates = date_range(date(2026, 2, 11), date(2026, 7, 1))
    if len(entry_dates) != 140:
        raise EvidenceError("holdout calendar drift")
    specs = holdout_specs(symbols)
    holdout_bars = read_daily_bars(
        tuple(spec for spec in specs if spec.interval == "1d"),
        expected_hashes,
    )
    bars = _merge_daily_bars(development_bars, holdout_bars)
    selections = build_selections(bars, symbols, entry_dates, (champion,))
    executions = _read_execution_parallel(
        tuple(spec for spec in specs if spec.interval == "1m"),
        _required_execution_dates(selections),
        expected_hashes,
    )
    run = run_trial(champion, selections[champion.trial_id], executions)
    matrix = {champion.trial_id: run.stress.daily_returns_scaled}
    primary = bootstrap_family(
        matrix,
        block_days=7,
        replicates=65_536,
        seed=BOOTSTRAP_SEEDS["holdoutPrimary7Day"],
    )
    sensitivity = bootstrap_family(
        matrix,
        block_days=14,
        replicates=65_536,
        seed=BOOTSTRAP_SEEDS["holdoutSensitivity14Day"],
    )
    primary_row = primary.rows[champion.trial_id]
    sensitivity_row = sensitivity.rows[champion.trial_id]
    gates: dict[str, bool] = {
        "capacityProxy": (
            run.public.capacity_every_sleeve_fits
            and run.stress.capacity_every_sleeve_fits
            and run.public.capacity_p05_headroom >= 1
            and run.stress.capacity_p05_headroom >= 1
        ),
        "drawdown": (
            _reported_bps_at_most(
                run.public.maximum_drawdown_bps,
                Decimal(4000),
            )
            and _reported_bps_at_most(
                run.stress.maximum_drawdown_bps,
                Decimal(4000),
            )
        ),
        "localLowerBounds": (
            _reported_rate_bps_positive(primary_row.local_lcb)
            and _reported_rate_bps_positive(sensitivity_row.local_lcb)
        ),
        "netPublicPositive": _reported_money_positive(run.public.net_usd),
        "netStressPositive": _reported_money_positive(run.stress.net_usd),
        "sampleFloor": (
            run.stress.round_trips >= 80
            and run.stress.active_weeks >= 12
            and len(run.stress.active_symbols) >= 8
            and run.stress.signal_dates >= 24
        ),
        "scheduledRows": len(run.stress.daily_returns_scaled) == 140,
    }
    passed = all(gates.values())
    report: dict[str, object] = {
        "championTrialId": champion.trial_id,
        "gates": gates,
        "inference": {
            "primary7Day": primary.as_mapping(),
            "sensitivity14Day": sensitivity.as_mapping(),
        },
        "public": _scenario_detail(run.public),
        "rows": 140,
        "severe": _scenario_detail(run.severe),
        "status": "MEASURED",
        "stress": _scenario_detail(run.stress),
    }
    return report, passed, run


def _source_summary(acquisition: Mapping[str, Any]) -> dict[str, object]:
    return {
        "accountEffectiveFee": "UNKNOWN",
        "actualExecutableCapacity": "UNKNOWN",
        "archiveRecordCount": acquisition.get("recordCount"),
        "archiveRecordsSha256": acquisition.get("recordsSha256"),
        "checksumMismatchCount": 0,
        "compressedBytes": acquisition.get("compressedBytes"),
        "entryWindowEndExclusive": "2026-07-01",
        "entryWindowStartInclusive": "2025-07-01",
        "historicalFilters": "UNKNOWN",
        "missingOptionalMinuteArchiveCount": acquisition.get("missingOptionalMinuteArchiveCount"),
        "missingRequiredDailyArchiveCount": acquisition.get("missingRequiredDailyArchiveCount"),
        "privateDataUsed": False,
        "publicFeeBpsPerFill": 10,
        "signedEndpointUsed": False,
        "verifiedArchiveCount": acquisition.get("verifiedArchiveCount"),
    }


def _universe_summary(universe: Mapping[str, Any]) -> dict[str, object]:
    return {
        "asOfUtc": universe.get("asOfUtc"),
        "selectedSymbols": list(_selected_symbols(universe)),
        "selection": "TOP_40_TRAILING_60_DAY_MEDIAN_QUOTE_VOLUME",
        "sealSha256": sha256_file(state_root() / "universe-seal.v1.json"),
    }


def _development_evidence(development: DevelopmentEvaluation) -> dict[str, object]:
    report_digest = sha256_bytes(canonical_json_bytes(development.report))
    return {
        "schema": "VG3DevelopmentEvidenceV1",
        "development": development.report,
        "developmentDigest": report_digest,
        "economics": {
            "developmentPublicNetUsdPer1000": decimal_text(
                development.champion_run.public.net_usd,
                MONEY_QUANTUM,
            ),
            "developmentStressNetUsdPer1000": decimal_text(
                development.champion_run.stress.net_usd,
                MONEY_QUANTUM,
            ),
        },
    }


def _load_development_evidence() -> dict[str, Any] | None:
    path = state_root() / "development-evidence.v1.json"
    if not path.exists():
        return None
    evidence = load_json(path)
    if path.read_bytes() != canonical_json_bytes(evidence):
        raise EvidenceError("development evidence is not canonical JSON")
    require_exact_keys(
        evidence,
        {"development", "developmentDigest", "economics", "schema"},
        "developmentEvidence",
    )
    if evidence.get("schema") != "VG3DevelopmentEvidenceV1":
        raise EvidenceError("development evidence schema mismatch")
    development = require_mapping(
        evidence.get("development"),
        "developmentEvidence.development",
    )
    if evidence.get("developmentDigest") != sha256_bytes(canonical_json_bytes(dict(development))):
        raise EvidenceError("development evidence digest mismatch")
    economics = require_mapping(
        evidence.get("economics"),
        "developmentEvidence.economics",
    )
    require_exact_keys(
        economics,
        {
            "developmentPublicNetUsdPer1000",
            "developmentStressNetUsdPer1000",
        },
        "developmentEvidence.economics",
    )
    require_text(
        economics.get("developmentPublicNetUsdPer1000"),
        "developmentEvidence.developmentPublicNetUsdPer1000",
    )
    require_text(
        economics.get("developmentStressNetUsdPer1000"),
        "developmentEvidence.developmentStressNetUsdPer1000",
    )
    return evidence


def _recover_existing_result() -> dict[str, Any] | None:
    external_path = state_root() / "result.v1.json"
    if not RESULT_PATH.exists() and not external_path.exists():
        return None
    if RESULT_PATH.exists() and not external_path.exists():
        raise EvidenceError("tracked result exists without external one-use result")
    if external_path.exists():
        external = load_json(external_path)
        raw = external_path.read_bytes()
        if raw != canonical_json_bytes(external):
            raise EvidenceError("external result is not canonical JSON")
        if (
            external.get("schema") != "VG3ResultV1"
            or external.get("baseCommit") != BASE_COMMIT
            or external.get("verdict") not in {"GO", "NO_GO", "UNMEASURED"}
        ):
            raise EvidenceError("external result identity mismatch")
        if not RESULT_PATH.exists():
            exclusive_write(RESULT_PATH, raw)
        elif RESULT_PATH.read_bytes() != raw:
            raise EvidenceError("tracked and external results differ")
        return external
    raise AssertionError("unreachable result recovery state")


def _write_result(result: Mapping[str, object]) -> None:
    external_path = state_root() / "result.v1.json"
    if RESULT_PATH.exists() or external_path.exists():
        raise EvidenceError("result already exists; sealed run cannot rerun")
    payload = canonical_json_bytes(dict(result))
    exclusive_write(external_path, payload)
    exclusive_write(RESULT_PATH, payload)


def _missing_required_daily_identities(
    acquisition: Mapping[str, Any],
) -> tuple[str, ...]:
    identities: list[str] = []
    for raw_record in require_list(acquisition.get("records"), "acquisition.records"):
        record = require_mapping(raw_record, "acquisition.records[]")
        if (
            record.get("partition") in {"DEVELOPMENT", "HOLDOUT"}
            and record.get("interval") == "1d"
            and record.get("state") != "VERIFIED"
        ):
            identities.append(
                ":".join(
                    (
                        require_text(record.get("partition"), "record.partition"),
                        require_text(record.get("cadence"), "record.cadence").upper(),
                        "1d",
                        require_text(record.get("symbol"), "record.symbol"),
                        require_text(record.get("period"), "record.period"),
                    )
                )
            )
    return tuple(sorted(identities))


def _terminal_unmeasured(
    reason: str,
    detail: str,
    *,
    acquisition: Mapping[str, Any],
    universe: Mapping[str, Any],
    development_evidence: Mapping[str, Any] | None,
) -> dict[str, object]:
    bounded_detail = detail[:500]
    candidate_path = state_root() / "candidate-seal.v1.json"
    development_path = state_root() / "development-evidence.v1.json"
    if development_evidence is None:
        development: dict[str, object] = {"status": "UNMEASURED"}
        economics: dict[str, object] = {
            "developmentPublicNetUsdPer1000": "UNKNOWN",
            "developmentStressNetUsdPer1000": "UNKNOWN",
            "headlineNetEdgeUsdPer1000": "UNKNOWN",
            "publicFeeProxy": "10_BPS_PER_FILL",
        }
        development_digest = "UNAVAILABLE"
        development_evidence_digest = "UNAVAILABLE"
    else:
        development = dict(
            require_mapping(
                development_evidence.get("development"),
                "developmentEvidence.development",
            )
        )
        preserved_economics = require_mapping(
            development_evidence.get("economics"),
            "developmentEvidence.economics",
        )
        public_net = require_text(
            preserved_economics.get("developmentPublicNetUsdPer1000"),
            "developmentEvidence.developmentPublicNetUsdPer1000",
        )
        stress_net = require_text(
            preserved_economics.get("developmentStressNetUsdPer1000"),
            "developmentEvidence.developmentStressNetUsdPer1000",
        )
        economics = {
            "developmentPublicNetUsdPer1000": public_net,
            "developmentStressNetUsdPer1000": stress_net,
            "headlineNetEdgeUsdPer1000": stress_net,
            "publicFeeProxy": "10_BPS_PER_FILL",
        }
        development_digest = require_text(
            development_evidence.get("developmentDigest"),
            "developmentEvidence.developmentDigest",
        )
        development_evidence_digest = sha256_file(development_path)
    result: dict[str, object] = {
        "schema": "VG3ResultV1",
        "authority": {
            "capital": "NONE",
            "orders": "NONE",
            "privateRead": "NONE",
        },
        "baseCommit": BASE_COMMIT,
        "consumer": "N3_PROFITABILITY_VERDICT",
        "development": development,
        "economics": economics,
        "evidence": {
            "acquisitionReceiptSha256": sha256_file(state_root() / "acquisition.v1.json"),
            "candidateSealSha256": (
                sha256_file(candidate_path) if candidate_path.exists() else "UNAVAILABLE"
            ),
            "developmentDigest": development_digest,
            "developmentEvidenceSha256": development_evidence_digest,
            "freezeReceiptSha256": sha256_file(FREEZE_PATH),
            "holdoutDigest": "UNAVAILABLE",
            "universeSealSha256": sha256_file(state_root() / "universe-seal.v1.json"),
        },
        "holdout": {
            "opened": (state_root() / "holdout-opened.v1.json").exists(),
            "status": "UNMEASURED",
        },
        "n3ProfitabilityStatus": "UNKNOWN",
        "reasonCodes": [reason],
        "reasonDetail": bounded_detail,
        "resultCreatedAtUtc": utc_now_text(),
        "sourceTruth": _source_summary(acquisition),
        "universe": _universe_summary(universe),
        "verdict": "UNMEASURED",
    }
    _write_result(result)
    return result


def run_sealed_experiment() -> dict[str, object]:
    external_result_path = state_root() / "result.v1.json"
    if RESULT_PATH.exists() or external_result_path.exists():
        tracked_preexisted = RESULT_PATH.exists()
        verify_acquisition()
        recovered = _recover_existing_result()
        if recovered is None:
            raise AssertionError("result recovery unexpectedly returned no result")
        try:
            return cast(
                dict[str, object],
                verify_result(require_terminal_commit=False),
            )
        except Exception:
            if not tracked_preexisted and RESULT_PATH.exists():
                RESULT_PATH.unlink()
                _fsync_directory(RESULT_PATH.parent)
            raise
    acquisition, universe, expected_hashes = verify_acquisition()
    symbols = _selected_symbols(universe)
    development_marker_path = state_root() / "development-opened.v1.json"
    development_evidence_path = state_root() / "development-evidence.v1.json"
    candidate_path = state_root() / "candidate-seal.v1.json"
    holdout_marker_path = state_root() / "holdout-opened.v1.json"
    if development_marker_path.exists():
        interrupted_evidence = _load_development_evidence()
        return _terminal_unmeasured(
            "INTERRUPTED_AFTER_DEVELOPMENT_OPEN",
            "one-use development marker existed without a terminal result; "
            "outcomes were not reopened",
            acquisition=acquisition,
            universe=universe,
            development_evidence=interrupted_evidence,
        )
    unexpected_state = tuple(
        path.name
        for path in (development_evidence_path, candidate_path, holdout_marker_path)
        if path.exists()
    )
    if unexpected_state:
        return _terminal_unmeasured(
            "ONE_USE_STATE_INCONSISTENT",
            f"one-use files existed before development marker: {unexpected_state}",
            acquisition=acquisition,
            universe=universe,
            development_evidence=None,
        )
    missing_required = _missing_required_daily_identities(acquisition)
    if missing_required:
        return _terminal_unmeasured(
            "REQUIRED_DAILY_ARCHIVE_MISSING",
            f"{len(missing_required)} required public daily archives were absent; "
            f"first={missing_required[0]}; development and holdout remained unopened",
            acquisition=acquisition,
            universe=universe,
            development_evidence=None,
        )
    marker: dict[str, object] = {
        "schema": "VG3DevelopmentOpenMarkerV1",
        "acquisitionRecordsSha256": acquisition["recordsSha256"],
        "freezeReceiptSha256": sha256_file(FREEZE_PATH),
        "openedAtUtc": utc_now_text(),
        "oneUse": True,
        "protocolCommit": load_json(FREEZE_PATH)["protocolCommit"],
    }
    exclusive_write(development_marker_path, canonical_json_bytes(marker))
    preserved: dict[str, Any] | None = None
    try:
        development = evaluate_development(symbols, expected_hashes)
        preserved = cast(dict[str, Any], _development_evidence(development))
        exclusive_write(
            development_evidence_path,
            canonical_json_bytes(preserved),
        )
        development_digest = require_text(
            preserved.get("developmentDigest"),
            "developmentEvidence.developmentDigest",
        )
        development_evidence_digest = sha256_file(development_evidence_path)
        if not development.passed:
            result: dict[str, object] = {
                "schema": "VG3ResultV1",
                "authority": {
                    "capital": "NONE",
                    "orders": "NONE",
                    "privateRead": "NONE",
                },
                "baseCommit": BASE_COMMIT,
                "consumer": "N3_PROFITABILITY_VERDICT",
                "development": development.report,
                "economics": {
                    "developmentPublicNetUsdPer1000": decimal_text(
                        development.champion_run.public.net_usd, MONEY_QUANTUM
                    ),
                    "developmentStressNetUsdPer1000": decimal_text(
                        development.champion_run.stress.net_usd, MONEY_QUANTUM
                    ),
                    "headlineNetEdgeUsdPer1000": decimal_text(
                        development.champion_run.stress.net_usd, MONEY_QUANTUM
                    ),
                    "publicFeeProxy": "10_BPS_PER_FILL",
                },
                "evidence": {
                    "acquisitionReceiptSha256": sha256_file(state_root() / "acquisition.v1.json"),
                    "developmentDigest": development_digest,
                    "developmentEvidenceSha256": development_evidence_digest,
                    "freezeReceiptSha256": sha256_file(FREEZE_PATH),
                    "universeSealSha256": sha256_file(state_root() / "universe-seal.v1.json"),
                },
                "holdout": {
                    "opened": False,
                    "reason": "DEVELOPMENT_GATES_FAILED",
                    "status": "UNOPENED",
                },
                "n3ProfitabilityStatus": "NO_GO",
                "reasonCodes": [
                    name
                    for name, passed in cast(dict[str, bool], development.report["gates"]).items()
                    if not passed
                ],
                "resultCreatedAtUtc": utc_now_text(),
                "sourceTruth": _source_summary(acquisition),
                "universe": _universe_summary(universe),
                "verdict": "NO_GO",
            }
            _write_result(result)
            return result

        candidate_seal: dict[str, object] = {
            "schema": "VG3CandidateSealV1",
            "championTrialId": development.champion.trial_id,
            "developmentDigest": development_digest,
            "developmentEvidenceSha256": development_evidence_digest,
            "sealedAtUtc": utc_now_text(),
        }
        exclusive_write(candidate_path, canonical_json_bytes(candidate_seal))
        holdout_marker: dict[str, object] = {
            "schema": "VG3HoldoutOpenMarkerV1",
            "candidateSealSha256": sha256_file(candidate_path),
            "openedAtUtc": utc_now_text(),
            "oneUse": True,
        }
        exclusive_write(
            holdout_marker_path,
            canonical_json_bytes(holdout_marker),
        )
        holdout_report, holdout_passed, holdout_run = evaluate_holdout(
            symbols,
            development.bars,
            development.champion,
            expected_hashes,
        )
        verdict = "GO" if holdout_passed else "NO_GO"
        n3_status = (
            "UNKNOWN_PENDING_GLOBAL_FAMILY_ACCOUNT_EXECUTION_AND_FRESH_FORWARD"
            if holdout_passed
            else "NO_GO"
        )
        result = {
            "schema": "VG3ResultV1",
            "authority": {
                "capital": "NONE",
                "orders": "NONE",
                "privateRead": "NONE",
            },
            "baseCommit": BASE_COMMIT,
            "consumer": "N3_PROFITABILITY_VERDICT",
            "development": development.report,
            "economics": {
                "developmentPublicNetUsdPer1000": decimal_text(
                    development.champion_run.public.net_usd, MONEY_QUANTUM
                ),
                "developmentStressNetUsdPer1000": decimal_text(
                    development.champion_run.stress.net_usd, MONEY_QUANTUM
                ),
                "headlineNetEdgeUsdPer1000": decimal_text(
                    holdout_run.stress.net_usd, MONEY_QUANTUM
                ),
                "holdoutPublicNetUsdPer1000": decimal_text(
                    holdout_run.public.net_usd, MONEY_QUANTUM
                ),
                "holdoutStressNetUsdPer1000": decimal_text(
                    holdout_run.stress.net_usd, MONEY_QUANTUM
                ),
                "publicFeeProxy": "10_BPS_PER_FILL",
            },
            "evidence": {
                "acquisitionReceiptSha256": sha256_file(state_root() / "acquisition.v1.json"),
                "candidateSealSha256": sha256_file(candidate_path),
                "developmentDigest": development_digest,
                "developmentEvidenceSha256": development_evidence_digest,
                "freezeReceiptSha256": sha256_file(FREEZE_PATH),
                "holdoutDigest": sha256_bytes(canonical_json_bytes(holdout_report)),
                "universeSealSha256": sha256_file(state_root() / "universe-seal.v1.json"),
            },
            "holdout": holdout_report,
            "n3ProfitabilityStatus": n3_status,
            "reasonCodes": (
                []
                if holdout_passed
                else [
                    name
                    for name, passed in cast(dict[str, bool], holdout_report["gates"]).items()
                    if not passed
                ]
            ),
            "resultCreatedAtUtc": utc_now_text(),
            "sourceTruth": _source_summary(acquisition),
            "universe": _universe_summary(universe),
            "verdict": verdict,
        }
        _write_result(result)
        return result
    except Exception as error:
        if RESULT_PATH.exists() or (state_root() / "result.v1.json").exists():
            raise
        if isinstance(error, EvidenceError):
            return _terminal_unmeasured(
                "EVIDENCE_OR_EVALUATION_INVALID",
                str(error),
                acquisition=acquisition,
                universe=universe,
                development_evidence=preserved,
            )
        return _terminal_unmeasured(
            "UNEXPECTED_EVALUATOR_FAILURE",
            f"{type(error).__name__}: {error}",
            acquisition=acquisition,
            universe=universe,
            development_evidence=preserved,
        )


def _boolean_gates(value: object, field: str) -> dict[str, bool]:
    raw = require_mapping(value, field)
    if not raw:
        raise EvidenceError(f"{field} may not be empty")
    gates: dict[str, bool] = {}
    for name, passed in raw.items():
        if not isinstance(passed, bool):
            raise EvidenceError(f"{field}.{name} must be boolean")
        gates[name] = passed
    return gates


def _reason_codes(value: object) -> list[str]:
    raw = require_list(value, "result.reasonCodes")
    codes = [require_text(item, "result.reasonCodes[]") for item in raw]
    if len(codes) != len(set(codes)):
        raise EvidenceError("result reason codes may not repeat")
    return codes


def _development_champion(
    development: Mapping[str, Any],
) -> tuple[str, Mapping[str, Any], dict[str, bool]]:
    if development.get("status") != "MEASURED":
        raise EvidenceError("measured verdict requires measured development")
    gates = _boolean_gates(development.get("gates"), "development.gates")
    if development.get("candidateSealEligible") != all(gates.values()):
        raise EvidenceError("development eligibility contradicts its gates")
    champion_id = require_text(
        development.get("championTrialId"),
        "development.championTrialId",
    )
    ledger = require_mapping(development.get("trialLedger"), "development.trialLedger")
    if (
        ledger.get("attemptedCount") != 12
        or ledger.get("globalAttemptCount") != "UNKNOWN"
        or ledger.get("globalFamilyMapping") != "UNADJUDICATED_IN_CANONICAL_BASE"
    ):
        raise EvidenceError("development trial ledger identity mismatch")
    trial_values = require_list(ledger.get("trials"), "development.trialLedger.trials")
    trials = [require_mapping(value, "development.trialLedger.trials[]") for value in trial_values]
    ids = [require_text(trial.get("trialId"), "trial.trialId") for trial in trials]
    expected_ids = [trial.trial_id for trial in trial_family()]
    if len(ids) != 12 or sorted(ids) != sorted(expected_ids) or len(ids) != len(set(ids)):
        raise EvidenceError("development trial family differs from preregistration")
    champion_matches = [trial for trial in trials if trial.get("trialId") == champion_id]
    if len(champion_matches) != 1:
        raise EvidenceError("development champion is absent or duplicated")
    return champion_id, champion_matches[0], gates


def _verify_development_open_marker(acquisition: Mapping[str, Any]) -> bool:
    marker_path = state_root() / "development-opened.v1.json"
    if not marker_path.exists():
        return False
    marker = load_json(marker_path)
    if marker_path.read_bytes() != canonical_json_bytes(marker):
        raise EvidenceError("development marker is not canonical JSON")
    require_exact_keys(
        marker,
        {
            "acquisitionRecordsSha256",
            "freezeReceiptSha256",
            "oneUse",
            "openedAtUtc",
            "protocolCommit",
            "schema",
        },
        "developmentMarker",
    )
    freeze = load_json(FREEZE_PATH)
    if (
        marker.get("schema") != "VG3DevelopmentOpenMarkerV1"
        or marker.get("oneUse") is not True
        or marker.get("acquisitionRecordsSha256") != acquisition.get("recordsSha256")
        or marker.get("freezeReceiptSha256") != sha256_file(FREEZE_PATH)
        or marker.get("protocolCommit") != freeze.get("protocolCommit")
    ):
        raise EvidenceError("development marker binding mismatch")
    require_text(marker.get("openedAtUtc"), "developmentMarker.openedAtUtc")
    return True


def _verify_candidate_seal(
    *,
    champion_id: str,
    development_digest: str,
    development_evidence_digest: str,
) -> dict[str, Any]:
    candidate_path = state_root() / "candidate-seal.v1.json"
    if not candidate_path.exists():
        raise EvidenceError("candidate seal is missing")
    candidate = load_json(candidate_path)
    if candidate_path.read_bytes() != canonical_json_bytes(candidate):
        raise EvidenceError("candidate seal is not canonical JSON")
    require_exact_keys(
        candidate,
        {
            "championTrialId",
            "developmentDigest",
            "developmentEvidenceSha256",
            "schema",
            "sealedAtUtc",
        },
        "candidateSeal",
    )
    if (
        candidate.get("schema") != "VG3CandidateSealV1"
        or candidate.get("championTrialId") != champion_id
        or candidate.get("developmentDigest") != development_digest
        or candidate.get("developmentEvidenceSha256") != development_evidence_digest
    ):
        raise EvidenceError("candidate seal binding mismatch")
    require_text(candidate.get("sealedAtUtc"), "candidateSeal.sealedAtUtc")
    return candidate


def _verify_candidate_and_holdout_markers(
    *,
    champion_id: str,
    development_digest: str,
    development_evidence_digest: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    candidate = _verify_candidate_seal(
        champion_id=champion_id,
        development_digest=development_digest,
        development_evidence_digest=development_evidence_digest,
    )
    candidate_path = state_root() / "candidate-seal.v1.json"
    holdout_marker_path = state_root() / "holdout-opened.v1.json"
    if not holdout_marker_path.exists():
        raise EvidenceError("measured holdout requires holdout marker")
    marker = load_json(holdout_marker_path)
    if holdout_marker_path.read_bytes() != canonical_json_bytes(marker):
        raise EvidenceError("holdout marker is not canonical JSON")
    require_exact_keys(
        marker,
        {"candidateSealSha256", "oneUse", "openedAtUtc", "schema"},
        "holdoutMarker",
    )
    if (
        marker.get("schema") != "VG3HoldoutOpenMarkerV1"
        or marker.get("oneUse") is not True
        or marker.get("candidateSealSha256") != sha256_file(candidate_path)
    ):
        raise EvidenceError("holdout marker binding mismatch")
    require_text(marker.get("openedAtUtc"), "holdoutMarker.openedAtUtc")
    return candidate, marker


def _verify_sha256_manifest() -> None:
    paths = (
        SOURCE_RESEARCH_PATH,
        README_PATH,
        SCRIPT_PATH,
        PROTOCOL_PATH,
        SOURCE_RECEIPTS_PATH,
        TEST_PATH,
        FREEZE_PATH,
        RESULT_PATH,
    )
    expected = "".join(
        f"{sha256_file(path)}  {path.name}\n" for path in sorted(paths, key=lambda item: item.name)
    ).encode("ascii")
    if not SHA256SUMS_PATH.exists() or SHA256SUMS_PATH.read_bytes() != expected:
        raise EvidenceError("SHA256SUMS is missing or differs from tracked V-G3 artifacts")
    if git_blob_at_head("quant/research/vg3/SHA256SUMS") != expected:
        raise EvidenceError("SHA256SUMS must be committed unchanged")


def verify_result(*, require_terminal_commit: bool = True) -> dict[str, Any]:
    verify_freeze()
    acquisition, universe, expected_hashes = verify_acquisition()
    if not RESULT_PATH.exists():
        raise EvidenceError("tracked result does not exist")
    raw = RESULT_PATH.read_bytes()
    result = load_json(RESULT_PATH)
    if raw != canonical_json_bytes(result):
        raise EvidenceError("result is not canonical JSON")
    if result.get("schema") != "VG3ResultV1" or result.get("baseCommit") != BASE_COMMIT:
        raise EvidenceError("result identity mismatch")
    verdict = result.get("verdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise EvidenceError("invalid terminal verdict")
    common_keys = {
        "authority",
        "baseCommit",
        "consumer",
        "development",
        "economics",
        "evidence",
        "holdout",
        "n3ProfitabilityStatus",
        "reasonCodes",
        "resultCreatedAtUtc",
        "schema",
        "sourceTruth",
        "universe",
        "verdict",
    }
    if verdict == "UNMEASURED":
        common_keys.add("reasonDetail")
    require_exact_keys(result, common_keys, "result")
    if result.get("authority") != {
        "capital": "NONE",
        "orders": "NONE",
        "privateRead": "NONE",
    }:
        raise EvidenceError("result authority must remain NONE")
    if result.get("consumer") != "N3_PROFITABILITY_VERDICT":
        raise EvidenceError("result consumer mismatch")
    require_text(result.get("resultCreatedAtUtc"), "result.resultCreatedAtUtc")
    external = state_root() / "result.v1.json"
    if not external.exists() or external.read_bytes() != raw:
        raise EvidenceError("tracked and external results differ")

    if result.get("sourceTruth") != _source_summary(acquisition):
        raise EvidenceError("result source truth differs from acquisition")
    if result.get("universe") != _universe_summary(universe):
        raise EvidenceError("result universe differs from sealed universe")
    evidence = require_mapping(result.get("evidence"), "result.evidence")
    if evidence.get("acquisitionReceiptSha256") != sha256_file(
        state_root() / "acquisition.v1.json"
    ):
        raise EvidenceError("result acquisition receipt digest mismatch")
    if evidence.get("freezeReceiptSha256") != sha256_file(FREEZE_PATH):
        raise EvidenceError("result freeze receipt digest mismatch")
    if evidence.get("universeSealSha256") != sha256_file(state_root() / "universe-seal.v1.json"):
        raise EvidenceError("result universe receipt digest mismatch")

    development_marker_opened = _verify_development_open_marker(acquisition)
    holdout = require_mapping(result.get("holdout"), "result.holdout")
    holdout_opened = (state_root() / "holdout-opened.v1.json").exists()
    if bool(holdout.get("opened", holdout.get("status") == "MEASURED")) != holdout_opened:
        raise EvidenceError("holdout marker and result disagree")
    reason_codes = _reason_codes(result.get("reasonCodes"))
    development = require_mapping(result.get("development"), "result.development")
    economics = require_mapping(result.get("economics"), "result.economics")
    recomputed_development: DevelopmentEvaluation | None = None
    if development.get("status") == "MEASURED":
        recomputed_development = evaluate_development(
            _selected_symbols(universe),
            expected_hashes,
        )
        if recomputed_development.report != development:
            raise EvidenceError(
                "tracked development differs from deterministic sealed-source recomputation"
            )

    if verdict == "UNMEASURED":
        require_exact_keys(
            economics,
            {
                "developmentPublicNetUsdPer1000",
                "developmentStressNetUsdPer1000",
                "headlineNetEdgeUsdPer1000",
                "publicFeeProxy",
            },
            "result.economics",
        )
        require_exact_keys(
            evidence,
            {
                "acquisitionReceiptSha256",
                "candidateSealSha256",
                "developmentDigest",
                "developmentEvidenceSha256",
                "freezeReceiptSha256",
                "holdoutDigest",
                "universeSealSha256",
            },
            "result.evidence",
        )
        if (
            not reason_codes
            or result.get("n3ProfitabilityStatus") != "UNKNOWN"
            or holdout.get("status") != "UNMEASURED"
            or evidence.get("holdoutDigest") != "UNAVAILABLE"
        ):
            raise EvidenceError("UNMEASURED terminal semantics mismatch")
        detail = require_text(result.get("reasonDetail"), "result.reasonDetail")
        if len(detail) > 500:
            raise EvidenceError("UNMEASURED reason detail exceeds bound")
        if development.get("status") == "MEASURED":
            champion_id, champion, _ = _development_champion(development)
            development_digest = sha256_bytes(canonical_json_bytes(dict(development)))
            development_evidence = _load_development_evidence()
            if development_evidence is None:
                raise EvidenceError("measured development evidence is missing")
            if (
                evidence.get("developmentDigest") != development_digest
                or evidence.get("developmentEvidenceSha256")
                != sha256_file(state_root() / "development-evidence.v1.json")
                or development_evidence.get("development") != development
            ):
                raise EvidenceError("UNMEASURED preserved development binding mismatch")
            champion_stress = require_mapping(
                champion.get("stress"),
                "champion.stress",
            )
            champion_public = require_mapping(
                champion.get("public"),
                "champion.public",
            )
            if (
                economics.get("developmentPublicNetUsdPer1000")
                != champion_public.get("netUsdPer1000")
                or economics.get("developmentStressNetUsdPer1000")
                != champion_stress.get("netUsdPer1000")
                or economics.get("headlineNetEdgeUsdPer1000")
                != champion_stress.get("netUsdPer1000")
            ):
                raise EvidenceError("UNMEASURED preserved economics mismatch")
            if (state_root() / "candidate-seal.v1.json").exists():
                _verify_candidate_seal(
                    champion_id=champion_id,
                    development_digest=development_digest,
                    development_evidence_digest=require_text(
                        evidence.get("developmentEvidenceSha256"),
                        "evidence.developmentEvidenceSha256",
                    ),
                )
            if holdout_opened:
                _verify_candidate_and_holdout_markers(
                    champion_id=champion_id,
                    development_digest=development_digest,
                    development_evidence_digest=require_text(
                        evidence.get("developmentEvidenceSha256"),
                        "evidence.developmentEvidenceSha256",
                    ),
                )
        else:
            if development != {"status": "UNMEASURED"}:
                raise EvidenceError("UNMEASURED development shape mismatch")
            if holdout_opened and reason_codes != ["ONE_USE_STATE_INCONSISTENT"]:
                raise EvidenceError("holdout marker exists without measured development")
            if (
                evidence.get("developmentDigest") != "UNAVAILABLE"
                or evidence.get("developmentEvidenceSha256") != "UNAVAILABLE"
                or economics.get("developmentPublicNetUsdPer1000") != "UNKNOWN"
                or economics.get("developmentStressNetUsdPer1000") != "UNKNOWN"
                or economics.get("headlineNetEdgeUsdPer1000") != "UNKNOWN"
            ):
                raise EvidenceError("UNMEASURED unknown economics mismatch")
        candidate_path = state_root() / "candidate-seal.v1.json"
        expected_candidate_digest = (
            sha256_file(candidate_path) if candidate_path.exists() else "UNAVAILABLE"
        )
        if evidence.get("candidateSealSha256") != expected_candidate_digest:
            raise EvidenceError("UNMEASURED candidate digest mismatch")
        if reason_codes == ["REQUIRED_DAILY_ARCHIVE_MISSING"]:
            missing_required = _missing_required_daily_identities(acquisition)
            forbidden_state = (
                state_root() / "development-evidence.v1.json",
                state_root() / "candidate-seal.v1.json",
                state_root() / "holdout-opened.v1.json",
            )
            if (
                development_marker_opened
                or not missing_required
                or acquisition.get("missingRequiredDailyArchiveCount") != len(missing_required)
                or any(path.exists() for path in forbidden_state)
            ):
                raise EvidenceError("required-source UNMEASURED custody mismatch")
        elif reason_codes == ["ONE_USE_STATE_INCONSISTENT"]:
            inconsistent_paths = (
                state_root() / "development-evidence.v1.json",
                state_root() / "candidate-seal.v1.json",
                state_root() / "holdout-opened.v1.json",
            )
            if development_marker_opened or not any(path.exists() for path in inconsistent_paths):
                raise EvidenceError("one-use-state UNMEASURED custody mismatch")
        elif not development_marker_opened:
            raise EvidenceError("UNMEASURED result lacks development-open marker")
    else:
        if not development_marker_opened:
            raise EvidenceError("measured result requires development-open marker")
        champion_id, champion, development_gates = _development_champion(development)
        development_digest = sha256_bytes(canonical_json_bytes(dict(development)))
        development_evidence = _load_development_evidence()
        if development_evidence is None:
            raise EvidenceError("measured development evidence is missing")
        require_exact_keys(
            evidence,
            (
                {
                    "acquisitionReceiptSha256",
                    "candidateSealSha256",
                    "developmentDigest",
                    "developmentEvidenceSha256",
                    "freezeReceiptSha256",
                    "holdoutDigest",
                    "universeSealSha256",
                }
                if holdout.get("status") == "MEASURED"
                else {
                    "acquisitionReceiptSha256",
                    "developmentDigest",
                    "developmentEvidenceSha256",
                    "freezeReceiptSha256",
                    "universeSealSha256",
                }
            ),
            "result.evidence",
        )
        if (
            evidence.get("developmentDigest") != development_digest
            or evidence.get("developmentEvidenceSha256")
            != sha256_file(state_root() / "development-evidence.v1.json")
            or development_evidence.get("development") != development
        ):
            raise EvidenceError("measured development binding mismatch")
        champion_public = require_mapping(champion.get("public"), "champion.public")
        champion_stress = require_mapping(champion.get("stress"), "champion.stress")
        if economics.get("developmentPublicNetUsdPer1000") != champion_public.get(
            "netUsdPer1000"
        ) or economics.get("developmentStressNetUsdPer1000") != champion_stress.get(
            "netUsdPer1000"
        ):
            raise EvidenceError("development economics contradict trial ledger")

        if holdout.get("status") == "UNOPENED":
            require_exact_keys(
                economics,
                {
                    "developmentPublicNetUsdPer1000",
                    "developmentStressNetUsdPer1000",
                    "headlineNetEdgeUsdPer1000",
                    "publicFeeProxy",
                },
                "result.economics",
            )
            if holdout != {
                "opened": False,
                "reason": "DEVELOPMENT_GATES_FAILED",
                "status": "UNOPENED",
            }:
                raise EvidenceError("development NO_GO holdout shape mismatch")
            if (
                verdict != "NO_GO"
                or all(development_gates.values())
                or holdout_opened
                or (state_root() / "candidate-seal.v1.json").exists()
                or result.get("n3ProfitabilityStatus") != "NO_GO"
                or economics.get("headlineNetEdgeUsdPer1000")
                != champion_stress.get("netUsdPer1000")
                or set(reason_codes)
                != {name for name, passed in development_gates.items() if not passed}
            ):
                raise EvidenceError("development NO_GO semantics mismatch")
        elif holdout.get("status") == "MEASURED":
            require_exact_keys(
                economics,
                {
                    "developmentPublicNetUsdPer1000",
                    "developmentStressNetUsdPer1000",
                    "headlineNetEdgeUsdPer1000",
                    "holdoutPublicNetUsdPer1000",
                    "holdoutStressNetUsdPer1000",
                    "publicFeeProxy",
                },
                "result.economics",
            )
            if not all(development_gates.values()):
                raise EvidenceError("holdout opened despite failed development gate")
            development_evidence_digest = require_text(
                evidence.get("developmentEvidenceSha256"),
                "evidence.developmentEvidenceSha256",
            )
            candidate, _ = _verify_candidate_and_holdout_markers(
                champion_id=champion_id,
                development_digest=development_digest,
                development_evidence_digest=development_evidence_digest,
            )
            if evidence.get("candidateSealSha256") != sha256_bytes(canonical_json_bytes(candidate)):
                raise EvidenceError("result candidate seal digest mismatch")
            holdout_digest = sha256_bytes(canonical_json_bytes(dict(holdout)))
            if evidence.get("holdoutDigest") != holdout_digest:
                raise EvidenceError("result holdout digest mismatch")
            if holdout.get("championTrialId") != champion_id:
                raise EvidenceError("holdout used a different champion")
            holdout_gates = _boolean_gates(holdout.get("gates"), "holdout.gates")
            passed = all(holdout_gates.values())
            expected_verdict = "GO" if passed else "NO_GO"
            expected_n3 = (
                "UNKNOWN_PENDING_GLOBAL_FAMILY_ACCOUNT_EXECUTION_AND_FRESH_FORWARD"
                if passed
                else "NO_GO"
            )
            holdout_public = require_mapping(holdout.get("public"), "holdout.public")
            holdout_stress = require_mapping(holdout.get("stress"), "holdout.stress")
            if recomputed_development is None:
                raise AssertionError("measured holdout lacks recomputed development")
            recomputed_holdout, recomputed_passed, recomputed_run = evaluate_holdout(
                _selected_symbols(universe),
                recomputed_development.bars,
                recomputed_development.champion,
                expected_hashes,
            )
            if (
                recomputed_holdout != holdout
                or recomputed_passed != passed
                or decimal_text(recomputed_run.public.net_usd, MONEY_QUANTUM)
                != holdout_public.get("netUsdPer1000")
                or decimal_text(recomputed_run.stress.net_usd, MONEY_QUANTUM)
                != holdout_stress.get("netUsdPer1000")
            ):
                raise EvidenceError(
                    "tracked holdout differs from deterministic sealed-source recomputation"
                )
            if (
                verdict != expected_verdict
                or result.get("n3ProfitabilityStatus") != expected_n3
                or set(reason_codes) != {name for name, gate in holdout_gates.items() if not gate}
                or economics.get("holdoutPublicNetUsdPer1000")
                != holdout_public.get("netUsdPer1000")
                or economics.get("holdoutStressNetUsdPer1000")
                != holdout_stress.get("netUsdPer1000")
                or economics.get("headlineNetEdgeUsdPer1000") != holdout_stress.get("netUsdPer1000")
            ):
                raise EvidenceError("measured holdout verdict or economics mismatch")
        else:
            raise EvidenceError("measured verdict has invalid holdout state")
    if economics.get("publicFeeProxy") != "10_BPS_PER_FILL":
        raise EvidenceError("result public fee proxy drift")
    external_state = state_root().resolve()
    if HERE in external_state.parents or external_state == HERE:
        raise EvidenceError("external evidence root escaped its boundary")
    _assert_scope_from_base(git_output("rev-parse", "HEAD"))
    if require_terminal_commit:
        if git_blob_at_head("quant/research/vg3/result.v1.json") != raw:
            raise EvidenceError("terminal result must be committed unchanged")
        _verify_sha256_manifest()
        if git_output("status", "--porcelain"):
            raise EvidenceError("terminal verification requires a clean worktree")
    return result


def _summary(result: Mapping[str, Any]) -> str:
    economics = result.get("economics")
    edge = "UNKNOWN"
    if isinstance(economics, dict):
        candidate = economics.get("headlineNetEdgeUsdPer1000")
        if isinstance(candidate, str):
            edge = candidate
    holdout = result.get("holdout")
    holdout_status = holdout.get("status", "UNKNOWN") if isinstance(holdout, dict) else "UNKNOWN"
    return (
        f"V-G3 verdict={result.get('verdict')} "
        f"netEdgeUsdPer1000={edge} holdout={holdout_status} "
        "authority=NONE"
    )


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("discover", "freeze", "acquire", "run", "verify"),
    )
    parsed = parser.parse_args(arguments)
    try:
        if parsed.command == "discover":
            discovery = discover_symbols()
            print(
                f"discovery prefixes={discovery['prefixCount']} "
                f"eligible={discovery['eligibleFormationSymbolCount']}"
            )
        elif parsed.command == "freeze":
            freeze = create_freeze()
            print(
                f"freeze protocolCommit={str(freeze['protocolCommit'])[-4:]} "
                f"inputs={len(cast(dict[str, str], freeze['frozenInputs']))}"
            )
        elif parsed.command == "acquire":
            acquisition = acquire_archives()
            print(
                f"acquisition verified={acquisition['verifiedArchiveCount']} "
                f"recordsSha256={str(acquisition['recordsSha256'])[-12:]}"
            )
        elif parsed.command == "run":
            print(_summary(run_sealed_experiment()))
        else:
            print(_summary(verify_result()))
    except EvidenceError as error:
        print(f"V-G3 stopped: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
