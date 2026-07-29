"""Independent, network-free verifier for the sealed S-2H packet.

The verifier hashes compressed archives and their sidecars but deliberately
never imports ``zipfile`` or opens an archive member.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final, cast

D = Decimal
getcontext().prec = 60
HERE: Final = Path(__file__).resolve().parent
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXPECTED_TRIALS: Final = {
    "K03_X06": (3, 6),
    "K03_X10": (3, 10),
    "K05_X06": (5, 6),
    "K05_X10": (5, 10),
    "K08_X06": (8, 6),
    "K08_X10": (8, 10),
}
EXPECTED_SCENARIO_COST: Final = {
    "gross": D("0"),
    "public_base": D("0.004"),
    "public_stress": D("0.007"),
    "fee_stress": D("0.009"),
}
EXPECTED_SCENARIO_COMPONENTS: Final = {
    "gross": (D("0"), D("0")),
    "public_base": (D("0.002"), D("0.002")),
    "public_stress": (D("0.002"), D("0.005")),
    "fee_stress": (D("0.004"), D("0.005")),
}
EXPECTED_MONTHS: Final = tuple(
    [f"2025-{month:02d}" for month in range(6, 13)] + [f"2026-{month:02d}" for month in range(1, 7)]
)
STATIC_FILES: Final = {
    "README.md",
    "DISTINCTNESS.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "__init__.py",
    "protocol.v1.json",
    "experiment.py",
    "verify.py",
    "test_experiment.py",
}
GENERATED_FILES: Final = {
    "screen-consumed.v1.json",
    "universe.v1.json",
    "source-manifest.v1.json",
    "freeze.v1.json",
    "run-marker.v1.json",
    "development.v1.json",
    "selection.v1.json",
    "holdout-open.v1.json",
    "holdout.v1.json",
    "result.v1.json",
    "SHA256SUMS",
}
ALLOWED_FILES: Final = STATIC_FILES | GENERATED_FILES | {"REPORT.md"}
EXPECTED_DISCOVERY_SHA: Final = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
EXPECTED_ACQUISITION_SHA: Final = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
EXPECTED_LIMITATIONS: Final = [
    "SPOT_IS_CONTINUOUS_UTC_BOUNDARY_IS_NOT_A_MARKET_CLOSE",
    "SYNTHETIC_SHORT_BORROW_INVENTORY_AND_INTEREST_UNKNOWN",
    "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN",
    "HISTORICAL_FILTERS_SPREAD_DEPTH_IMPACT_AND_EXECUTABLE_CAPACITY_UNMEASURED",
    "PRIOR_DISCOVERY_ASCII_CANDIDATE_GRAMMAR_LIMITATION",
    "GLOBAL_HOLDOUT_NOT_CERTIFIED_SHARED_REUSE_RISK",
]


class VerificationError(RuntimeError):
    """A fail-closed packet verification failure."""


def fail(message: str) -> None:
    raise VerificationError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def physical_file(path: Path) -> Path:
    require(path.is_file() and not path.is_symlink(), f"unsafe/missing file: {path}")
    return path


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with physical_file(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reject_json_constant(value: str) -> None:
    raise VerificationError(f"nonfinite JSON constant: {value}")


def reject_nonfinite_json(value: object) -> None:
    if isinstance(value, float):
        require(math.isfinite(value), "nonfinite JSON number")
    elif isinstance(value, list):
        for item in value:
            reject_nonfinite_json(item)
    elif isinstance(value, dict):
        for item in value.values():
            reject_nonfinite_json(item)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            physical_file(path).read_text(encoding="utf-8"),
            parse_constant=reject_json_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise VerificationError(f"invalid JSON {path.name}: {exc}") from exc
    reject_nonfinite_json(value)
    require(isinstance(value, dict), f"{path.name}: JSON root is not an object")
    return cast(dict[str, Any], value)


def decimal(value: object, label: str) -> Decimal:
    require(isinstance(value, (str, int)), f"{label}: decimal is not text/integer")
    try:
        parsed = D(str(value))
    except InvalidOperation as exc:
        raise VerificationError(f"{label}: invalid decimal") from exc
    require(parsed.is_finite(), f"{label}: nonfinite decimal")
    return parsed


def finite_probability(value: object, label: str) -> float:
    require(isinstance(value, (int, float)), f"{label}: probability type")
    parsed = float(cast(int | float, value))
    require(0.0 <= parsed <= 1.0, f"{label}: probability domain")
    return parsed


def directed_hash(value: Mapping[str, Any], field: str, path: Path) -> None:
    require(value.get(field) == sha256_path(path), f"{field}: directed hash mismatch")


def expected_dates(start: date, count: int) -> list[str]:
    return [(start + timedelta(days=offset)).isoformat() for offset in range(count)]


def validate_packet_shape() -> set[str]:
    names: set[str] = set()
    for child in HERE.iterdir():
        if child.is_symlink():
            fail(f"symlink in packet: {child.name}")
        if child.is_file():
            names.add(child.name)
            require(child.name in ALLOWED_FILES, f"unexpected packet file: {child.name}")
        elif child.name != "__pycache__":
            fail(f"unexpected packet directory: {child.name}")
    require(names >= STATIC_FILES, "required static packet files missing")
    return names


def validate_protocol(protocol: Mapping[str, Any]) -> None:
    require(
        protocol.get("schema") == "cosmos.quant.research.s2h.protocol.v1",
        "protocol schema",
    )
    require(protocol.get("milestone") == "S-2H", "protocol milestone")
    require(protocol.get("canonicalBaseCommit") == BASE_COMMIT, "protocol base")
    strategy = cast(Mapping[str, Any], protocol.get("strategy"))
    require(
        strategy.get("family") == "BINANCE_SPOT_CROSS_SECTIONAL_UTC_DAILY_BOUNDARY_GAP_REVERSAL",
        "protocol strategy family",
    )
    calendar = cast(Mapping[str, Any], protocol.get("calendar"))
    require(calendar.get("timezone") == "UTC", "protocol timezone")
    require(
        cast(Mapping[str, Any], calendar.get("development")).get("scheduledDays") == 243,
        "protocol development days",
    )
    require(
        cast(Mapping[str, Any], calendar.get("holdout")).get("scheduledDays") == 115,
        "protocol holdout days",
    )
    trials = cast(Mapping[str, Any], protocol.get("trials"))
    require(trials.get("familySize") == 6, "protocol family size")
    require(trials.get("tailSizes") == [3, 5, 8], "protocol tail sizes")
    require(trials.get("exitHoursUtc") == [6, 10], "protocol exit hours")
    require(
        trials.get("cohortRule") == "EXACT_K_LONG_AND_K_SHORT_OR_WHOLE_DAY_CASH",
        "protocol cohort-or-cash law",
    )
    universe = cast(Mapping[str, Any], protocol.get("universe"))
    require(
        universe.get("inheritedDiscoverySha256") == EXPECTED_DISCOVERY_SHA,
        "protocol inherited discovery",
    )
    require(
        universe.get("inheritedAcquisitionManifestSha256") == EXPECTED_ACQUISITION_SHA,
        "protocol inherited acquisition",
    )
    costs = cast(Mapping[str, Any], protocol.get("costs"))
    scenarios = cast(list[Mapping[str, Any]], costs.get("scenarios"))
    require(
        {
            cast(str, row.get("id")): (
                cast(str, row.get("feeBpsPerFill")),
                cast(str, row.get("adverseExecutionBpsPerFill")),
            )
            for row in scenarios
        }
        == {
            "gross": ("0", "0"),
            "public_base": ("10", "10"),
            "public_stress": ("10", "25"),
            "fee_stress": ("20", "25"),
        },
        "protocol public cost scenarios",
    )
    require(costs.get("accountEffectiveCommission") == "UNKNOWN", "account cost truth")
    require(costs.get("borrowCost") == "UNKNOWN_NOT_SUBTRACTED", "borrow cost truth")
    statistics = cast(Mapping[str, Any], protocol.get("statistics"))
    require(
        cast(Mapping[str, Any], statistics.get("bootstrap")).get("replicates") == 16384,
        "protocol bootstrap replicates",
    )
    pbo = cast(Mapping[str, Any], statistics.get("pbo"))
    require(pbo.get("splits") == 70, "protocol PBO split count")
    require(
        pbo.get("role") == "DIAGNOSTIC_ONLY_NOT_SELECTOR_PVALUE_LCB_OR_VERDICT_OVERRIDE",
        "protocol PBO role",
    )
    authority = cast(Mapping[str, Any], protocol.get("authority"))
    require(authority.get("moneyMovedUsd") == 0, "protocol money authority")
    require(
        all(
            authority.get(key) == "NONE"
            for key in (
                "ui",
                "canonical",
                "live",
                "host",
                "provider",
                "private",
                "order",
                "transfer",
                "withdrawal",
            )
        ),
        "protocol authority",
    )


def validate_screen(
    screen: Mapping[str, Any],
    universe: Mapping[str, Any],
    protocol_path: Path,
) -> list[str]:
    require(
        screen.get("schema") == "cosmos.quant.research.s2h.screen_consumed.v1",
        "screen schema",
    )
    require(
        screen.get("state") == "SCREEN_CONSUMED_BEFORE_ANCHOR_MEMBER_OPEN",
        "screen state",
    )
    directed_hash(screen, "protocolSha256", protocol_path)
    require(screen.get("outcomeRowsOpened") == 0, "screen outcome count")
    require(screen.get("strategyRunCount") == 0, "screen strategy run count")

    require(
        universe.get("schema") == "cosmos.quant.research.s2h.universe.v1",
        "universe schema",
    )
    require(
        universe.get("state") == "POINT_IN_TIME_UNIVERSE_FROZEN",
        "universe state",
    )
    directed_hash(universe, "protocolSha256", protocol_path)
    directed_hash(universe, "screenMarkerSha256", HERE / "screen-consumed.v1.json")
    require(universe.get("anchorMonth") == "2025-06", "universe anchor month")
    require(universe.get("selectedCount") == 30, "universe selected count")
    require(universe.get("currentExchangeInfoUsed") is False, "current exchangeInfo")
    require(universe.get("futureCompletenessUsed") is False, "future completeness")
    require(universe.get("holdoutOutcomeRowsOpened") == 0, "universe holdout state")
    selected_raw = universe.get("selected")
    symbols_raw = universe.get("selectedSymbols")
    require(isinstance(selected_raw, list) and len(selected_raw) == 30, "selected rows")
    require(isinstance(symbols_raw, list) and len(symbols_raw) == 30, "selected symbols")
    selected = cast(list[Any], selected_raw)
    symbols = cast(list[str], symbols_raw)
    require(len(set(symbols)) == 30, "duplicate selected symbol")
    require(
        symbols == [cast(Mapping[str, Any], row).get("symbol") for row in selected],
        "universe symbol order",
    )
    attempts_raw = universe.get("attempts")
    attempt_count = universe.get("attemptCount")
    require(
        isinstance(attempts_raw, list)
        and isinstance(attempt_count, int)
        and len(attempts_raw) == attempt_count,
        "universe attempt ledger",
    )
    attempts = cast(list[Any], attempts_raw)
    attempt_symbols = [cast(Mapping[str, Any], row).get("symbol") for row in attempts]
    require(len(attempt_symbols) == len(set(attempt_symbols)), "duplicate attempt")
    successful = {
        cast(str, cast(Mapping[str, Any], row).get("symbol"))
        for row in attempts
        if cast(Mapping[str, Any], row).get("status") == "SUCCESS"
    }
    require(
        universe.get("successfulCandidateCount") == len(successful),
        "successful candidate count",
    )
    require(set(symbols) <= successful, "selected outside successes")
    for index, row_raw in enumerate(selected, start=1):
        require(isinstance(row_raw, dict), "universe selected row type")
        row = cast(Mapping[str, Any], row_raw)
        require(row.get("rank") == index, "universe rank")
        symbol_raw = row.get("symbol")
        require(
            isinstance(symbol_raw, str) and symbol_raw.endswith("USDT"),
            "selected symbol",
        )
        symbol = cast(str, symbol_raw)
        require("/" not in symbol and "\\" not in symbol, "unsafe selected symbol")
        require(
            len(cast(str, row.get("zipSha256"))) == 64
            and len(cast(str, row.get("checksumSha256"))) == 64,
            "anchor digest length",
        )
    return symbols


def validate_inherited_provenance(
    screen: Mapping[str, Any],
    universe: Mapping[str, Any],
    protocol: Mapping[str, Any],
) -> None:
    protocol_universe = cast(Mapping[str, Any], protocol.get("universe"))
    require(
        protocol_universe.get("inheritedDiscoverySha256") == EXPECTED_DISCOVERY_SHA,
        "inherited discovery protocol binding",
    )
    require(
        protocol_universe.get("inheritedAcquisitionManifestSha256") == EXPECTED_ACQUISITION_SHA,
        "inherited acquisition protocol binding",
    )
    require(
        screen.get("inheritedDiscoverySha256") == EXPECTED_DISCOVERY_SHA
        and universe.get("inheritedDiscoverySha256") == EXPECTED_DISCOVERY_SHA,
        "inherited discovery packet binding",
    )
    require(
        screen.get("inheritedAcquisitionManifestSha256") == EXPECTED_ACQUISITION_SHA
        and universe.get("inheritedAcquisitionManifestSha256") == EXPECTED_ACQUISITION_SHA,
        "inherited acquisition packet binding",
    )
    discovery_path = resolve_physical_absolute(
        screen.get("inheritedDiscoveryResolved"), directory=False
    )
    acquisition_path = resolve_physical_absolute(
        screen.get("inheritedAcquisitionManifestResolved"), directory=False
    )
    require(
        universe.get("inheritedDiscoveryResolved") == str(discovery_path),
        "universe discovery path",
    )
    require(
        universe.get("inheritedAcquisitionManifestResolved") == str(acquisition_path),
        "universe acquisition path",
    )
    require(sha256_path(discovery_path) == EXPECTED_DISCOVERY_SHA, "discovery hash")
    require(
        sha256_path(acquisition_path) == EXPECTED_ACQUISITION_SHA,
        "acquisition hash",
    )
    discovery = load_json(discovery_path)
    acquisition = load_json(acquisition_path)
    require(discovery.get("schema") == "S1FArchiveDiscoveryV1", "discovery schema")
    require(
        discovery.get("state") == "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED",
        "discovery state",
    )
    require(
        acquisition.get("schema") == "S1FAcquisitionManifestV1",
        "inherited acquisition schema",
    )
    require(
        acquisition.get("state") == "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED",
        "inherited acquisition state",
    )
    require(
        acquisition.get("discoverySha256") == EXPECTED_DISCOVERY_SHA,
        "acquisition discovery binding",
    )
    discovery_universe = cast(Mapping[str, Any], discovery.get("universe"))
    inherited_symbols = cast(list[str], discovery_universe.get("symbols"))
    exclusions = cast(Mapping[str, Any], discovery.get("exclusions"))
    stable = cast(list[str], exclusions.get("stableOrFiatSymbols"))
    leveraged = cast(list[str], exclusions.get("pairedLeveragedSymbols"))
    candidates = sorted(
        {*inherited_symbols, *stable, *leveraged},
        key=lambda value: value.encode("utf-8"),
    )
    require(
        discovery_universe.get("count") == 605
        and len(inherited_symbols) == 605
        and len(set(inherited_symbols)) == 605,
        "inherited 605-symbol law",
    )
    require(
        len(stable) + len(leveraged) == 74 and len(candidates) == 679,
        "inherited 605+74 candidate law",
    )
    require(screen.get("inheritedAsciiUsdtCandidateCount") == 679, "screen candidates")
    require(
        universe.get("inheritedAsciiUsdtCandidateCount") == 679,
        "universe candidates",
    )
    require(
        screen.get("inheritedRawPrefixCount")
        == cast(Mapping[str, Any], discovery.get("root")).get("allPrefixCount")
        == universe.get("inheritedRawPrefixCount"),
        "inherited raw-prefix binding",
    )
    attempts = cast(list[Mapping[str, Any]], universe.get("attempts"))
    require(
        universe.get("attemptCount") == 679
        and len(attempts) == 679
        and [row.get("symbol") for row in attempts] == candidates,
        "679-attempt candidate coverage",
    )
    exclusions_packet = cast(Mapping[str, Any], universe.get("inheritedExclusions"))
    require(
        exclusions_packet.get("stableOrFiatCount") == len(stable)
        and exclusions_packet.get("pairedLeveragedCount") == len(leveraged)
        and exclusions_packet.get("stableOrFiatSha256") == exclusions.get("stableOrFiatSha256")
        and exclusions_packet.get("pairedLeveragedSha256")
        == exclusions.get("pairedLeveragedSha256"),
        "inherited exclusion binding",
    )
    acquisition_rows = cast(list[Mapping[str, Any]], acquisition.get("artifactPairs"))
    require(
        acquisition.get("artifactPairCount") == 11_245 and len(acquisition_rows) == 11_245,
        "inherited acquisition cardinality",
    )
    acquisition_index: dict[tuple[str, str], Mapping[str, Any]] = {}
    for row in acquisition_rows:
        key = (cast(str, row.get("symbol")), cast(str, row.get("month")))
        require(key not in acquisition_index, "duplicate inherited acquisition pair")
        acquisition_index[key] = row
    anchor_root = resolve_physical_absolute(universe.get("anchorCacheResolved"), directory=True)
    require(
        screen.get("anchorCacheResolved") == str(anchor_root),
        "screen/universe anchor root",
    )
    for row in cast(list[Mapping[str, Any]], universe.get("selected")):
        symbol = cast(str, row.get("symbol"))
        inherited = acquisition_index.get((symbol, "2025-06"))
        require(inherited is not None, "selected anchor absent from inherited manifest")
        inherited_row = cast(Mapping[str, Any], inherited)
        archive = resolve_external(anchor_root, row.get("archiveRelativePath"))
        sidecar = resolve_external(
            anchor_root, f"{cast(str, row.get('archiveRelativePath'))}.CHECKSUM"
        )
        require(
            inherited_row.get("state") == "DOWNLOADED_VERIFIED"
            and inherited_row.get("zipSha256") == row.get("zipSha256")
            and inherited_row.get("checksumSha256") == row.get("checksumSha256")
            and inherited_row.get("zipBytes") == archive.stat().st_size
            and inherited_row.get("checksumBytes") == sidecar.stat().st_size,
            "selected inherited anchor binding",
        )


def resolve_physical_absolute(path_text: object, *, directory: bool) -> Path:
    require(isinstance(path_text, str), "external absolute path type")
    path = Path(cast(str, path_text))
    require(path.is_absolute(), "external path is not absolute")
    candidate = Path(path.anchor)
    for part in path.parts[1:]:
        candidate /= part
        require(not candidate.is_symlink(), f"external path symlink: {candidate}")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise VerificationError(f"external path missing: {path}") from exc
    if directory:
        require(resolved.is_dir(), f"external directory missing: {path}")
    else:
        physical_file(resolved)
    return resolved


def resolve_external(root: Path, relative_text: object) -> Path:
    require(isinstance(relative_text, str), "external relative path type")
    relative = Path(cast(str, relative_text))
    require(not relative.is_absolute() and ".." not in relative.parts, "unsafe path")
    candidate = root
    for part in relative.parts:
        candidate /= part
        require(not candidate.is_symlink(), f"external path symlink: {candidate}")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise VerificationError(f"external source missing: {relative}") from exc
    require(root in resolved.parents, "external path escape")
    return physical_file(resolved)


def parse_sidecar(path: Path, expected_name: str) -> str:
    try:
        fields = physical_file(path).read_text(encoding="ascii").strip().split()
    except (OSError, UnicodeError) as exc:
        raise VerificationError(f"invalid sidecar: {path}") from exc
    require(len(fields) == 2, f"sidecar field count: {path.name}")
    digest, name = fields
    require(name.removeprefix("*") == expected_name, f"sidecar filename: {path.name}")
    require(
        len(digest) == 64 and all(character in "0123456789abcdefABCDEF" for character in digest),
        f"sidecar digest: {path.name}",
    )
    return digest.lower()


def validate_anchor_sources(universe: Mapping[str, Any]) -> None:
    root_text = universe.get("anchorCacheResolved")
    root = resolve_physical_absolute(root_text, directory=True)
    for row in cast(list[Mapping[str, Any]], universe.get("selected")):
        relative = row.get("archiveRelativePath")
        archive = resolve_external(root, relative)
        sidecar = resolve_external(root, f"{cast(str, relative)}.CHECKSUM")
        archive_sha = sha256_path(archive)
        require(archive_sha == row.get("zipSha256"), "anchor ZIP hash")
        require(sha256_path(sidecar) == row.get("checksumSha256"), "anchor sidecar hash")
        require(parse_sidecar(sidecar, archive.name) == archive_sha, "anchor checksum")


def validate_manifest(
    manifest: Mapping[str, Any],
    universe: Mapping[str, Any],
    protocol_path: Path,
) -> tuple[Path, int]:
    require(
        manifest.get("schema") == "cosmos.quant.research.s2h.source_manifest.v1",
        "manifest schema",
    )
    require(
        manifest.get("state") == "COMPRESSED_SOURCE_FROZEN_MEMBERS_UNOPENED",
        "manifest state",
    )
    directed_hash(manifest, "protocolSha256", protocol_path)
    directed_hash(manifest, "universeSha256", HERE / "universe.v1.json")
    symbols = cast(list[str], universe.get("selectedSymbols"))
    require(manifest.get("symbols") == symbols, "manifest symbols")
    require(tuple(cast(list[str], manifest.get("months"))) == EXPECTED_MONTHS, "months")
    require(manifest.get("pairCount") == 390, "manifest pair count")
    require(manifest.get("zipCount") == 390, "manifest ZIP count")
    require(manifest.get("checksumCount") == 390, "manifest checksum count")
    require(manifest.get("archiveMemberOpenCount") == 0, "manifest member-open state")
    require(manifest.get("developmentMemberOpenCount") == 0, "manifest dev-open state")
    require(manifest.get("holdoutMemberOpenCount") == 0, "manifest holdout-open state")
    root_text = manifest.get("stateRootResolved")
    root = resolve_physical_absolute(root_text, directory=True)
    pairs_raw = manifest.get("pairs")
    require(
        isinstance(pairs_raw, list) and len(pairs_raw) == 390,
        "manifest pair rows",
    )
    pairs = cast(list[Any], pairs_raw)
    expected_keys = {(symbol, month) for symbol in symbols for month in EXPECTED_MONTHS}
    observed_keys: set[tuple[str, str]] = set()
    for row_raw in pairs:
        require(isinstance(row_raw, dict), "manifest pair type")
        row = cast(Mapping[str, Any], row_raw)
        require(
            set(row)
            == {
                "symbol",
                "month",
                "interval",
                "zipUrl",
                "checksumUrl",
                "zipRelativePath",
                "checksumRelativePath",
                "receiptRelativePath",
                "zipSha256",
                "checksumSha256",
                "receiptSha256",
                "zipBytes",
                "checksumBytes",
                "zipHeaders",
                "checksumHeaders",
                "acquiredAtUtc",
                "archiveMemberOpened",
            },
            "manifest pair field set",
        )
        symbol_raw = row.get("symbol")
        month_raw = row.get("month")
        require(
            isinstance(symbol_raw, str) and isinstance(month_raw, str),
            "pair key type",
        )
        symbol = cast(str, symbol_raw)
        month = cast(str, month_raw)
        key = (symbol, month)
        require(key in expected_keys and key not in observed_keys, "pair key")
        observed_keys.add(key)
        require(row.get("interval") == "1h", "pair interval")
        require(row.get("archiveMemberOpened") is False, "pair member-open state")
        expected_url = (
            "https://data.binance.vision/data/spot/monthly/klines/"
            f"{symbol}/1h/{symbol}-1h-{month}.zip"
        )
        require(row.get("zipUrl") == expected_url, "pair ZIP URL")
        require(row.get("checksumUrl") == f"{expected_url}.CHECKSUM", "sidecar URL")
        zip_path = resolve_external(root, row.get("zipRelativePath"))
        checksum_path = resolve_external(root, row.get("checksumRelativePath"))
        receipt_path = resolve_external(root, row.get("receiptRelativePath"))
        expected_name = f"{symbol}-1h-{month}.zip"
        require(zip_path.name == expected_name, "pair ZIP filename")
        require(checksum_path.name == f"{expected_name}.CHECKSUM", "sidecar filename")
        zip_sha = sha256_path(zip_path)
        checksum_sha = sha256_path(checksum_path)
        require(zip_sha == row.get("zipSha256"), "pair ZIP hash")
        require(checksum_sha == row.get("checksumSha256"), "pair sidecar hash")
        require(sha256_path(receipt_path) == row.get("receiptSha256"), "receipt hash")
        require(parse_sidecar(checksum_path, expected_name) == zip_sha, "pair checksum")
        require(row.get("zipBytes") == zip_path.stat().st_size, "pair ZIP bytes")
        require(
            row.get("checksumBytes") == checksum_path.stat().st_size,
            "pair sidecar bytes",
        )
        receipt = load_json(receipt_path)
        require(
            set(receipt)
            == {
                "schema",
                "symbol",
                "month",
                "interval",
                "zipUrl",
                "checksumUrl",
                "zipSha256",
                "checksumSha256",
                "zipBytes",
                "checksumBytes",
                "zipHeaders",
                "checksumHeaders",
                "acquiredAtUtc",
                "archiveMemberOpened",
            },
            "receipt field set",
        )
        require(
            receipt.get("schema") == "cosmos.quant.research.s2h.source_pair_receipt.v1",
            "receipt schema",
        )
        require(receipt.get("symbol") == symbol, "receipt symbol")
        require(receipt.get("month") == month, "receipt month")
        require(receipt.get("interval") == "1h", "receipt interval")
        require(receipt.get("zipUrl") == expected_url, "receipt ZIP URL")
        require(
            receipt.get("checksumUrl") == f"{expected_url}.CHECKSUM",
            "receipt sidecar URL",
        )
        require(receipt.get("zipSha256") == zip_sha, "receipt ZIP hash")
        require(receipt.get("checksumSha256") == checksum_sha, "receipt sidecar hash")
        require(receipt.get("zipBytes") == zip_path.stat().st_size, "receipt ZIP bytes")
        require(
            receipt.get("checksumBytes") == checksum_path.stat().st_size,
            "receipt sidecar bytes",
        )
        for field in ("zipHeaders", "checksumHeaders"):
            headers = receipt.get(field)
            require(
                isinstance(headers, dict)
                and set(headers) == {"etag", "lastModified", "contentLength"}
                and all(isinstance(value, str) for value in headers.values()),
                f"receipt {field}",
            )
            require(row.get(field) == headers, f"manifest/receipt {field}")
        acquired_at = receipt.get("acquiredAtUtc")
        require(isinstance(acquired_at, str), "receipt acquired timestamp")
        try:
            datetime.fromisoformat(cast(str, acquired_at).replace("Z", "+00:00"))
        except ValueError as exc:
            raise VerificationError("receipt acquired timestamp") from exc
        require(row.get("acquiredAtUtc") == acquired_at, "manifest/receipt timestamp")
        require(receipt.get("archiveMemberOpened") is False, "receipt member-open state")
    require(observed_keys == expected_keys, "manifest pair coverage")
    return root, len(pairs)


def validate_freeze(
    freeze: Mapping[str, Any],
    protocol: Mapping[str, Any],
    state_root: Path,
) -> None:
    require(freeze.get("schema") == "cosmos.quant.research.s2h.freeze.v1", "freeze schema")
    require(
        freeze.get("state") == "FROZEN_BEFORE_HOURLY_ARCHIVE_MEMBER_OPEN",
        "freeze state",
    )
    require(freeze.get("canonicalBaseCommit") == BASE_COMMIT, "freeze base")
    require(freeze.get("stateRootResolved") == str(state_root), "freeze state root")
    directed_hash(freeze, "protocolSha256", HERE / "protocol.v1.json")
    directed_hash(freeze, "universeSha256", HERE / "universe.v1.json")
    directed_hash(freeze, "sourceManifestSha256", HERE / "source-manifest.v1.json")
    directed_hash(freeze, "screenMarkerSha256", HERE / "screen-consumed.v1.json")
    static_hashes_raw = freeze.get("staticFileSha256")
    require(isinstance(static_hashes_raw, dict), "freeze static hashes")
    static_hashes = cast(dict[str, str], static_hashes_raw)
    expected_frozen = STATIC_FILES | {
        "screen-consumed.v1.json",
        "universe.v1.json",
        "source-manifest.v1.json",
    }
    require(set(static_hashes) == expected_frozen, "freeze static file set")
    for name, digest in static_hashes.items():
        require(digest == sha256_path(HERE / name), f"freeze drift: {name}")
    require(freeze.get("trialFamily") == trial_family(), "freeze trial family")
    outcome = cast(Mapping[str, Any], freeze.get("outcomeState"))
    require(
        outcome
        == {
            "runMarkerExists": False,
            "developmentExists": False,
            "selectionExists": False,
            "holdoutOpenExists": False,
            "holdoutExists": False,
            "resultExists": False,
            "hourlyArchiveMemberOpenCount": 0,
        },
        "freeze outcome state",
    )
    require(freeze.get("authority") == protocol.get("authority"), "freeze authority")


def trial_family() -> list[dict[str, int | str]]:
    return [
        {
            "trialId": trial_id,
            "tailSize": tail_size,
            "entryHourUtc": 2,
            "exitHourUtc": exit_hour,
        }
        for trial_id, (tail_size, exit_hour) in EXPECTED_TRIALS.items()
    ]


def validate_gate(gate: Mapping[str, Any], label: str) -> None:
    checks_raw = gate.get("checks")
    require(
        isinstance(checks_raw, dict) and bool(checks_raw),
        f"{label}: checks",
    )
    checks = cast(dict[str, Any], checks_raw)
    require(all(isinstance(value, bool) for value in checks.values()), f"{label}: check")
    passed = sum(cast(Mapping[str, bool], checks).values())
    require(gate.get("passedCount") == passed, f"{label}: passed count")
    require(gate.get("requiredCount") == len(checks), f"{label}: required count")
    require(gate.get("allPassed") is (passed == len(checks)), f"{label}: allPassed")


def validate_scenario(
    scenario: Mapping[str, Any],
    scenario_id: str,
    scheduled_days: int,
) -> None:
    require(scenario.get("scenarioId") == scenario_id, "scenario ID")
    start = decimal(scenario.get("startNavUsd"), "scenario start NAV")
    end = decimal(scenario.get("endNavUsd"), "scenario end NAV")
    net = decimal(scenario.get("netUsdPerInitial1000"), "scenario net")
    require(start == D(1000) and end - start == net, "scenario NAV identity")
    gross = decimal(scenario.get("grossPriceMoveUsd"), "scenario gross USD")
    fees = decimal(scenario.get("publicFeeUsd"), "scenario fee USD")
    adverse = decimal(scenario.get("adverseExecutionUsd"), "scenario adverse USD")
    residual = decimal(scenario.get("identityResidualUsd"), "scenario residual")
    require(abs(gross - fees - adverse - net) <= D("1e-40"), "cost identity")
    require(abs(residual) <= D("1e-40"), "reported cost residual")
    require(scenario.get("borrowCostUsd") is None, "borrow cost must be null")
    require(
        scenario.get("accountEffectiveNetUsdPerInitial1000") is None,
        "account net must be null",
    )
    returns_raw = scenario.get("dailyReturns")
    require(
        isinstance(returns_raw, list) and len(returns_raw) == scheduled_days,
        "daily return length",
    )
    returns = cast(list[Any], returns_raw)
    for value in returns:
        require(decimal(value, "daily return") > D(-1), "daily return domain")
    drawdown = cast(Mapping[str, Any], scenario.get("drawdown"))
    maximum = decimal(drawdown.get("maximumPct"), "drawdown")
    require(maximum >= 0, "drawdown domain")


def validate_trial(
    trial_row: Mapping[str, Any],
    *,
    scheduled_days: int,
    start_date: date,
    symbols: set[str],
    expected_trial_id: str | None = None,
) -> None:
    spec = cast(Mapping[str, Any], trial_row.get("trial"))
    trial_id_raw = spec.get("trialId")
    require(
        isinstance(trial_id_raw, str) and trial_id_raw in EXPECTED_TRIALS,
        "trial ID",
    )
    trial_id = cast(str, trial_id_raw)
    if expected_trial_id is not None:
        require(trial_id == expected_trial_id, "holdout champion trial")
    tail_size, exit_hour = EXPECTED_TRIALS[trial_id]
    require(spec.get("tailSize") == tail_size, "trial tail size")
    require(spec.get("entryHourUtc") == 2, "trial entry hour")
    require(spec.get("exitHourUtc") == exit_hour, "trial exit hour")
    require(trial_row.get("scheduledDays") == scheduled_days, "scheduled days")
    active_days = trial_row.get("activeDays")
    cash_days = trial_row.get("cashDays")
    require(
        isinstance(active_days, int)
        and isinstance(cash_days, int)
        and active_days + cash_days == scheduled_days,
        "active/cash partition",
    )
    traded_raw = trial_row.get("distinctTradedSymbols")
    require(isinstance(traded_raw, list), "distinct symbols type")
    traded = cast(list[str], traded_raw)
    require(
        len(traded) == len(set(traded)) and set(traded) <= symbols,
        "distinct traded symbols",
    )
    capacity = cast(Mapping[str, Any], trial_row.get("capacity"))
    require(capacity.get("count") == active_days, "capacity count")
    require(
        capacity.get("authority") == "PUBLIC_PRIOR_COMPLETE_DAY_QUOTE_VOLUME_PROXY_ONLY",
        "capacity authority",
    )
    require(capacity.get("executableCapacity") == "UNMEASURED", "capacity truth")
    scenarios_raw = trial_row.get("scenarios")
    require(isinstance(scenarios_raw, dict), "scenario mapping")
    scenarios = cast(dict[str, Mapping[str, Any]], scenarios_raw)
    require(set(scenarios) == set(EXPECTED_SCENARIO_COST), "scenario family")
    for scenario_id, scenario_raw in scenarios.items():
        require(isinstance(scenario_raw, dict), "scenario row type")
        validate_scenario(
            scenario_raw,
            scenario_id,
            scheduled_days,
        )
    days_raw = trial_row.get("days")
    require(
        isinstance(days_raw, list) and len(days_raw) == scheduled_days,
        "day matrix",
    )
    days = cast(list[Any], days_raw)
    require(
        [cast(Mapping[str, Any], row).get("day") for row in days]
        == expected_dates(start_date, scheduled_days),
        "day calendar",
    )
    scenario_returns = {
        scenario_id: cast(list[object], row["dailyReturns"])
        for scenario_id, row in scenarios.items()
    }
    observed_active = 0
    observed_symbols: set[str] = set()
    observed_capacities: list[Decimal] = []
    replay_nav = {scenario_id: D(1000) for scenario_id in scenarios}
    replay_gross = {scenario_id: D(0) for scenario_id in scenarios}
    replay_fees = {scenario_id: D(0) for scenario_id in scenarios}
    replay_adverse = {scenario_id: D(0) for scenario_id in scenarios}
    monthly_start: dict[str, dict[str, Decimal]] = {scenario_id: {} for scenario_id in scenarios}
    monthly_end: dict[str, dict[str, Decimal]] = {scenario_id: {} for scenario_id in scenarios}
    for index, day_raw in enumerate(days):
        require(isinstance(day_raw, dict), "day row type")
        day = cast(Mapping[str, Any], day_raw)
        is_active = day.get("active")
        require(isinstance(is_active, bool), "day active type")
        gross = decimal(day.get("grossReturn"), "day gross")
        returns_value = day.get("scenarioReturns")
        require(isinstance(returns_value, dict), "day scenario returns")
        returns_raw = cast(dict[str, Any], returns_value)
        require(set(returns_raw) == set(EXPECTED_SCENARIO_COST), "day scenarios")
        longs_raw = day.get("longs")
        shorts_raw = day.get("shorts")
        require(
            isinstance(longs_raw, list) and isinstance(shorts_raw, list),
            "cohort type",
        )
        longs = cast(list[str], longs_raw)
        shorts = cast(list[str], shorts_raw)
        if is_active:
            observed_active += 1
            require(day.get("cashReason") is None, "active cash reason")
            require(
                len(longs) == tail_size
                and len(shorts) == tail_size
                and not set(longs) & set(shorts),
                "market-neutral cohort",
            )
            require(set(longs) | set(shorts) <= symbols, "cohort universe")
            require(day.get("capacityProxyUsd") is not None, "active capacity")
            observed_capacity = decimal(day.get("capacityProxyUsd"), "capacity")
            require(observed_capacity >= 0, "capacity")
            observed_capacities.append(observed_capacity)
            observed_symbols.update(longs)
            observed_symbols.update(shorts)
        else:
            require(day.get("cashReason") is not None, "cash reason")
            require(not longs and not shorts, "cash cohort")
            require(gross == 0, "cash gross")
            require(day.get("capacityProxyUsd") is None, "cash capacity")
        for scenario_id, cost in EXPECTED_SCENARIO_COST.items():
            value = decimal(
                cast(Mapping[str, Any], returns_raw).get(scenario_id),
                "day scenario return",
            )
            expected = gross - cost if is_active else D(0)
            require(value == expected, "frozen public-cost return identity")
            require(
                value == decimal(scenario_returns[scenario_id][index], "daily return"),
                "day/scenario return mismatch",
            )
            month = cast(str, day.get("day"))[:7]
            monthly_start[scenario_id].setdefault(month, replay_nav[scenario_id])
            opening_nav = replay_nav[scenario_id]
            fee_rate, adverse_rate = EXPECTED_SCENARIO_COMPONENTS[scenario_id]
            if is_active:
                replay_gross[scenario_id] += opening_nav * gross
                replay_fees[scenario_id] += opening_nav * fee_rate
                replay_adverse[scenario_id] += opening_nav * adverse_rate
            replay_nav[scenario_id] = opening_nav * (D(1) + value)
            monthly_end[scenario_id][month] = replay_nav[scenario_id]
    require(observed_active == active_days, "active day recount")
    require(observed_symbols == set(traded), "distinct symbol recount")
    if observed_capacities:
        ordered_capacities = sorted(observed_capacities)
        p05_index = int(D("0.05") * D(len(ordered_capacities) - 1))
        midpoint = len(ordered_capacities) // 2
        median = (
            ordered_capacities[midpoint]
            if len(ordered_capacities) % 2
            else (ordered_capacities[midpoint - 1] + ordered_capacities[midpoint]) / 2
        )
        require(
            decimal(capacity.get("minimumUsd"), "capacity minimum") == ordered_capacities[0],
            "capacity minimum replay",
        )
        require(
            decimal(capacity.get("p05Usd"), "capacity p05") == ordered_capacities[p05_index],
            "capacity p05 replay",
        )
        require(
            decimal(capacity.get("medianUsd"), "capacity median") == median,
            "capacity median replay",
        )
    else:
        require(
            capacity.get("minimumUsd") is None
            and capacity.get("p05Usd") is None
            and capacity.get("medianUsd") is None,
            "empty capacity summary",
        )
    for scenario_id, scenario in scenarios.items():
        require(
            decimal(scenario.get("endNavUsd"), "replay end NAV") == replay_nav[scenario_id],
            "end NAV replay",
        )
        require(
            decimal(scenario.get("netUsdPerInitial1000"), "replay net")
            == replay_nav[scenario_id] - 1000,
            "net replay",
        )
        require(
            decimal(scenario.get("grossPriceMoveUsd"), "replay gross") == replay_gross[scenario_id],
            "gross replay",
        )
        require(
            decimal(scenario.get("publicFeeUsd"), "replay fees") == replay_fees[scenario_id],
            "fee replay",
        )
        require(
            decimal(scenario.get("adverseExecutionUsd"), "replay adverse")
            == replay_adverse[scenario_id],
            "adverse replay",
        )
        positive_months = sum(
            1
            for month, opening_nav in monthly_start[scenario_id].items()
            if monthly_end[scenario_id][month] > opening_nav
        )
        require(
            scenario.get("positiveMonths") == positive_months,
            "positive month replay",
        )
        require(
            scenario.get("monthCount") == len(monthly_start[scenario_id]),
            "month count replay",
        )


def validate_statistics(
    statistics: Mapping[str, Any],
    trial_ids: set[str],
) -> str:
    require(
        statistics.get("schema") == "cosmos.quant.research.s2h.development_statistics.v1",
        "development statistics schema",
    )
    require(statistics.get("bootstrapReplicates") == 16384, "statistics replicates")
    champion_raw = statistics.get("championTrialId")
    require(
        isinstance(champion_raw, str) and champion_raw in trial_ids,
        "champion",
    )
    champion = cast(str, champion_raw)
    intervals = statistics.get("stressIntervalsByTrial")
    require(isinstance(intervals, dict) and set(intervals) == trial_ids, "interval family")
    champion_intervals = statistics.get("championIntervals")
    require(
        isinstance(champion_intervals, dict)
        and set(champion_intervals) == {"public_base", "public_stress", "fee_stress"},
        "champion interval scenarios",
    )
    require(
        cast(Mapping[str, Any], champion_intervals).get("public_stress")
        == cast(Mapping[str, Any], intervals).get(champion),
        "champion stress interval binding",
    )
    require(
        statistics.get("championSelection")
        == (
            "HIGHEST_MINIMUM_STRESS_BONFERRONI_LOWER_7_14_THEN_STRESS_NET_"
            "THEN_LOWER_STRESS_DRAWDOWN_THEN_TRIAL_ID"
        ),
        "champion selection law",
    )
    for interval_group in (
        *cast(Mapping[str, Mapping[str, Any]], intervals).values(),
        *cast(Mapping[str, Mapping[str, Any]], champion_intervals).values(),
    ):
        require(set(interval_group) == {"7", "14"}, "interval block family")
        for block, row_raw in interval_group.items():
            row = cast(Mapping[str, Any], row_raw)
            require(row.get("blockDays") == int(block), "interval block")
            for key in (
                "lower95UsdPer1000",
                "upper95UsdPer1000",
                "bonferroniLowerUsdPer1000",
            ):
                require(isinstance(row.get(key), (int, float)), f"interval {key}")
            require(
                float(row["bonferroniLowerUsdPer1000"])
                <= float(row["lower95UsdPer1000"])
                <= float(row["upper95UsdPer1000"]),
                "interval ordering",
            )
    white = cast(Mapping[str, Any], statistics.get("whiteStyleRealityCheck"))
    require(
        white.get("method") == "SYNCHRONOUS_CENTERED_CIRCULAR_BLOCK_MAX_STUDENTIZED",
        "White method",
    )
    require(white.get("blockDays") == 7, "White block")
    require(white.get("replicates") == 16384, "White replicates")
    individual = cast(Mapping[str, Any], white.get("individualOneSidedP"))
    require(set(individual) == trial_ids, "White trial family")
    for trial_id, value in individual.items():
        finite_probability(value, f"White p {trial_id}")
    finite_probability(white.get("jointMaximumP"), "White joint p")
    holm = cast(Mapping[str, Mapping[str, Any]], statistics.get("holm"))
    require(set(holm) == trial_ids, "Holm trial family")
    raw_values = {
        trial_id: finite_probability(value, "Holm raw") for trial_id, value in individual.items()
    }
    ordered = sorted(raw_values.items(), key=lambda item: (item[1], item[0]))
    expected_adjusted: dict[str, float] = {}
    running = 0.0
    for index, (trial_id, raw) in enumerate(ordered):
        running = max(running, min(1.0, (len(ordered) - index) * raw))
        expected_adjusted[trial_id] = running
    for trial_id, row in holm.items():
        require(
            finite_probability(row.get("rawP"), "Holm raw binding") == raw_values[trial_id],
            "Holm raw binding",
        )
        adjusted = finite_probability(row.get("adjustedP"), "Holm adjusted")
        require(adjusted == expected_adjusted[trial_id], "Holm adjustment")
        require(row.get("passed") is (adjusted <= 0.05), "Holm pass")
    pbo = cast(Mapping[str, Any], statistics.get("pbo"))
    require(pbo.get("method") == "CSCV", "PBO method")
    require(pbo.get("blocks") == 8 and pbo.get("inSampleBlocks") == 4, "PBO shape")
    require(pbo.get("splits") == 70, "PBO splits")
    require(
        pbo.get("role") == "DIAGNOSTIC_ONLY_NOT_SELECTOR_PVALUE_LCB_OR_VERDICT_OVERRIDE",
        "PBO role",
    )
    rows = pbo.get("rows")
    require(isinstance(rows, list) and len(rows) == 70, "PBO rows")
    pbo_rows = cast(list[Mapping[str, Any]], rows)
    month_blocks = set(EXPECTED_MONTHS[1:9])
    observed_splits: set[tuple[str, ...]] = set()
    for row in pbo_rows:
        months = cast(list[str], row.get("inSampleMonths"))
        require(
            len(months) == 4 and len(set(months)) == 4 and set(months) <= month_blocks,
            "PBO in-sample block",
        )
        observed_splits.add(tuple(sorted(months)))
        require(row.get("selectedTrialId") in trial_ids, "PBO selected trial")
        selected_oos = row.get("selectedOutSampleScore")
        median_oos = row.get("allTrialOutSampleMedian")
        require(
            isinstance(selected_oos, (int, float)) and isinstance(median_oos, (int, float)),
            "PBO OOS scores",
        )
        require(
            row.get("underperformed")
            is (float(cast(int | float, selected_oos)) <= float(cast(int | float, median_oos))),
            "PBO underperformance replay",
        )
    require(len(observed_splits) == 70, "PBO unique split coverage")
    underperforming = sum(1 for row in pbo_rows if row.get("underperformed") is True)
    require(pbo.get("underperformingSplits") == underperforming, "PBO recount")
    require(
        finite_probability(pbo.get("pbo"), "PBO value") == underperforming / 70,
        "PBO value",
    )
    return champion


def validate_development(
    development: Mapping[str, Any],
    symbols: set[str],
) -> tuple[str, bool]:
    require(
        development.get("schema") == "cosmos.quant.research.s2h.development.v1",
        "development schema",
    )
    require(development.get("state") == "DEVELOPMENT_EVALUATED_ONCE", "dev state")
    directed_hash(development, "runMarkerSha256", HERE / "run-marker.v1.json")
    directed_hash(development, "freezeSha256", HERE / "freeze.v1.json")
    require(development.get("memberOpenCount") == 270, "development member count")
    require(
        development.get("monthsOpened") == list(EXPECTED_MONTHS[:9]),
        "development months",
    )
    require(development.get("scheduledDays") == 243, "development days")
    require(development.get("holdoutMembersOpened") == 0, "premature holdout open")
    trials_raw = development.get("trials")
    require(
        isinstance(trials_raw, list) and len(trials_raw) == 6,
        "development trials",
    )
    trials = cast(list[Any], trials_raw)
    trial_ids: set[str] = set()
    rows_by_id: dict[str, Mapping[str, Any]] = {}
    for row_raw in trials:
        require(isinstance(row_raw, dict), "development trial type")
        row = cast(Mapping[str, Any], row_raw)
        validate_trial(
            row,
            scheduled_days=243,
            start_date=date(2025, 7, 1),
            symbols=symbols,
        )
        trial_id = cast(str, cast(Mapping[str, Any], row["trial"])["trialId"])
        require(trial_id not in trial_ids, "duplicate trial")
        trial_ids.add(trial_id)
        rows_by_id[trial_id] = row
    require(trial_ids == set(EXPECTED_TRIALS), "development trial family")
    statistics = cast(Mapping[str, Any], development.get("statistics"))
    champion = validate_statistics(statistics, trial_ids)
    stress_by_trial = cast(
        Mapping[str, Mapping[str, Mapping[str, float]]],
        statistics.get("stressIntervalsByTrial"),
    )

    def champion_key(trial_id: str) -> tuple[float, float, float, str]:
        row = rows_by_id[trial_id]
        stress_scenario = cast(
            Mapping[str, Any],
            cast(Mapping[str, Any], row.get("scenarios")).get("public_stress"),
        )
        intervals = stress_by_trial[trial_id]
        minimum_bonferroni = min(
            float(intervals["7"]["bonferroniLowerUsdPer1000"]),
            float(intervals["14"]["bonferroniLowerUsdPer1000"]),
        )
        stress_net = float(decimal(stress_scenario.get("netUsdPerInitial1000"), "champion net"))
        drawdown = float(
            decimal(
                cast(Mapping[str, Any], stress_scenario.get("drawdown")).get("maximumPct"),
                "champion drawdown",
            )
        )
        return (-minimum_bonferroni, -stress_net, drawdown, trial_id)

    recomputed_champion = sorted(trial_ids, key=champion_key)[0]
    require(champion == recomputed_champion, "champion selection replay")
    gate = cast(Mapping[str, Any], development.get("gate"))
    validate_gate(gate, "development gate")
    require(gate.get("trialId") == champion, "development gate champion")
    require(gate.get("pboIsGate") is False, "PBO must not be a gate")
    champion_row = rows_by_id[champion]
    checks = cast(Mapping[str, bool], gate.get("checks"))
    champion_scenarios = cast(Mapping[str, Mapping[str, Any]], champion_row.get("scenarios"))
    stress = champion_scenarios["public_stress"]
    stress_intervals = cast(
        Mapping[str, Mapping[str, float]],
        cast(Mapping[str, Any], statistics.get("championIntervals")).get("public_stress"),
    )
    holm = cast(Mapping[str, Mapping[str, Any]], statistics.get("holm"))
    white = cast(Mapping[str, Any], statistics.get("whiteStyleRealityCheck"))
    capacity = cast(Mapping[str, Any], champion_row.get("capacity"))
    capacity_p05_raw = capacity.get("p05Usd")
    expected_checks = {
        "publicBaseNetPositive": (
            decimal(champion_scenarios["public_base"]["netUsdPerInitial1000"], "net") > 0
        ),
        "publicStressNetPositive": (decimal(stress["netUsdPerInitial1000"], "net") > 0),
        "feeStressNetPositive": (
            decimal(champion_scenarios["fee_stress"]["netUsdPerInitial1000"], "net") > 0
        ),
        "stressPrimary95LowerPositive": (float(stress_intervals["7"]["lower95UsdPer1000"]) > 0),
        "stressSensitivity95LowerPositive": (
            float(stress_intervals["14"]["lower95UsdPer1000"]) > 0
        ),
        "stressPrimaryBonferroniLowerPositive": (
            float(stress_intervals["7"]["bonferroniLowerUsdPer1000"]) > 0
        ),
        "stressSensitivityBonferroniLowerPositive": (
            float(stress_intervals["14"]["bonferroniLowerUsdPer1000"]) > 0
        ),
        "holmPassed": holm[champion].get("passed") is True,
        "whiteStyleRealityCheckPassed": (float(white["jointMaximumP"]) <= 0.05),
        "minimumActiveDays": cast(int, champion_row.get("activeDays")) >= 180,
        "minimumDistinctTradedSymbols": (
            len(cast(list[str], champion_row.get("distinctTradedSymbols"))) >= 15
        ),
        "minimumPositiveStressMonths": cast(int, stress.get("positiveMonths")) >= 5,
        "maximumStressDrawdown": (
            decimal(
                cast(Mapping[str, Any], stress.get("drawdown")).get("maximumPct"),
                "development drawdown",
            )
            <= 25
        ),
        "minimumStressCapacityProxy": (
            capacity_p05_raw is not None
            and decimal(capacity_p05_raw, "development capacity p05") >= 1000
        ),
    }
    require(checks == expected_checks, "development gate recomputation")
    return champion, bool(gate.get("allPassed"))


def validate_run_marker(marker: Mapping[str, Any]) -> None:
    require(
        marker.get("schema") == "cosmos.quant.research.s2h.run_marker.v1",
        "run marker schema",
    )
    require(
        marker.get("state") == "SOLE_OUTCOME_RUN_CONSUMED_BEFORE_DEVELOPMENT_MEMBER_OPEN",
        "run marker state",
    )
    directed_hash(marker, "freezeSha256", HERE / "freeze.v1.json")
    directed_hash(marker, "protocolSha256", HERE / "protocol.v1.json")
    directed_hash(marker, "sourceManifestSha256", HERE / "source-manifest.v1.json")
    require(marker.get("allowedRunCount") == 1, "allowed run count")
    require(marker.get("runOrdinal") == 1, "run ordinal")
    require(marker.get("networkDuringEvaluation") is False, "evaluation network")
    require(marker.get("holdoutMemberOpenCountAtCreation") == 0, "holdout at run")


def validate_selection(
    selection: Mapping[str, Any],
    champion: str,
    development_passed: bool,
) -> None:
    require(development_passed, "selection exists after failed development")
    require(
        selection.get("schema") == "cosmos.quant.research.s2h.selection.v1",
        "selection schema",
    )
    require(selection.get("state") == "ONE_DEVELOPMENT_CHAMPION_SEALED", "selection")
    require(selection.get("trialId") == champion, "selected champion")
    directed_hash(selection, "developmentSha256", HERE / "development.v1.json")
    require(selection.get("runnerUpSubstitution") is False, "runner-up substitution")
    require(selection.get("reselection") is False, "reselection")


def validate_holdout(
    holdout_open: Mapping[str, Any],
    holdout: Mapping[str, Any],
    champion: str,
    symbols: set[str],
) -> bool:
    require(
        holdout_open.get("schema") == "cosmos.quant.research.s2h.holdout_open.v1",
        "holdout-open schema",
    )
    require(
        holdout_open.get("state") == "SOLE_HOLDOUT_OPEN_CONSUMED_BEFORE_MEMBER_OPEN",
        "holdout-open state",
    )
    directed_hash(holdout_open, "selectionSha256", HERE / "selection.v1.json")
    directed_hash(holdout_open, "developmentSha256", HERE / "development.v1.json")
    directed_hash(holdout_open, "freezeSha256", HERE / "freeze.v1.json")
    require(holdout_open.get("trialId") == champion, "holdout-open champion")
    require(holdout_open.get("openOrdinal") == 1, "holdout ordinal")
    require(
        holdout.get("schema") == "cosmos.quant.research.s2h.holdout.v1",
        "holdout schema",
    )
    require(
        holdout.get("state") == "HOLDOUT_EVALUATED_ONCE_CHAMPION_ONLY",
        "holdout state",
    )
    directed_hash(holdout, "holdoutOpenSha256", HERE / "holdout-open.v1.json")
    require(holdout.get("memberOpenCount") == 120, "holdout member count")
    require(holdout.get("monthsOpened") == list(EXPECTED_MONTHS[9:]), "holdout months")
    require(holdout.get("scheduledDays") == 115, "holdout days")
    trial_row = cast(Mapping[str, Any], holdout.get("trial"))
    validate_trial(
        trial_row,
        scheduled_days=115,
        start_date=date(2026, 3, 8),
        symbols=symbols,
        expected_trial_id=champion,
    )
    statistics = cast(Mapping[str, Any], holdout.get("statistics"))
    require(statistics.get("bootstrapReplicates") == 16384, "holdout replicates")
    finite_probability(statistics.get("stressOneSidedP"), "holdout p")
    intervals = statistics.get("intervals")
    require(
        isinstance(intervals, dict)
        and set(intervals) == {"public_base", "public_stress", "fee_stress"},
        "holdout intervals",
    )
    for scenario_intervals in cast(
        Mapping[str, Mapping[str, Mapping[str, Any]]], intervals
    ).values():
        require(set(scenario_intervals) == {"7", "14"}, "holdout block family")
        for block, row in scenario_intervals.items():
            require(row.get("blockDays") == int(block), "holdout interval block")
            lower = row.get("lower95UsdPer1000")
            upper = row.get("upper95UsdPer1000")
            bonferroni = row.get("bonferroniLowerUsdPer1000")
            require(
                isinstance(lower, (int, float))
                and isinstance(upper, (int, float))
                and isinstance(bonferroni, (int, float))
                and float(bonferroni) <= float(lower) <= float(upper),
                "holdout interval ordering",
            )
    gate = cast(Mapping[str, Any], holdout.get("gate"))
    validate_gate(gate, "holdout gate")
    checks = cast(Mapping[str, bool], gate.get("checks"))
    scenarios = cast(Mapping[str, Mapping[str, Any]], trial_row.get("scenarios"))
    stress = scenarios["public_stress"]
    stress_intervals = cast(
        Mapping[str, Mapping[str, float]],
        cast(Mapping[str, Any], intervals).get("public_stress"),
    )
    capacity = cast(Mapping[str, Any], trial_row.get("capacity"))
    capacity_p05_raw = capacity.get("p05Usd")
    expected_checks = {
        "publicBaseNetPositive": (
            decimal(scenarios["public_base"]["netUsdPerInitial1000"], "holdout net") > 0
        ),
        "publicStressNetPositive": (
            decimal(stress["netUsdPerInitial1000"], "holdout stress net") > 0
        ),
        "feeStressNetPositive": (
            decimal(scenarios["fee_stress"]["netUsdPerInitial1000"], "holdout net") > 0
        ),
        "stressPrimary95LowerPositive": (float(stress_intervals["7"]["lower95UsdPer1000"]) > 0),
        "stressSensitivity95LowerPositive": (
            float(stress_intervals["14"]["lower95UsdPer1000"]) > 0
        ),
        "stressOneSidedP": float(statistics["stressOneSidedP"]) <= 0.05,
        "minimumActiveDays": cast(int, trial_row.get("activeDays")) >= 90,
        "minimumDistinctTradedSymbols": (
            len(cast(list[str], trial_row.get("distinctTradedSymbols"))) >= 10
        ),
        "minimumPositiveStressMonths": cast(int, stress.get("positiveMonths")) >= 3,
        "maximumStressDrawdown": (
            decimal(
                cast(Mapping[str, Any], stress.get("drawdown")).get("maximumPct"),
                "holdout drawdown",
            )
            <= 25
        ),
        "minimumStressCapacityProxy": (
            capacity_p05_raw is not None
            and decimal(capacity_p05_raw, "holdout capacity p05") >= 1000
        ),
    }
    require(checks == expected_checks, "holdout gate recomputation")
    return bool(gate.get("allPassed"))


def validate_result(
    result: Mapping[str, Any],
    *,
    development: Mapping[str, Any] | None,
    champion: str | None,
    development_passed: bool | None,
    holdout: Mapping[str, Any] | None,
    holdout_passed: bool | None,
    names: set[str],
) -> str:
    require(result.get("schema") == "cosmos.quant.research.s2h.result.v1", "result schema")
    require(result.get("milestone") == "S-2H", "result milestone")
    label = result.get("terminalLabel")
    require(
        label in {"PUBLIC_PROXY_PASS_CAPITAL_NO_GO", "NO_GO", "UNMEASURED"},
        "terminal label",
    )
    require(result.get("canonicalBaseCommit") == BASE_COMMIT, "result base")
    directed_hash(result, "protocolSha256", HERE / "protocol.v1.json")
    directed_hash(result, "freezeSha256", HERE / "freeze.v1.json")
    directed_hash(result, "runMarkerSha256", HERE / "run-marker.v1.json")
    optional_hashes = {
        "developmentSha256": "development.v1.json",
        "selectionSha256": "selection.v1.json",
        "holdoutOpenSha256": "holdout-open.v1.json",
        "holdoutSha256": "holdout.v1.json",
    }
    for field, name in optional_hashes.items():
        if name in names:
            directed_hash(result, field, HERE / name)
        else:
            require(result.get(field) is None, f"{field}: must be null")
    require(
        result.get("publicSyntheticNetMeasured") is (development is not None),
        "public measurement state",
    )
    require(result.get("accountEffectiveNetUsdPerInitial1000") is None, "account net")
    require(result.get("accountEffectiveFees") == "UNKNOWN", "account fees")
    require(result.get("shortBorrowAvailabilityAndCost") == "UNKNOWN", "borrow truth")
    require(result.get("historicalFilters") == "UNKNOWN", "filter truth")
    require(result.get("executableCapacity") == "UNMEASURED", "capacity truth")
    require(
        result.get("capacityAuthority") == "PUBLIC_PRIOR_COMPLETE_DAY_QUOTE_VOLUME_PROXY_ONLY",
        "capacity authority",
    )
    require(
        result.get("globalHoldoutState") == "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "global holdout truth",
    )
    require(result.get("limitations") == EXPECTED_LIMITATIONS, "result limitations")
    require(result.get("capitalVerdict") == "NO_GO", "capital verdict")
    require(result.get("executionAuthority") == "NONE", "execution authority")
    require(result.get("moneyMovedUsd") == 0, "money moved")
    require(result.get("consumer") == "N3-S1_OR_SUCCESSOR_SCOREBOARD", "consumer")
    require(result.get("championTrialId") == champion, "result champion")
    if development is not None:
        require(
            result.get("championDevelopment")
            == next(
                row
                for row in cast(list[Mapping[str, Any]], development["trials"])
                if cast(Mapping[str, Any], row["trial"])["trialId"] == champion
            ),
            "embedded champion",
        )
        require(
            result.get("developmentStatistics") == development.get("statistics"),
            "embedded development statistics",
        )
    else:
        require(result.get("championDevelopment") is None, "unexpected champion")
        require(result.get("developmentStatistics") is None, "unexpected statistics")
    require(result.get("holdout") == holdout, "embedded holdout")
    if label == "UNMEASURED":
        expected_state = (
            "OPENED_TERMINAL_UNMEASURED" if "holdout-open.v1.json" in names else "SEALED_UNOPENED"
        )
        require(result.get("holdoutState") == expected_state, "unmeasured holdout state")
    elif holdout is None:
        require(development_passed is False, "NO_GO without failed development")
        require(label == "NO_GO", "development failure label")
        require(result.get("holdoutState") == "SEALED_UNOPENED", "sealed holdout")
        require(
            result.get("reason") == "DEVELOPMENT_GATES_NOT_ALL_PASSED",
            "development reason",
        )
    else:
        require(result.get("holdoutState") == "OPENED_EVALUATED_ONCE", "holdout state")
        expected_label = "PUBLIC_PROXY_PASS_CAPITAL_NO_GO" if holdout_passed else "NO_GO"
        require(label == expected_label, "holdout verdict")
    return cast(str, label)


def validate_lifecycle(
    names: set[str],
    protocol: Mapping[str, Any],
) -> tuple[str, int]:
    generated = names & GENERATED_FILES
    if not generated:
        return "PRE_SCREEN", 0
    require(
        {"screen-consumed.v1.json", "universe.v1.json"} <= names,
        "partial screen lifecycle",
    )
    screen = load_json(HERE / "screen-consumed.v1.json")
    universe = load_json(HERE / "universe.v1.json")
    symbols = validate_screen(screen, universe, HERE / "protocol.v1.json")
    validate_inherited_provenance(screen, universe, protocol)
    validate_anchor_sources(universe)
    if "source-manifest.v1.json" not in names:
        require(
            not (
                generated
                & {
                    "freeze.v1.json",
                    "run-marker.v1.json",
                    "development.v1.json",
                    "selection.v1.json",
                    "holdout-open.v1.json",
                    "holdout.v1.json",
                    "result.v1.json",
                }
            ),
            "outcome lifecycle before source manifest",
        )
        return "SCREENED", 0
    manifest = load_json(HERE / "source-manifest.v1.json")
    state_root, pair_count = validate_manifest(manifest, universe, HERE / "protocol.v1.json")
    if "freeze.v1.json" not in names:
        require(
            not (
                generated
                & {
                    "run-marker.v1.json",
                    "development.v1.json",
                    "selection.v1.json",
                    "holdout-open.v1.json",
                    "holdout.v1.json",
                    "result.v1.json",
                }
            ),
            "outcome lifecycle before freeze",
        )
        return "SOURCES_FROZEN", pair_count
    freeze = load_json(HERE / "freeze.v1.json")
    validate_freeze(freeze, protocol, state_root)
    outcome_names = {
        "run-marker.v1.json",
        "development.v1.json",
        "selection.v1.json",
        "holdout-open.v1.json",
        "holdout.v1.json",
        "result.v1.json",
    }
    if not (names & outcome_names):
        return "PRE_OUTCOME_FROZEN", pair_count
    require("run-marker.v1.json" in names, "outcome without run marker")
    marker = load_json(HERE / "run-marker.v1.json")
    validate_run_marker(marker)
    if "result.v1.json" not in names:
        return "RUN_IN_PROGRESS", pair_count
    result = load_json(HERE / "result.v1.json")
    development: Mapping[str, Any] | None = None
    champion: str | None = None
    development_passed: bool | None = None
    if "development.v1.json" in names:
        development = load_json(HERE / "development.v1.json")
        champion, development_passed = validate_development(development, set(symbols))
    require(
        "holdout-open.v1.json" not in names or "selection.v1.json" in names,
        "holdout-open without selection",
    )
    require(
        "holdout.v1.json" not in names or "holdout-open.v1.json" in names,
        "holdout without holdout-open",
    )
    holdout: Mapping[str, Any] | None = None
    holdout_passed: bool | None = None
    if "selection.v1.json" in names:
        require(development is not None and champion is not None, "selection before dev")
        champion_value = cast(str, champion)
        selection = load_json(HERE / "selection.v1.json")
        validate_selection(selection, champion_value, bool(development_passed))
        if "holdout-open.v1.json" in names:
            holdout_open = load_json(HERE / "holdout-open.v1.json")
            if "holdout.v1.json" in names:
                holdout = load_json(HERE / "holdout.v1.json")
                holdout_passed = validate_holdout(
                    holdout_open, holdout, champion_value, set(symbols)
                )
            else:
                require(
                    result.get("terminalLabel") == "UNMEASURED",
                    "opened holdout without evidence",
                )
        else:
            require(
                result.get("terminalLabel") == "UNMEASURED",
                "selection without holdout-open",
            )
    else:
        require("holdout-open.v1.json" not in names, "holdout-open without selection")
        require("holdout.v1.json" not in names, "holdout without selection")
    label = validate_result(
        result,
        development=development,
        champion=champion,
        development_passed=development_passed,
        holdout=holdout,
        holdout_passed=holdout_passed,
        names=names,
    )
    return f"TERMINAL_{label}", pair_count


def validate_sha256sums(names: set[str]) -> bool:
    if "SHA256SUMS" not in names:
        return False
    rows: dict[str, str] = {}
    try:
        lines = physical_file(HERE / "SHA256SUMS").read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as exc:
        raise VerificationError(f"invalid SHA256SUMS: {exc}") from exc
    for line in lines:
        fields = line.split()
        require(len(fields) == 2, "SHA256SUMS row")
        digest, name = fields
        name = name.removeprefix("*")
        require(
            len(digest) == 64
            and all(character in "0123456789abcdefABCDEF" for character in digest),
            "SHA256SUMS digest",
        )
        require(
            name in names and name != "SHA256SUMS" and "/" not in name,
            "SHA256SUMS filename",
        )
        require(name not in rows, "SHA256SUMS duplicate")
        rows[name] = digest.lower()
    require(set(rows) == names - {"SHA256SUMS"}, "SHA256SUMS coverage")
    for name, expected in rows.items():
        require(sha256_path(HERE / name) == expected, f"SHA256SUMS mismatch: {name}")
    return True


def git_output(arguments: Sequence[str]) -> str:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=HERE,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        fail(f"git command failed: {' '.join(arguments)}")
    return completed.stdout.strip()


def validate_git(names: set[str]) -> None:
    require(not git_output(["status", "--porcelain", "--untracked-files=all"]), "git dirty")
    head = git_output(["rev-parse", "HEAD"])
    require(
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", BASE_COMMIT, head],
            cwd=HERE,
            check=False,
            capture_output=True,
        ).returncode
        == 0,
        "base is not ancestor",
    )
    changed = git_output(["diff", "--name-only", f"{BASE_COMMIT}..{head}"]).splitlines()
    require(bool(changed), "no S-2H commit delta")
    require(
        all(name.startswith("quant/research/s2h/") for name in changed),
        "git scope escaped S-2H",
    )
    require(
        {Path(name).name for name in changed} == names,
        "git packet/commit file mismatch",
    )
    if "freeze.v1.json" in names:
        freeze = load_json(HERE / "freeze.v1.json")
        preoutcome = freeze.get("preOutcomeHead")
        require(isinstance(preoutcome, str), "pre-outcome HEAD")
        preoutcome_head = cast(str, preoutcome)
        require(
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", preoutcome_head, head],
                cwd=HERE,
                check=False,
                capture_output=True,
            ).returncode
            == 0,
            "pre-outcome HEAD is not ancestor",
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify sealed S-2H evidence")
    parser.add_argument(
        "--git",
        action="store_true",
        help="also require clean, base-descended, S-2H-only committed lineage",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        names = validate_packet_shape()
        protocol = load_json(HERE / "protocol.v1.json")
        validate_protocol(protocol)
        lifecycle, pair_count = validate_lifecycle(names, protocol)
        checksums = validate_sha256sums(names)
        if arguments.git:
            validate_git(names)
    except Exception as exc:
        sys.stderr.write(f"S2H_VERIFY_FAIL {type(exc).__name__}:{exc}\n")
        return 2
    sys.stdout.write(
        "S2H_VERIFY_PASS "
        f"state={lifecycle} files={len(names)} pairs={pair_count} "
        f"sha256sums={'VERIFIED' if checksums else 'ABSENT'} "
        f"git={'VERIFIED' if arguments.git else 'NOT_REQUESTED'}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
