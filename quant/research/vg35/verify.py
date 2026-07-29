#!/usr/bin/env python3
"""Independent terminal verifier for the sealed V-G35 research packet.

This verifier uses only the Python standard library.  It does not import the
evaluator, access the network, open a ZIP, or recompute a statistic.  It
authenticates packet custody, frozen identities, cross-file lifecycle bindings,
gate summaries, terminal verdict logic, and the permanent no-authority fields.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, NoReturn, cast

PACKET_DIR = Path(__file__).resolve().parent
QUANT_DIR = PACKET_DIR.parents[1]

PROTOCOL_PATH = PACKET_DIR / "protocol.v1.json"
SOURCE_MANIFEST_PATH = PACKET_DIR / "source_manifest.v1.json"
FREEZE_PATH = PACKET_DIR / "freeze.v1.json"
RUN_MARKER_PATH = PACKET_DIR / "run-marker.v1.json"
DEVELOPMENT_PATH = PACKET_DIR / "development.v1.json"
SELECTION_PATH = PACKET_DIR / "selection.v1.json"
HOLDOUT_MARKER_PATH = PACKET_DIR / "holdout-open-marker.v1.json"
HOLDOUT_PATH = PACKET_DIR / "holdout.v1.json"
RESULT_PATH = PACKET_DIR / "result.v1.json"
SHA256SUMS_PATH = PACKET_DIR / "SHA256SUMS"

JsonObject = dict[str, Any]
HEX_DIGITS = frozenset("0123456789abcdef")


class VerificationError(RuntimeError):
    """One fail-closed packet verification error."""


def _fail(code: str) -> NoReturn:
    raise VerificationError(code)


def _read_json(path: Path) -> JsonObject:
    try:
        raw = path.read_bytes()
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"JSON_UNREADABLE:{path.name}") from error
    if not isinstance(value, dict):
        _fail(f"JSON_ROOT_NOT_OBJECT:{path.name}")
    return cast(JsonObject, value)


def _object(value: Mapping[str, Any], key: str) -> JsonObject:
    found = value.get(key)
    if not isinstance(found, dict):
        _fail(f"EXPECTED_OBJECT:{key}")
    return cast(JsonObject, found)


def _string(value: Mapping[str, Any], key: str) -> str:
    found = value.get(key)
    if not isinstance(found, str):
        _fail(f"EXPECTED_STRING:{key}")
    return found


def _strings(value: Mapping[str, Any], key: str) -> tuple[str, ...]:
    found = value.get(key)
    if not isinstance(found, list) or any(not isinstance(item, str) for item in found):
        _fail(f"EXPECTED_STRING_ARRAY:{key}")
    return tuple(cast(list[str], found))


def _integer(value: Mapping[str, Any], key: str) -> int:
    found = value.get(key)
    if type(found) is not int:
        _fail(f"EXPECTED_INTEGER:{key}")
    return found


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    except OSError as error:
        raise VerificationError(f"FILE_UNREADABLE:{path.name}") from error
    return digest.hexdigest()


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in HEX_DIGITS for character in value)
    )


def _is_git_object_id(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) in {40, 64}
        and all(character in HEX_DIGITS for character in value)
    )


def _require_hash(value: Any, code: str) -> str:
    if not _is_sha256(value):
        _fail(code)
    return cast(str, value)


def _require_file_hash(path: Path, expected: Any, code: str) -> None:
    expected_hash = _require_hash(expected, code)
    if not path.is_file() or path.is_symlink() or _sha256(path) != expected_hash:
        _fail(code)


def _verify_sha256sums_exact() -> int:
    """Authenticate the exact flat packet file set, excluding the inventory."""

    if not SHA256SUMS_PATH.is_file() or SHA256SUMS_PATH.is_symlink():
        _fail("SHA256SUMS_MISSING_OR_INVALID")
    expected_names = sorted(
        path.name
        for path in PACKET_DIR.iterdir()
        if path.is_file() and path.name != SHA256SUMS_PATH.name
    )
    try:
        lines = SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise VerificationError("SHA256SUMS_UNREADABLE") from error
    if not lines or any(not line for line in lines):
        _fail("SHA256SUMS_EMPTY_OR_BLANK")

    found_names: list[str] = []
    for line in lines:
        digest, separator, name = line.partition("  ")
        if (
            separator != "  "
            or not _is_sha256(digest)
            or not name
            or name in {".", "..", SHA256SUMS_PATH.name}
            or "/" in name
            or "\\" in name
        ):
            _fail("SHA256SUMS_ENTRY_INVALID")
        path = PACKET_DIR / name
        if not path.is_file() or path.is_symlink():
            _fail(f"SHA256SUMS_TARGET_INVALID:{name}")
        found_names.append(name)
        if _sha256(path) != digest:
            _fail(f"SHA256SUMS_HASH_MISMATCH:{name}")
    if found_names != expected_names or len(found_names) != len(set(found_names)):
        _fail("SHA256SUMS_EXACT_FILE_SET_MISMATCH")
    return len(found_names)


def _verify_protocol(protocol: Mapping[str, Any]) -> None:
    if protocol.get("version") != "VG35ProtocolV1" or protocol.get("milestone") != "V-G35":
        _fail("PROTOCOL_IDENTITY_MISMATCH")
    if not _is_git_object_id(protocol.get("canonicalBase")):
        _fail("PROTOCOL_CANONICAL_BASE_INVALID")
    if protocol.get("consumer") != "N3 successor/orchestrator scoreboard":
        _fail("PROTOCOL_CONSUMER_MISMATCH")

    authority = _object(protocol, "authority")
    authority_constants = {
        "capital": "NONE",
        "execution": "FORBIDDEN",
        "privateApi": "FORBIDDEN",
        "orders": "FORBIDDEN",
        "transfers": "FORBIDDEN",
        "withdrawals": "FORBIDDEN",
        "moneyEffectUsd": 0,
    }
    if any(authority.get(key) != expected for key, expected in authority_constants.items()):
        _fail("PROTOCOL_AUTHORITY_MISMATCH")
    if type(authority.get("moneyEffectUsd")) is not int:
        _fail("PROTOCOL_MONEY_TYPE_MISMATCH")

    reuse = _object(protocol, "sharedCorpusReuse")
    if (
        reuse.get("globalProgramReuseStatus") != "NOT_CERTIFIED_SHARED_REUSE_RISK"
        or reuse.get("programAdjustedPValue") != "1"
        or type(reuse.get("programVerifiedPositiveEligible")) is not bool
        or reuse.get("programVerifiedPositiveEligible") is not False
    ):
        _fail("PROTOCOL_REUSE_BOUNDARY_MISMATCH")


def _verify_source_manifest(
    protocol: Mapping[str, Any],
    manifest: Mapping[str, Any],
    protocol_sha: str,
) -> list[JsonObject]:
    """Validate packet-local source identities without opening archive paths."""

    if manifest.get("version") != "VG35SourceManifestV1":
        _fail("SOURCE_MANIFEST_VERSION_MISMATCH")
    if manifest.get("protocolSha256") != protocol_sha:
        _fail("SOURCE_MANIFEST_PROTOCOL_BINDING_MISMATCH")
    data = _object(protocol, "data")
    if (
        manifest.get("sourceCorpusRoot") != data.get("sourceCorpusRoot")
        or manifest.get("sharedCustodyManifest") != data.get("sharedCustodyManifest")
        or manifest.get("sharedCorpusReuse") != "READ_ONLY_PRIOR_PROGRAM_CORPUS"
        or manifest.get("globalHoldoutCertification") != "NOT_CERTIFIED_SHARED_REUSE_RISK"
        or type(manifest.get("archiveMembersOpenedByVg35")) is not int
        or manifest.get("archiveMembersOpenedByVg35") != 0
    ):
        _fail("SOURCE_MANIFEST_CUSTODY_BOUNDARY_MISMATCH")

    expected_archive_count = _integer(data, "expectedArchiveCount")
    expected_checksum_count = _integer(data, "expectedChecksumCount")
    if (
        manifest.get("archiveCount") != expected_archive_count
        or manifest.get("checksumCount") != expected_checksum_count
    ):
        _fail("SOURCE_MANIFEST_COUNT_MISMATCH")
    archives = manifest.get("archives")
    if not isinstance(archives, list) or len(archives) != expected_archive_count:
        _fail("SOURCE_MANIFEST_ARCHIVES_INVALID")

    symbols = _strings(data, "symbols")
    months = _strings(data, "archiveMonths")
    interval = _string(data, "archiveInterval")
    template = _string(data, "archiveUrlTemplate")
    checksum_suffix = _string(data, "checksumUrlSuffix")
    expected_keys = {(symbol, month) for symbol in symbols for month in months}
    found_keys: set[tuple[str, str]] = set()
    expected_external: list[JsonObject] = []
    for raw_entry in archives:
        if not isinstance(raw_entry, dict):
            _fail("SOURCE_MANIFEST_ENTRY_INVALID")
        entry = cast(JsonObject, raw_entry)
        symbol = _string(entry, "symbol")
        month = _string(entry, "month")
        key = (symbol, month)
        if key in found_keys:
            _fail("SOURCE_MANIFEST_DUPLICATE")
        found_keys.add(key)
        if entry.get("interval") != interval:
            _fail("SOURCE_MANIFEST_INTERVAL_MISMATCH")

        filename = f"{symbol}-{interval}-{month}.zip"
        relative = f"{symbol}/{filename}"
        url = template.format(symbol=symbol, month=month)
        archive = _object(entry, "archive")
        checksum = _object(entry, "checksum")
        if archive.get("path") != relative or archive.get("url") != url:
            _fail("SOURCE_MANIFEST_ARCHIVE_IDENTITY_MISMATCH")
        if (
            checksum.get("path") != relative + ".CHECKSUM"
            or checksum.get("url") != url + checksum_suffix
        ):
            _fail("SOURCE_MANIFEST_CHECKSUM_IDENTITY_MISMATCH")
        publisher = _require_hash(
            entry.get("publisherSha256"), "SOURCE_MANIFEST_PUBLISHER_HASH_INVALID"
        )
        if archive.get("sha256") != publisher:
            _fail("SOURCE_MANIFEST_PUBLISHER_BINDING_MISMATCH")

        for kind, item in (("archive", archive), ("checksum", checksum)):
            _require_hash(item.get("sha256"), "SOURCE_MANIFEST_OBJECT_HASH_INVALID")
            if type(item.get("bytes")) is not int or cast(int, item["bytes"]) <= 0:
                _fail("SOURCE_MANIFEST_OBJECT_SIZE_INVALID")
            expected_external.append(
                {
                    "kind": kind,
                    "symbol": symbol,
                    "month": month,
                    "path": item["path"],
                    "url": item["url"],
                    "sha256": item["sha256"],
                    "bytes": item["bytes"],
                    "headers": item.get("headers"),
                    "retrievedAtUtc": item.get("retrievedAtUtc"),
                }
            )
    if found_keys != expected_keys:
        _fail("SOURCE_MANIFEST_COVERAGE_MISMATCH")

    custody_path = Path(_string(data, "sharedCustodyManifest"))
    if (
        not custody_path.is_file()
        or custody_path.is_symlink()
        or manifest.get("sharedCustodyManifestSha256") != _sha256(custody_path)
    ):
        _fail("SHARED_CUSTODY_MANIFEST_HASH_MISMATCH")
    expected_external.append(
        {
            "kind": "sharedCustodyManifest",
            "path": str(custody_path),
            "url": None,
            "sha256": _sha256(custody_path),
            "bytes": custody_path.stat().st_size,
            "headers": None,
            "retrievedAtUtc": None,
        }
    )
    return expected_external


def _resolve_freeze_input(relative: str) -> Path:
    packet_prefix = "quant/research/vg35/"
    if relative.startswith(packet_prefix):
        suffix = relative.removeprefix(packet_prefix)
        if not suffix or "/" in suffix or "\\" in suffix:
            _fail("FREEZE_PACKET_INPUT_PATH_INVALID")
        return PACKET_DIR / suffix
    if relative.startswith("quant/"):
        suffix = relative.removeprefix("quant/")
        if not suffix or Path(suffix).is_absolute() or ".." in Path(suffix).parts:
            _fail("FREEZE_RUNTIME_INPUT_PATH_INVALID")
        return QUANT_DIR / suffix
    _fail("FREEZE_INPUT_PATH_INVALID")


def _verify_freeze(
    protocol: Mapping[str, Any],
    freeze: Mapping[str, Any],
    protocol_sha: str,
    manifest_sha: str,
    expected_external: Sequence[Mapping[str, Any]],
) -> None:
    if freeze.get("version") != "VG35FreezeV1":
        _fail("FREEZE_VERSION_MISMATCH")
    if (
        freeze.get("protocolSha256") != protocol_sha
        or freeze.get("sourceManifestSha256") != manifest_sha
        or freeze.get("outcomeRoot") != str(PACKET_DIR)
        or freeze.get("outcomeState") != "EMPTY"
        or type(freeze.get("archiveMembersOpenedBeforeFreeze")) is not int
        or freeze.get("archiveMembersOpenedBeforeFreeze") != 0
    ):
        _fail("FREEZE_ROOT_BINDING_MISMATCH")

    lifecycle = _object(protocol, "lifecycle")
    expected_paths = {
        *(f"quant/research/vg35/{name}" for name in _strings(lifecycle, "freezeBoundPacketPaths")),
        *(
            f"quant/{name}"
            for name in _strings(lifecycle, "freezeBoundRuntimePathsRelativeToQuant")
        ),
    }
    inputs = freeze.get("inputs")
    if not isinstance(inputs, list):
        _fail("FREEZE_INPUTS_INVALID")
    found_paths: set[str] = set()
    for raw_entry in inputs:
        if not isinstance(raw_entry, dict):
            _fail("FREEZE_INPUT_ENTRY_INVALID")
        entry = cast(JsonObject, raw_entry)
        relative = _string(entry, "path")
        if relative in found_paths:
            _fail("FREEZE_INPUT_DUPLICATE")
        found_paths.add(relative)
        path = _resolve_freeze_input(relative)
        if (
            not path.is_file()
            or path.is_symlink()
            or type(entry.get("bytes")) is not int
            or entry.get("bytes") != path.stat().st_size
            or entry.get("sha256") != _sha256(path)
        ):
            _fail(f"FREEZE_INPUT_BINDING_MISMATCH:{relative}")
    if found_paths != expected_paths:
        _fail("FREEZE_INPUT_EXACT_SET_MISMATCH")

    external = freeze.get("externalInputs")
    if not isinstance(external, list) or external != list(expected_external):
        _fail("FREEZE_EXTERNAL_INPUT_BINDING_MISMATCH")

    git_identity = _object(freeze, "git")
    if (
        git_identity.get("canonicalBase") != protocol.get("canonicalBase")
        or git_identity.get("canonicalBaseIsAncestor") is not True
        or git_identity.get("worktreeStatus") != "CLEAN"
        or not _is_git_object_id(git_identity.get("authorityHead"))
        or not _is_git_object_id(git_identity.get("authorityTree"))
    ):
        _fail("FREEZE_GIT_IDENTITY_MISMATCH")


def _gate_map(
    artifact: Mapping[str, Any], map_key: str, summary_key: str
) -> tuple[JsonObject, bool]:
    gates = _object(artifact, map_key)
    if not gates or any(type(value) is not bool for value in gates.values()):
        _fail(f"GATE_MAP_NOT_ALL_BOOLEANS:{map_key}")
    summary = artifact.get(summary_key)
    if type(summary) is not bool or summary != all(cast(bool, value) for value in gates.values()):
        _fail(f"GATE_SUMMARY_MISMATCH:{summary_key}")
    return gates, summary


def _verify_terminal_lifecycle(
    protocol: Mapping[str, Any],
    freeze_sha: str,
    protocol_sha: str,
) -> JsonObject:
    result = _read_json(RESULT_PATH)
    marker = _read_json(RUN_MARKER_PATH)
    result_sha = _sha256(RESULT_PATH)
    marker_sha = _sha256(RUN_MARKER_PATH)
    if result.get("version") != "VG35ResultV1":
        _fail("RESULT_VERSION_MISMATCH")
    if marker.get("version") != "VG35RunMarkerV1":
        _fail("RUN_MARKER_VERSION_MISMATCH")
    if (
        marker.get("freezeSha256") != freeze_sha
        or marker.get("protocolSha256") != protocol_sha
        or marker.get("purpose") != "CONSUMED_BEFORE_FIRST_ZIP_MEMBER_OPEN"
    ):
        _fail("RUN_MARKER_BINDING_MISMATCH")
    if (
        result.get("freezeSha256") != freeze_sha
        or result.get("protocolSha256") != protocol_sha
        or result.get("runMarkerSha256") != marker_sha
    ):
        _fail("RESULT_ROOT_BINDING_MISMATCH")

    authority_constants: dict[str, Any] = {
        "capitalAuthority": "NONE",
        "capitalVerdict": "NO_GO",
        "accountEffectiveFee": "UNKNOWN",
        "executableCapacity": "UNMEASURED",
        "causalIdentification": "NOT_CLAIMED",
        "globalHoldoutCertification": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "programAdjustedPValue": 1.0,
        "verifiedPositiveEligible": False,
        "consumer": "N3 successor/orchestrator scoreboard",
        "moneyEffectUsd": 0,
    }
    if any(result.get(key) != expected for key, expected in authority_constants.items()):
        _fail("RESULT_AUTHORITY_CONSTANT_MISMATCH")
    if (
        type(result.get("programAdjustedPValue")) not in {int, float}
        or type(result.get("verifiedPositiveEligible")) is not bool
        or type(result.get("moneyEffectUsd")) is not int
    ):
        _fail("RESULT_AUTHORITY_CONSTANT_TYPE_MISMATCH")
    if result.get("consumer") != protocol.get("consumer"):
        _fail("RESULT_CONSUMER_PROTOCOL_MISMATCH")

    development_exists = DEVELOPMENT_PATH.is_file()
    selection_exists = SELECTION_PATH.is_file()
    holdout_marker_exists = HOLDOUT_MARKER_PATH.is_file()
    holdout_exists = HOLDOUT_PATH.is_file()
    if not development_exists:
        _fail("TERMINAL_DEVELOPMENT_MISSING")
    if bool(result.get("developmentOpened")) != development_exists:
        _fail("RESULT_DEVELOPMENT_PRESENCE_MISMATCH")
    if bool(result.get("holdoutOpened")) != holdout_marker_exists:
        _fail("RESULT_HOLDOUT_OPEN_PRESENCE_MISMATCH")
    if selection_exists != holdout_marker_exists:
        _fail("SELECTION_HOLDOUT_MARKER_PREFIX_MISMATCH")
    if holdout_exists and not holdout_marker_exists:
        _fail("HOLDOUT_WITHOUT_MARKER")

    development = _read_json(DEVELOPMENT_PATH)
    if development.get("version") != "VG35DevelopmentV1":
        _fail("DEVELOPMENT_VERSION_MISMATCH")
    if (
        development.get("freezeSha256") != freeze_sha
        or development.get("runMarkerSha256") != marker_sha
        or result.get("developmentSha256") != _sha256(DEVELOPMENT_PATH)
    ):
        _fail("DEVELOPMENT_BINDING_MISMATCH")
    development_gates, development_all = _gate_map(
        development, "developmentGates", "allDevelopmentGatesPass"
    )
    champion = _string(development, "championTrialId")
    if result.get("developmentGates") != development_gates:
        _fail("RESULT_DEVELOPMENT_GATES_COPY_MISMATCH")
    if result.get("championTrialId") != champion:
        _fail("RESULT_CHAMPION_COPY_MISMATCH")

    selection: JsonObject | None = None
    if selection_exists:
        if not development_all:
            _fail("SELECTION_WITH_FAILED_DEVELOPMENT")
        selection = _read_json(SELECTION_PATH)
        if selection.get("version") != "VG35SelectionV1" or selection.get("immutable") is not True:
            _fail("SELECTION_IDENTITY_MISMATCH")
        if (
            selection.get("freezeSha256") != freeze_sha
            or selection.get("runMarkerSha256") != marker_sha
            or selection.get("developmentSha256") != _sha256(DEVELOPMENT_PATH)
            or selection.get("championTrialId") != champion
            or result.get("selectionSha256") != _sha256(SELECTION_PATH)
        ):
            _fail("SELECTION_BINDING_MISMATCH")
    elif development_all:
        _fail("PASSED_DEVELOPMENT_WITHOUT_SELECTION")

    if holdout_marker_exists:
        holdout_marker = _read_json(HOLDOUT_MARKER_PATH)
        if (
            holdout_marker.get("version") != "VG35HoldoutOpenMarkerV1"
            or holdout_marker.get("freezeSha256") != freeze_sha
            or holdout_marker.get("selectionSha256") != _sha256(SELECTION_PATH)
            or holdout_marker.get("championTrialId") != champion
            or holdout_marker.get("purpose") != "CONSUMED_BEFORE_FIRST_HOLDOUT_ZIP_MEMBER_OPEN"
        ):
            _fail("HOLDOUT_MARKER_BINDING_MISMATCH")

    holdout_gates: JsonObject | None = None
    holdout_all = False
    if holdout_exists:
        holdout = _read_json(HOLDOUT_PATH)
        if holdout.get("version") != "VG35HoldoutV1":
            _fail("HOLDOUT_VERSION_MISMATCH")
        if (
            holdout.get("freezeSha256") != freeze_sha
            or holdout.get("selectionSha256") != _sha256(SELECTION_PATH)
            or holdout.get("holdoutMarkerSha256") != _sha256(HOLDOUT_MARKER_PATH)
            or holdout.get("championTrialId") != champion
            or result.get("holdoutSha256") != _sha256(HOLDOUT_PATH)
        ):
            _fail("HOLDOUT_BINDING_MISMATCH")
        holdout_gates, holdout_all = _gate_map(holdout, "holdoutGates", "allHoldoutGatesPass")
        if result.get("holdoutGates") != holdout_gates:
            _fail("RESULT_HOLDOUT_GATES_COPY_MISMATCH")

    verdict = result.get("verdict")
    disposition = result.get("disposition")
    if verdict not in {"PUBLIC_RESEARCH_GO_LOCAL", "NO_GO", "UNMEASURED"}:
        _fail("RESULT_VERDICT_INVALID")
    full_chain = selection_exists and holdout_marker_exists and holdout_exists
    development_failure = (
        disposition == "DEVELOPMENT_GATE_FAILURE"
        and not development_all
        and not selection_exists
        and not holdout_marker_exists
        and not holdout_exists
    )
    holdout_failure = (
        disposition == "HOLDOUT_GATE_FAILURE" and development_all and full_chain and not holdout_all
    )
    local_go = (
        disposition == "ALL_LOCAL_PUBLIC_GATES_PASS"
        and development_all
        and full_chain
        and holdout_all
    )
    if verdict == "NO_GO" and not (development_failure or holdout_failure):
        _fail("NO_GO_FAILURE_CHAIN_INVALID")
    if verdict == "PUBLIC_RESEARCH_GO_LOCAL" and not local_go:
        _fail("PUBLIC_RESEARCH_GO_LOCAL_CHAIN_INVALID")
    if verdict == "UNMEASURED":
        if development_failure or holdout_failure or local_go:
            _fail("UNMEASURED_MASQUERADES_AS_MEASURED_OUTCOME")
        if disposition in {
            "DEVELOPMENT_GATE_FAILURE",
            "HOLDOUT_GATE_FAILURE",
            "ALL_LOCAL_PUBLIC_GATES_PASS",
        }:
            _fail("UNMEASURED_RESERVED_DISPOSITION")
        if not isinstance(disposition, str) or not disposition:
            _fail("UNMEASURED_REASON_MISSING")
        if not isinstance(result.get("errorClass"), str) or not result.get("errorClass"):
            _fail("UNMEASURED_ERROR_CLASS_MISSING")
        if not development_all and (selection_exists or holdout_marker_exists or holdout_exists):
            _fail("UNMEASURED_INVALID_FAILED_DEVELOPMENT_PREFIX")
        if development_all and (not selection_exists or not holdout_marker_exists):
            _fail("UNMEASURED_INVALID_PASSED_DEVELOPMENT_PREFIX")
    return {
        "status": "PASS",
        "verdict": verdict,
        "resultSha256": result_sha,
        "developmentOpened": True,
        "holdoutOpened": holdout_marker_exists,
    }


def verify() -> JsonObject:
    """Run the independent, archive-free terminal verification."""

    checksum_entries = _verify_sha256sums_exact()
    protocol = _read_json(PROTOCOL_PATH)
    _verify_protocol(protocol)
    protocol_sha = _sha256(PROTOCOL_PATH)
    manifest = _read_json(SOURCE_MANIFEST_PATH)
    manifest_sha = _sha256(SOURCE_MANIFEST_PATH)
    expected_external = _verify_source_manifest(protocol, manifest, protocol_sha)
    freeze = _read_json(FREEZE_PATH)
    freeze_sha = _sha256(FREEZE_PATH)
    _verify_freeze(protocol, freeze, protocol_sha, manifest_sha, expected_external)
    output = _verify_terminal_lifecycle(protocol, freeze_sha, protocol_sha)
    output.update(
        {
            "verifiedSha256SumEntries": checksum_entries,
            "sourceArchivesReopened": 0,
            "zipMembersOpened": 0,
            "statisticsRecomputed": False,
            "networkUsed": False,
        }
    )
    return output


def main(argv: Sequence[str] | None = None) -> int:
    """Print exactly one machine-readable status object."""

    arguments = tuple(sys.argv[1:] if argv is None else argv)
    if arguments:
        payload: JsonObject = {
            "status": "ERROR",
            "error": "UNEXPECTED_ARGUMENTS",
            "sourceArchivesReopened": 0,
            "zipMembersOpened": 0,
            "statisticsRecomputed": False,
            "networkUsed": False,
        }
        print(json.dumps(payload, sort_keys=True))
        return 2
    try:
        payload = verify()
    except Exception as error:
        code = str(error) if isinstance(error, VerificationError) else "VERIFIER_INTERNAL_ERROR"
        payload = {
            "status": "ERROR",
            "error": code,
            "sourceArchivesReopened": 0,
            "zipMembersOpened": 0,
            "statisticsRecomputed": False,
            "networkUsed": False,
        }
        print(json.dumps(payload, sort_keys=True))
        return 1
    print(json.dumps(payload, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
