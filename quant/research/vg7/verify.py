"""Independent, network-free verifier for the sealed V-G7 packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Final, cast

HERE: Final = Path(__file__).resolve().parent
QUANT_ROOT: Final = HERE.parent.parent
BASE_SHA: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
LIMITATION: Final = (
    "This is a sealed 12-month public Binance Spot daily-bar simulation, not "
    "account-specific fee or fill truth, live profitability evidence, forward "
    "assurance, verified executable capacity, capital authorization, or "
    "execution authority."
)
EXECUTION_BANNER: Final = (
    "PUBLIC_BAR_EXECUTION_SENSITIVITY_ONLY; ACCOUNT_EFFECTIVE_FEES=UNKNOWN; "
    "HISTORICAL_FILTER_ADMISSIBILITY=UNKNOWN; HISTORICAL_BOOK=UNAVAILABLE; "
    "VERIFIED_EXECUTABLE_CAPACITY=UNMEASURED; EXECUTION_AUTHORITY=NONE."
)
EXPECTED_DISCOVERY_SHA: Final = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
EXPECTED_ACQUISITION_SHA: Final = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
EXPECTED_UNIVERSE_SHA: Final = "a597d8339aafb74c40b8899cade9445150c3f431f4c2e7fe2bfac37d8d1b0592"
EXPECTED_STABLE_FIAT_SHA: Final = "850acfaa5b3895914e22445631eec72cd31818d534c5869898210764556b30ff"
EXPECTED_LEVERAGED_SHA: Final = "4a0836ed77c6114becd45241429a1c418bc3aa182d8c5035803b308d839772e4"
EXPECTED_MONTHS: Final = (
    "2025-03",
    "2025-04",
    "2025-05",
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


class VerificationError(RuntimeError):
    """An independently detected packet-integrity failure."""


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise VerificationError(f"unsafe or missing file: {path.name}")
    return path


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_file(path).read_bytes())


def normalized_lines(values: Sequence[str]) -> bytes:
    return ("\n".join(values) + "\n").encode()


def parse_sidecar(raw: bytes, expected_filename: str) -> str:
    try:
        tokens = raw.decode("ascii").strip().split()
    except UnicodeDecodeError as error:
        raise VerificationError("publisher sidecar is not ASCII") from error
    if len(tokens) != 2 or tokens[1].lstrip("*") != expected_filename:
        raise VerificationError("publisher sidecar filename mismatch")
    digest = tokens[0].lower()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise VerificationError("publisher sidecar digest malformed")
    return digest


def load_json(path: Path, *, canonical: bool) -> tuple[dict[str, Any], bytes]:
    raw = safe_file(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise VerificationError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"non-object JSON root: {path.name}")
    result = cast(dict[str, Any], value)
    if canonical and canonical_bytes(result) != raw:
        raise VerificationError(f"non-canonical generated JSON: {path.name}")
    return result, raw


def nested(mapping: Mapping[str, Any], *keys: str) -> Any:
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            raise VerificationError(f"missing field: {'.'.join(keys)}")
        current = current[key]
    return current


def require_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise VerificationError(f"{field} must be nonempty text")
    return value


def require_list(value: object, *, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise VerificationError(f"{field} must be a list")
    return value


def git(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", "-C", str(HERE), *arguments),
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise VerificationError(f"Git command failed: {' '.join(arguments)}")
    return completed.stdout.strip()


def git_show_bytes(commit: str, path: str) -> bytes:
    completed = subprocess.run(
        ("git", "-C", str(HERE), "show", f"{commit}:{path}"),
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise VerificationError(f"Git object missing: {commit[:12]}:{path}")
    return completed.stdout


def verify_git() -> tuple[str, str]:
    root = Path(git("rev-parse", "--show-toplevel")).resolve()
    if (root / "quant" / "research" / "vg7").resolve() != HERE.resolve():
        raise VerificationError("packet path differs from authorized V-G7 scope")
    head = git("rev-parse", "HEAD")
    git("merge-base", "--is-ancestor", BASE_SHA, "HEAD")
    changed = tuple(
        line for line in git("diff", "--name-only", f"{BASE_SHA}..HEAD").splitlines() if line
    )
    if not changed or any(not item.startswith("quant/research/vg7/") for item in changed):
        raise VerificationError("committed scope is empty or escapes V-G7")
    if git("status", "--porcelain=v1", "--untracked-files=all"):
        raise VerificationError("final worktree is not clean")
    return head, sha256_bytes(("\n".join(changed) + "\n").encode())


def verify_checksum_inventory() -> tuple[int, str]:
    checksum_path = HERE / "SHA256SUMS"
    lines = safe_file(checksum_path).read_text(encoding="utf-8").splitlines()
    if not lines:
        raise VerificationError("SHA256SUMS is empty")
    observed: dict[str, str] = {}
    for line in lines:
        if len(line) < 67 or line[64:66] != "  ":
            raise VerificationError("SHA256SUMS row malformed")
        digest = line[:64]
        filename = line[66:]
        if (
            len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
            or "/" in filename
            or filename in observed
        ):
            raise VerificationError("SHA256SUMS row unsafe or duplicated")
        observed[filename] = digest
    expected = {
        path.name
        for path in HERE.iterdir()
        if path.is_file() and not path.is_symlink() and path.name != "SHA256SUMS"
    }
    if set(observed) != expected:
        raise VerificationError("SHA256SUMS inventory differs from packet files")
    for filename, digest in observed.items():
        if sha256_path(HERE / filename) != digest:
            raise VerificationError(f"packet checksum mismatch: {filename}")
    return len(observed), sha256_bytes(safe_file(checksum_path).read_bytes())


def verify_static_and_freeze() -> tuple[dict[str, Any], dict[str, Any], str]:
    protocol, protocol_raw = load_json(HERE / "protocol.v1.json", canonical=False)
    if protocol.get("schema") != "VG7VolumeClimaxExhaustionProtocolV1":
        raise VerificationError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != BASE_SHA:
        raise VerificationError("protocol base mismatch")
    if protocol.get("limitation") != LIMITATION:
        raise VerificationError("protocol limitation changed")
    if nested(protocol, "signal", "trials", "familySize") != 36:
        raise VerificationError("protocol trial count changed")
    if nested(protocol, "calendar", "holdout", "allowedOpenCount") != 1:
        raise VerificationError("protocol holdout count changed")
    universe, universe_raw = load_json(HERE / "universe.v1.json", canonical=True)
    symbols = require_list(universe.get("symbols"), field="universe.symbols")
    if (
        universe.get("schema") != "VG7UniverseV1"
        or universe.get("count") != 605
        or universe.get("sha256") != EXPECTED_UNIVERSE_SHA
        or symbols != sorted(set(symbols))
    ):
        raise VerificationError("universe freeze mismatch")
    logical_hash = sha256_bytes(("\n".join(cast(list[str], symbols)) + "\n").encode())
    if logical_hash != EXPECTED_UNIVERSE_SHA:
        raise VerificationError("universe logical hash mismatch")
    excluded_symbols: set[str] = set()
    for field, digest_field, expected in (
        ("stableOrFiatSymbols", "stableOrFiatSha256", EXPECTED_STABLE_FIAT_SHA),
        ("pairedLeveragedSymbols", "pairedLeveragedSha256", EXPECTED_LEVERAGED_SHA),
    ):
        excluded = require_list(nested(universe, "exclusions", field), field=field)
        if not all(isinstance(item, str) for item in excluded):
            raise VerificationError("universe exclusion list malformed")
        logical = sha256_bytes(("\n".join(cast(list[str], excluded)) + "\n").encode())
        if logical != expected or nested(universe, "exclusions", digest_field) != expected:
            raise VerificationError("universe exclusion binding mismatch")
        excluded_symbols.update(cast(list[str], excluded))
    if excluded_symbols.intersection(cast(list[str], symbols)):
        raise VerificationError("excluded symbol appears in frozen universe")
    source, source_raw = load_json(HERE / "source-manifest.v1.json", canonical=True)
    rows = require_list(source.get("rows"), field="source.rows")
    if (
        source.get("schema") != "VG7SourceManifestV1"
        or source.get("archiveBodiesOpened") is not False
        or source.get("selectedRowCount") != 605 * 16
        or len(rows) != 605 * 16
        or source.get("discoverySha256") != EXPECTED_DISCOVERY_SHA
        or source.get("acquisitionManifestSha256") != EXPECTED_ACQUISITION_SHA
        or source.get("universeSha256") != EXPECTED_UNIVERSE_SHA
    ):
        raise VerificationError("source-manifest freeze mismatch")
    if tuple(source.get("selectedMonths", [])) != EXPECTED_MONTHS:
        raise VerificationError("source month grid mismatch")
    expected_pairs = tuple(
        (symbol, month) for symbol in cast(list[str], symbols) for month in EXPECTED_MONTHS
    )
    present_count = 0
    absent_count = 0
    for raw, (expected_symbol, expected_month) in zip(rows, expected_pairs, strict=True):
        if not isinstance(raw, dict):
            raise VerificationError("source row malformed")
        if raw.get("symbol") != expected_symbol or raw.get("month") != expected_month:
            raise VerificationError("source rows are not the exact rectangular grid")
        state = raw.get("state")
        if state == "ABSENT":
            if set(raw) != {"month", "state", "symbol"}:
                raise VerificationError("absent source row contains extra claims")
            absent_count += 1
            continue
        if state != "PRESENT_PUBLISHER_SHA256_VERIFIED_COMPRESSED_NOT_OPENED":
            raise VerificationError("source row state invalid")
        filename = f"{expected_symbol}-1d-{expected_month}.zip"
        expected_zip_key = f"data/spot/monthly/klines/{expected_symbol}/1d/{filename}"
        if (
            raw.get("zipKey") != expected_zip_key
            or raw.get("checksumKey") != f"{expected_zip_key}.CHECKSUM"
        ):
            raise VerificationError("source row key mismatch")
        for field in ("zipSha256", "checksumSha256"):
            digest = raw.get(field)
            if not isinstance(digest, str) or len(digest) != 64:
                raise VerificationError("source digest malformed")
        for field in ("zipBytes", "checksumBytes"):
            value = raw.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise VerificationError("source byte count malformed")
        present_count += 1
    if (
        present_count != source.get("presentSymbolMonthCount")
        or absent_count != source.get("absentSymbolMonthCount")
        or present_count + absent_count != len(rows)
    ):
        raise VerificationError("source present/absent accounting mismatch")
    freeze, freeze_raw = load_json(HERE / "freeze.v1.json", canonical=True)
    if (
        freeze.get("schema") != "VG7FreezeV1"
        or freeze.get("archiveBodiesOpened") is not False
        or freeze.get("canonicalBaseCommit") != BASE_SHA
        or freeze.get("trialCount") != 36
    ):
        raise VerificationError("freeze invariant mismatch")
    expected_runtime = {
        "decimalPrecision": 50,
        "pythonImplementation": sys.implementation.name,
        "pythonMajorMinor": f"{sys.version_info.major}.{sys.version_info.minor}",
        "pythonMicro": sys.version_info.micro,
        "rng": "python_random_MT19937",
    }
    if freeze.get("runtime") != expected_runtime:
        raise VerificationError("freeze runtime binding differs from verifier runtime")
    if nested(freeze, "inputBindings", "sourceManifestSha256") != sha256_bytes(source_raw):
        raise VerificationError("freeze source-manifest binding mismatch")
    if nested(freeze, "inputBindings", "universeFileSha256") != sha256_bytes(universe_raw):
        raise VerificationError("freeze universe binding mismatch")
    if nested(freeze, "packetBindings", "protocolSha256") != sha256_bytes(protocol_raw):
        raise VerificationError("freeze protocol binding mismatch")
    for filename, key in (
        ("experiment.py", "evaluatorSha256"),
        ("OFFICIAL_SOURCE_RESEARCH.md", "officialSourceResearchSha256"),
        ("README.md", "readmeSha256"),
        ("test_packet.py", "testSha256"),
        ("verify.py", "verifierSha256"),
    ):
        if nested(freeze, "packetBindings", key) != sha256_path(HERE / filename):
            raise VerificationError(f"freeze {filename} binding mismatch")
    for path, key in (
        (QUANT_ROOT / "pyproject.toml", "pyprojectSha256"),
        (QUANT_ROOT / "uv.lock", "dependencyLockSha256"),
    ):
        if nested(freeze, "packetBindings", key) != sha256_path(path):
            raise VerificationError(f"freeze dependency binding mismatch: {path.name}")
    return source, freeze, sha256_bytes(freeze_raw)


def verify_source_bytes(source: Mapping[str, Any], state_root: Path) -> int:
    if (
        Path(require_text(source.get("stateRoot"), field="stateRoot")).resolve()
        != state_root.resolve()
    ):
        raise VerificationError("requested state root differs from frozen source root")
    if sha256_path(state_root / "discovery.v1.json") != EXPECTED_DISCOVERY_SHA:
        raise VerificationError("shared discovery changed after freeze")
    if sha256_path(state_root / "acquisition-manifest.v1.json") != EXPECTED_ACQUISITION_SHA:
        raise VerificationError("shared acquisition manifest changed after freeze")
    verified = 0
    for raw in require_list(source.get("rows"), field="source.rows"):
        if not isinstance(raw, dict):
            raise VerificationError("source row malformed")
        if raw.get("state") == "ABSENT":
            continue
        if raw.get("state") != "PRESENT_PUBLISHER_SHA256_VERIFIED_COMPRESSED_NOT_OPENED":
            raise VerificationError("source row state mismatch")
        symbol = require_text(raw.get("symbol"), field="source.symbol")
        month = require_text(raw.get("month"), field="source.month")
        filename = f"{symbol}-1d-{month}.zip"
        directory = state_root / "archives" / symbol / month
        zip_path = directory / filename
        sidecar_path = directory / f"{filename}.CHECKSUM"
        zip_digest = sha256_path(zip_path)
        sidecar_raw = safe_file(sidecar_path).read_bytes()
        if zip_digest != raw.get("zipSha256"):
            raise VerificationError("shared ZIP changed after sealed run")
        if sha256_bytes(sidecar_raw) != raw.get("checksumSha256"):
            raise VerificationError("shared publisher sidecar changed after sealed run")
        if parse_sidecar(sidecar_raw, filename) != zip_digest:
            raise VerificationError("publisher sidecar no longer binds shared ZIP")
        if safe_file(zip_path).stat().st_size != raw.get("zipBytes"):
            raise VerificationError("shared ZIP byte count changed")
        if sidecar_path.stat().st_size != raw.get("checksumBytes"):
            raise VerificationError("shared sidecar byte count changed")
        verified += 1
    return verified


def finite_number(value: object, *, field: str) -> float:
    if not isinstance(value, str):
        raise VerificationError(f"{field} is not an exact serialized number")
    try:
        parsed = float(value)
    except ValueError as error:
        raise VerificationError(f"{field} is not numeric") from error
    if not math.isfinite(parsed):
        raise VerificationError(f"{field} is not finite")
    return parsed


def nonnegative_int(value: object, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise VerificationError(f"{field} is not a nonnegative integer")
    return value


def expected_trial_ids() -> set[str]:
    return {
        f"V{volume:02d}_R{return_threshold:02d}_W{wick:02d}_H{hold:02d}"
        for volume in (2, 4, 8)
        for return_threshold in (3, 5)
        for wick in (25, 40)
        for hold in (3, 5, 7)
    }


def primary_metrics(record: Mapping[str, Any]) -> Mapping[str, Any]:
    metrics = nested(record, "scenarios", "FEE_STRESS", "metrics")
    if not isinstance(metrics, dict):
        raise VerificationError("trial primary metrics malformed")
    return cast(Mapping[str, Any], metrics)


def verify_metrics_identity(metrics: Mapping[str, Any], *, label: str) -> None:
    start = finite_number(metrics.get("startUsd"), field=f"{label}.startUsd")
    end = finite_number(metrics.get("endUsd"), field=f"{label}.endUsd")
    net = finite_number(
        metrics.get("netPerInitial1000Usd"),
        field=f"{label}.netPerInitial1000Usd",
    )
    if not math.isclose(start, 1_000, rel_tol=0, abs_tol=1e-12):
        raise VerificationError(f"{label} start capital changed")
    if not math.isclose(net, end - start, rel_tol=0, abs_tol=1e-9):
        raise VerificationError(f"{label} net identity failed")
    round_trips = metrics.get("selectedRoundTrips")
    fills = metrics.get("fills")
    if (
        isinstance(round_trips, bool)
        or not isinstance(round_trips, int)
        or round_trips < 0
        or isinstance(fills, bool)
        or not isinstance(fills, int)
        or fills != 2 * round_trips
    ):
        raise VerificationError(f"{label} fill identity failed")


def scenario_metrics(
    scenario_table: Mapping[str, Any],
    name: str,
) -> Mapping[str, Any]:
    value = nested(scenario_table, name, "metrics")
    if not isinstance(value, dict):
        raise VerificationError(f"scenario metrics malformed: {name}")
    return cast(Mapping[str, Any], value)


def capacity_p05(metrics: Mapping[str, Any]) -> float | None:
    value = nested(
        metrics,
        "capacityProxy",
        "supportedInitialCapitalP05Usdt",
    )
    return None if value is None else finite_number(value, field="capacity.p05")


def expected_development_gates(record: Mapping[str, Any]) -> dict[str, bool]:
    primary = primary_metrics(record)
    scenarios = record.get("scenarios")
    bootstrap = record.get("bootstrap")
    holm = record.get("holm")
    if (
        not isinstance(scenarios, dict)
        or not isinstance(bootstrap, dict)
        or not isinstance(holm, dict)
    ):
        raise VerificationError("development inference record malformed")
    required_positive = all(
        finite_number(
            scenario_metrics(scenarios, name).get("netPerInitial1000Usd"),
            field=f"{name}.net",
        )
        > 0
        for name in ("BASE", "STRESS", "FEE_STRESS")
    )
    p05 = capacity_p05(primary)
    return {
        "activeMonths": nonnegative_int(
            primary.get("activeMonthCount"),
            field="activeMonthCount",
        )
        >= 6,
        "activeWeeks": nonnegative_int(
            primary.get("activeWeekCount"),
            field="activeWeekCount",
        )
        >= 20,
        "bootstrapLowerPositive": finite_number(
            bootstrap.get("oneSidedLower05NetPer1000Usd"),
            field="bootstrap.lower",
        )
        > 0,
        "capacityProxyP05": p05 is not None and p05 >= 1_000,
        "distinctSymbols": nonnegative_int(
            primary.get("distinctSymbolCount"),
            field="distinctSymbolCount",
        )
        >= 8,
        "drawdown": finite_number(
            primary.get("maxDailyCloseMarkedDrawdownPct"),
            field="drawdown",
        )
        <= 20,
        "holm": holm.get("rejectAtFamilyWiseAlpha") is True,
        "requiredCostScenariosPositive": required_positive,
        "roundTrips": nonnegative_int(
            primary.get("selectedRoundTrips"),
            field="selectedRoundTrips",
        )
        >= 60,
        "signalEvents": nonnegative_int(
            primary.get("signalEvents"),
            field="signalEvents",
        )
        >= 60,
    }


def expected_holdout_gates(holdout: Mapping[str, Any]) -> dict[str, bool]:
    metrics = holdout.get("metrics")
    bootstrap = holdout.get("bootstrap")
    scenarios = holdout.get("scenarioMetrics")
    if (
        not isinstance(metrics, dict)
        or not isinstance(bootstrap, dict)
        or not isinstance(scenarios, dict)
    ):
        raise VerificationError("holdout inference record malformed")
    p05 = capacity_p05(metrics)
    required_positive = all(
        finite_number(
            scenario_metrics(scenarios, name).get("netPerInitial1000Usd"),
            field=f"holdout.{name}.net",
        )
        > 0
        for name in ("BASE", "STRESS", "FEE_STRESS")
    )
    return {
        "activeMonths": nonnegative_int(
            metrics.get("activeMonthCount"),
            field="holdout.activeMonthCount",
        )
        >= 3,
        "activeWeeks": nonnegative_int(
            metrics.get("activeWeekCount"),
            field="holdout.activeWeekCount",
        )
        >= 8,
        "bootstrapLowerPositive": finite_number(
            bootstrap.get("oneSidedLower05NetPer1000Usd"),
            field="holdout.bootstrap.lower",
        )
        > 0,
        "capacityProxyP05": p05 is not None and p05 >= 1_000,
        "distinctSymbols": nonnegative_int(
            metrics.get("distinctSymbolCount"),
            field="holdout.distinctSymbolCount",
        )
        >= 4,
        "drawdown": finite_number(
            metrics.get("maxDailyCloseMarkedDrawdownPct"),
            field="holdout.drawdown",
        )
        <= 20,
        "requiredCostScenariosPositive": required_positive,
        "roundTrips": nonnegative_int(
            metrics.get("selectedRoundTrips"),
            field="holdout.selectedRoundTrips",
        )
        >= 20,
        "signalEvents": nonnegative_int(
            metrics.get("signalEvents"),
            field="holdout.signalEvents",
        )
        >= 20,
    }


def record_sort_key(record: Mapping[str, Any]) -> tuple[float, float, str]:
    metrics = primary_metrics(record)
    return (
        -finite_number(
            metrics.get("netPerInitial1000Usd"),
            field="netPerInitial1000Usd",
        ),
        finite_number(
            metrics.get("maxDailyCloseMarkedDrawdownPct"),
            field="maxDailyCloseMarkedDrawdownPct",
        ),
        require_text(record.get("trialId"), field="trialId"),
    )


def verify_result(
    freeze_sha: str,
    final_head: str,
    freeze: Mapping[str, Any],
) -> tuple[str, str]:
    marker, marker_raw = load_json(HERE / "development-run-marker.v1.json", canonical=True)
    if (
        marker.get("schema") != "VG7DevelopmentRunMarkerV1"
        or marker.get("attempt") != 1
        or marker.get("freezeSha256") != freeze_sha
        or marker.get("state") != "CONSUMED_BEFORE_FIRST_ARCHIVE_MEMBER_OPEN"
    ):
        raise VerificationError("development marker mismatch")
    pre_run_sha = require_text(marker.get("preRunGitSha"), field="preRunGitSha")
    if len(pre_run_sha) != 40:
        raise VerificationError("pre-run SHA is not full length")
    git("merge-base", "--is-ancestor", pre_run_sha, final_head)
    pre_run_freeze = git_show_bytes(
        pre_run_sha,
        "quant/research/vg7/freeze.v1.json",
    )
    if sha256_bytes(pre_run_freeze) != freeze_sha:
        raise VerificationError("pre-run freeze bytes differ from final bound freeze")
    implementation_sha = require_text(
        freeze.get("implementationGitSha"),
        field="implementationGitSha",
    )
    if len(implementation_sha) != 40:
        raise VerificationError("implementation SHA is not full length")
    git("merge-base", "--is-ancestor", implementation_sha, pre_run_sha)
    implementation_bindings = (
        (
            "quant/research/vg7/experiment.py",
            "evaluatorSha256",
        ),
        (
            "quant/research/vg7/OFFICIAL_SOURCE_RESEARCH.md",
            "officialSourceResearchSha256",
        ),
        ("quant/research/vg7/protocol.v1.json", "protocolSha256"),
        ("quant/research/vg7/README.md", "readmeSha256"),
        ("quant/research/vg7/test_packet.py", "testSha256"),
        ("quant/research/vg7/verify.py", "verifierSha256"),
        ("quant/pyproject.toml", "pyprojectSha256"),
        ("quant/uv.lock", "dependencyLockSha256"),
    )
    for path, binding in implementation_bindings:
        if sha256_bytes(git_show_bytes(implementation_sha, path)) != nested(
            freeze,
            "packetBindings",
            binding,
        ):
            raise VerificationError(f"implementation Git object binding changed: {path}")
    if not (
        require_text(freeze.get("createdAtUtc"), field="freeze.createdAtUtc")
        < require_text(marker.get("createdAtUtc"), field="marker.createdAtUtc")
    ):
        raise VerificationError("freeze was not created before run marker")
    result, _ = load_json(HERE / "result.v1.json", canonical=True)
    verdict = require_text(result.get("verdict"), field="verdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VerificationError("verdict is not tri-state")
    if (
        result.get("schema") != "VG7ResultV1"
        or result.get("taskId") != "V-G7"
        or result.get("freezeSha256") != freeze_sha
        or result.get("runMarkerSha256") != sha256_bytes(marker_raw)
        or result.get("preRunGitSha") != pre_run_sha
        or result.get("limitation") != LIMITATION
        or result.get("executionBanner") != EXECUTION_BANNER
    ):
        raise VerificationError("result binding or limitation mismatch")
    truth = nested(result, "truth")
    if not isinstance(truth, dict) or truth != {
        "accountEffectiveFees": "UNKNOWN",
        "capitalAuthority": "NONE",
        "historicalFilterAdmissibility": "UNKNOWN",
        "historicalOrderBook": "UNAVAILABLE",
        "publicBarExecution": "SENSITIVITY_ONLY",
        "verifiedExecutableCapacity": "UNMEASURED",
    }:
        raise VerificationError("result truth boundary changed")
    development = nested(result, "development")
    if not isinstance(development, dict):
        raise VerificationError("development result malformed")
    family_by_id: dict[str, Mapping[str, Any]] = {}
    locked_candidate_id: str | None = None
    if development.get("state") == "CONSUMED_VALID":
        family = require_list(development.get("family"), field="development.family")
        if len(family) != 36:
            raise VerificationError("development family does not contain 36 trials")
        for raw_record in family:
            if not isinstance(raw_record, dict):
                raise VerificationError("development trial record malformed")
            record = cast(Mapping[str, Any], raw_record)
            trial_id = require_text(record.get("trialId"), field="trialId")
            if trial_id in family_by_id:
                raise VerificationError("duplicate development trial id")
            gates = record.get("gates")
            if (
                not isinstance(gates, dict)
                or not gates
                or any(type(value) is not bool for value in gates.values())
            ):
                raise VerificationError("development gates are not exact booleans")
            if record.get("developmentEligible") is not all(gates.values()):
                raise VerificationError("development eligibility differs from gates")
            metrics = primary_metrics(record)
            for field in (
                "netPerInitial1000Usd",
                "maxDailyCloseMarkedDrawdownPct",
                "startUsd",
                "endUsd",
            ):
                finite_number(metrics.get(field), field=field)
            for field in (
                "signalEvents",
                "selectedRoundTrips",
                "fills",
                "distinctSymbolCount",
                "activeWeekCount",
                "activeMonthCount",
            ):
                value = metrics.get(field)
                if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                    raise VerificationError(f"metric is not a nonnegative integer: {field}")
            scenarios = record.get("scenarios")
            if not isinstance(scenarios, dict):
                raise VerificationError("trial scenario table malformed")
            for scenario_name in (
                "PUBLIC_FEE_ONLY",
                "BASE",
                "STRESS",
                "FEE_STRESS",
                "SEVERE_DIAGNOSTIC",
            ):
                verify_metrics_identity(
                    scenario_metrics(scenarios, scenario_name),
                    label=f"{trial_id}.{scenario_name}",
                )
            expected_gates = expected_development_gates(record)
            if gates != expected_gates:
                raise VerificationError("serialized development gates were not derived")
            family_by_id[trial_id] = record
        if set(family_by_id) != expected_trial_ids():
            raise VerificationError("development trial ids differ from frozen grid")
        eligible = [
            record for record in family_by_id.values() if record.get("developmentEligible") is True
        ]
        if development.get("candidateCountPassingAllGates") != len(eligible):
            raise VerificationError("development candidate count mismatch")
        locked_raw = development.get("lockedCandidateTrialId")
        locked_candidate_id = (
            require_text(locked_raw, field="lockedCandidateTrialId")
            if locked_raw is not None
            else None
        )
        expected_candidate = (
            require_text(min(eligible, key=record_sort_key).get("trialId"), field="trialId")
            if eligible
            else None
        )
        if locked_candidate_id != expected_candidate:
            raise VerificationError("locked candidate differs from frozen ordering")
        best_observed = min(family_by_id.values(), key=record_sort_key)
        expected_reported = (
            family_by_id[locked_candidate_id] if locked_candidate_id is not None else best_observed
        )
        best_report = nested(development, "bestByFrozenMetric")
        if (
            not isinstance(best_report, dict)
            or best_report.get("trialId") != expected_reported.get("trialId")
            or best_report.get("primaryMetrics") != primary_metrics(expected_reported)
        ):
            raise VerificationError("reader-facing development best record mismatch")
        diagnostic = nested(development, "bestObservedDiagnostic")
        if (
            not isinstance(diagnostic, dict)
            or diagnostic.get("trialId") != best_observed.get("trialId")
            or diagnostic.get("primaryMetrics") != primary_metrics(best_observed)
        ):
            raise VerificationError("best-observed diagnostic mismatch")
        pbo = nested(development, "pbo")
        if (
            not isinstance(pbo, dict)
            or pbo.get("diagnosticOnly") is not True
            or pbo.get("splitCount") != 70
            or pbo.get("purgeDaysAtAssignmentBoundary") != 7
        ):
            raise VerificationError("PBO diagnostic contract mismatch")
        pbo_value = finite_number(pbo.get("pbo"), field="pbo")
        if not 0 <= pbo_value <= 1:
            raise VerificationError("PBO outside [0,1]")
        semantic = nested(
            development,
            "sourceSemanticUnavailableSymbolMonths",
        )
        expected_issue = ["AERGOUSDT|2025-03|DAILY_CLOSE_BOUNDARY_INVALID"]
        if (
            not isinstance(semantic, dict)
            or semantic.get("count") != 1
            or semantic.get("measurementMonthsAffected") != 0
            or semantic.get("rows") != expected_issue
            or semantic.get("sha256") != sha256_bytes(normalized_lines(expected_issue))
        ):
            raise VerificationError("development semantic-unavailable receipt mismatch")
    elif development.get("state") != "CONSUMED_INVALID":
        raise VerificationError("unknown development state")
    elif verdict != "UNMEASURED":
        raise VerificationError("invalid development must be UNMEASURED")
    holdout_state = nested(result, "holdout", "state")
    candidate_exists = (HERE / "candidate-seal.v1.json").exists()
    holdout_marker_exists = (HERE / "holdout-open-marker.v1.json").exists()
    if holdout_state == "SEALED_UNOPENED":
        if candidate_exists or holdout_marker_exists:
            raise VerificationError("unopened holdout has candidate/open artifacts")
        if nested(result, "holdout", "metrics") is not None:
            raise VerificationError("unopened holdout contains metrics")
        if development.get("state") == "CONSUMED_VALID":
            if locked_candidate_id is not None:
                raise VerificationError("unopened holdout has a locked candidate")
            if (
                verdict != "NO_GO"
                or result.get("reason") != "NO_DEVELOPMENT_TRIAL_CLEARED_ALL_FROZEN_GATES"
            ):
                raise VerificationError("valid no-candidate development is not exact NO_GO")
    elif holdout_state in {"CONSUMED_VALID", "CONSUMED_INVALID"}:
        if not candidate_exists or not holdout_marker_exists:
            raise VerificationError("consumed holdout lacks seal or marker")
        candidate, candidate_raw = load_json(HERE / "candidate-seal.v1.json", canonical=True)
        holdout_marker, _ = load_json(HERE / "holdout-open-marker.v1.json", canonical=True)
        if (
            candidate.get("schema") != "VG7CandidateSealV1"
            or candidate.get("state") != "SEALED_BEFORE_HOLDOUT_OPEN"
            or candidate.get("freezeSha256") != freeze_sha
            or candidate.get("preRunGitSha") != pre_run_sha
            or candidate.get("candidateTrialId") != locked_candidate_id
            or holdout_marker.get("schema") != "VG7HoldoutOpenMarkerV1"
            or holdout_marker.get("attempt") != 1
            or holdout_marker.get("freezeSha256") != freeze_sha
            or holdout_marker.get("preRunGitSha") != pre_run_sha
            or holdout_marker.get("state") != "CONSUMED_BEFORE_FIRST_HOLDOUT_ARCHIVE_MEMBER_OPEN"
            or holdout_marker.get("candidateSealSha256") != sha256_bytes(candidate_raw)
        ):
            raise VerificationError("candidate/holdout seal mismatch")
        if locked_candidate_id is None or locked_candidate_id not in family_by_id:
            raise VerificationError("holdout consumed without exact development candidate")
        locked_record = family_by_id[locked_candidate_id]
        if (
            candidate.get("developmentRecordSha256") != sha256_bytes(canonical_bytes(locked_record))
            or locked_record.get("developmentEligible") is not True
        ):
            raise VerificationError("candidate seal does not bind eligible family record")
        if require_text(
            candidate.get("createdAtUtc"),
            field="candidate.createdAtUtc",
        ) > require_text(
            holdout_marker.get("createdAtUtc"),
            field="holdoutMarker.createdAtUtc",
        ):
            raise VerificationError("candidate was not sealed before holdout marker")
    else:
        raise VerificationError("unknown holdout state")
    if holdout_state == "CONSUMED_VALID":
        gates = nested(result, "holdout", "gates")
        if (
            not isinstance(gates, dict)
            or not gates
            or any(type(value) is not bool for value in gates.values())
        ):
            raise VerificationError("holdout gates are not exact booleans")
        holdout_metrics = nested(result, "holdout", "metrics")
        holdout_scenarios = nested(result, "holdout", "scenarioMetrics")
        if not isinstance(holdout_metrics, dict) or not isinstance(
            holdout_scenarios,
            dict,
        ):
            raise VerificationError("consumed-valid holdout metrics missing")
        for scenario_name in (
            "PUBLIC_FEE_ONLY",
            "BASE",
            "STRESS",
            "FEE_STRESS",
            "SEVERE_DIAGNOSTIC",
        ):
            verify_metrics_identity(
                scenario_metrics(holdout_scenarios, scenario_name),
                label=f"holdout.{scenario_name}",
            )
        if holdout_metrics != scenario_metrics(holdout_scenarios, "FEE_STRESS"):
            raise VerificationError("holdout primary metrics differ from fee stress")
        if gates != expected_holdout_gates(cast(Mapping[str, Any], result["holdout"])):
            raise VerificationError("serialized holdout gates were not derived")
        expected_verdict = "GO" if all(gates.values()) else "NO_GO"
        expected_reason = (
            "LOCKED_CANDIDATE_CLEARED_ALL_PUBLIC_RESEARCH_GATES"
            if expected_verdict == "GO"
            else "LOCKED_CANDIDATE_FAILED_AT_LEAST_ONE_FROZEN_HOLDOUT_GATE"
        )
        if verdict != expected_verdict or result.get("reason") != expected_reason:
            raise VerificationError("holdout gates do not determine verdict exactly")
        semantic = nested(
            result,
            "holdout",
            "sourceSemanticUnavailableSymbolMonths",
        )
        if (
            not isinstance(semantic, dict)
            or semantic.get("count") != 0
            or semantic.get("measurementMonthsAffected") != 0
            or semantic.get("rows") != []
            or semantic.get("sha256") != sha256_bytes(normalized_lines(()))
        ):
            raise VerificationError("holdout semantic-unavailable receipt mismatch")
        for field in (
            "netPerInitial1000Usd",
            "maxDailyCloseMarkedDrawdownPct",
        ):
            finite_number(holdout_metrics.get(field), field=f"holdout.{field}")
    elif holdout_state == "CONSUMED_INVALID":
        if (
            verdict != "UNMEASURED"
            or nested(result, "holdout", "metrics") is not None
            or not isinstance(nested(result, "holdout", "blocker"), str)
            or not require_text(result.get("reason"), field="reason").startswith("HOLDOUT_")
        ):
            raise VerificationError("invalid holdout is not exact UNMEASURED")
    if verdict == "NO_GO" and result.get("reason") not in {
        "NO_DEVELOPMENT_TRIAL_CLEARED_ALL_FROZEN_GATES",
        "LOCKED_CANDIDATE_FAILED_AT_LEAST_ONE_FROZEN_HOLDOUT_GATE",
    }:
        raise VerificationError("NO_GO lacks a frozen decisive reason")
    verdict_markdown = safe_file(HERE / "VERDICT.md").read_text(encoding="utf-8")
    if f"**{verdict}**" not in verdict_markdown or LIMITATION not in verdict_markdown:
        raise VerificationError("reader verdict does not preserve verdict/limitation")
    row = safe_file(HERE / "PROPOSED_RUN_SECTION5_ROW.md").read_text(encoding="utf-8")
    if row.count("\n") != 1 or f"verdict={verdict}" not in row:
        raise VerificationError("proposed section-5 handoff is not exactly one row")
    return verdict, pre_run_sha


def verify(state_root: Path, *, rehash_source: bool) -> dict[str, object]:
    final_head, scope_digest = verify_git()
    checksum_count, checksum_sha = verify_checksum_inventory()
    source, freeze, freeze_sha = verify_static_and_freeze()
    verified_source_pairs = verify_source_bytes(source, state_root) if rehash_source else 0
    verdict, pre_run_sha = verify_result(freeze_sha, final_head, freeze)
    return {
        "checksumInventoryCount": checksum_count,
        "checksumInventorySha256": checksum_sha,
        "finalGitSha": final_head,
        "freezeSha256": freeze_sha,
        "preRunGitSha": pre_run_sha,
        "rehashSource": rehash_source,
        "scopePathDigest": scope_digest,
        "status": "PASS",
        "taskId": "V-G7",
        "verdict": verdict,
        "verifiedSourcePairs": verified_source_pairs,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-root", required=True, type=Path)
    parser.add_argument(
        "--skip-source-rehash",
        action="store_true",
        help="verify packet only; default also rehashes every frozen shared pair",
    )
    arguments = parser.parse_args(argv)
    try:
        result = verify(
            cast(Path, arguments.state_root),
            rehash_source=not cast(bool, arguments.skip_source_rehash),
        )
    except VerificationError as error:
        print(f"V-G7 VERIFY FAIL: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
