"""Independent, network-free verifier for the sealed V-G13 packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, Final, cast

HERE: Final = Path(__file__).resolve().parent
QUANT_ROOT: Final = HERE.parents[1]
BASE_SHA: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
BASE_TREE: Final = "37d1b88aa7c8d9ee1f70dc35d0e78613b6ed32f9"
DISCOVERY_SHA: Final = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
ACQUISITION_SHA: Final = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
UNIVERSE_SHA: Final = "a597d8339aafb74c40b8899cade9445150c3f431f4c2e7fe2bfac37d8d1b0592"
LIMITATION: Final = (
    "This is a sealed public Binance Spot daily-bar counterfactual using proxy "
    "costs. Account fees, historical spread, depth, filters, and fills are "
    "UNKNOWN. It is not account profitability, verified execution, forward "
    "assurance, capacity proof, capital authority, or execution authority."
)
TRUTH: Final = {
    "accountFees": "UNKNOWN",
    "authority": "NONE",
    "capitalAuthority": "NONE",
    "fills": "UNKNOWN",
    "historicalDepth": "UNKNOWN",
    "historicalFilters": "UNKNOWN",
    "historicalSpread": "UNKNOWN",
    "publicBarExecution": "COUNTERFACTUAL_SENSITIVITY_ONLY",
}


class VerificationError(RuntimeError):
    """An independently detected packet-integrity failure."""


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise VerificationError(f"missing or unsafe regular file: {path.name}")
    return path


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_file(path).read_bytes())


def load_json(path: Path, *, canonical: bool) -> tuple[dict[str, Any], bytes]:
    raw = safe_file(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise VerificationError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"non-object JSON: {path.name}")
    result = cast(dict[str, Any], value)
    if canonical and canonical_bytes(result) != raw:
        raise VerificationError(f"generated JSON is not canonical: {path.name}")
    return result, raw


def nested(mapping: Mapping[str, Any], *keys: str) -> Any:
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            raise VerificationError(f"missing field: {'.'.join(keys)}")
        current = current[key]
    return current


def require_list(value: object, *, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise VerificationError(f"{field} must be a list")
    return value


def require_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise VerificationError(f"{field} must be nonempty text")
    return value


def parse_timestamp(value: object, *, field: str) -> datetime:
    text = require_text(value, field=field)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise VerificationError(f"invalid timestamp: {field}") from error


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


def verify_scope() -> tuple[int, str]:
    root = Path(git("rev-parse", "--show-toplevel")).resolve()
    if (root / "quant" / "research" / "vg13").resolve() != HERE.resolve():
        raise VerificationError("packet is outside authorized V-G13 path")
    if git("rev-parse", "HEAD") != BASE_SHA or git("rev-parse", "HEAD^{tree}") != BASE_TREE:
        raise VerificationError("worktree base differs from frozen V-G13 base")
    changed = {line for line in git("diff", "--name-only", "HEAD").splitlines() if line}
    untracked = {
        line for line in git("ls-files", "--others", "--exclude-standard").splitlines() if line
    }
    names = changed | untracked
    if not names or any(not name.startswith("quant/research/vg13/") for name in names):
        raise VerificationError("working changes are empty or escape V-G13 scope")
    return len(names), sha256_bytes(("\n".join(sorted(names)) + "\n").encode())


def verify_static() -> tuple[dict[str, Any], dict[str, Any], str]:
    protocol, protocol_raw = load_json(HERE / "protocol.v1.json", canonical=False)
    collision, _ = load_json(HERE / "collision-matrix.v1.json", canonical=False)
    official, _ = load_json(HERE / "official-source-freeze.v1.json", canonical=False)
    if (
        protocol.get("schema") != "VG13VolumeVolatilityDecouplingProtocolV1"
        or protocol.get("canonicalBaseCommit") != BASE_SHA
        or protocol.get("canonicalBaseTree") != BASE_TREE
        or protocol.get("limitation") != LIMITATION
        or nested(protocol, "trials", "familySize") != 6
        or nested(protocol, "portfolio", "sleeves") != 7
    ):
        raise VerificationError("protocol invariant mismatch")
    if sha256_path(HERE / "collision-matrix.v1.json") != nested(
        protocol, "sourceFreeze", "collisionMatrixSha256"
    ):
        raise VerificationError("collision-matrix digest mismatch")
    if sha256_path(HERE / "official-source-freeze.v1.json") != nested(
        protocol, "sourceFreeze", "officialSourceFreezeSha256"
    ):
        raise VerificationError("official source freeze digest mismatch")
    if sha256_path(HERE / "OFFICIAL_SOURCE_RESEARCH.md") != nested(
        protocol, "sourceFreeze", "officialSourceResearchSha256"
    ):
        raise VerificationError("official source research digest mismatch")
    siblings = require_list(collision.get("siblings"), field="siblings")
    if (
        len(siblings) != 12
        or [row.get("taskId") for row in siblings] != [f"V-G{index}" for index in range(1, 13)]
        or any(not row.get("protocolSha256") for row in siblings)
    ):
        raise VerificationError("V-G1..12 collision matrix is incomplete")
    signal_fields = nested(protocol, "signal", "signalFieldsOnly")
    if signal_fields != ["OPEN_TIME", "CLOSE", "QUOTE_VOLUME"]:
        raise VerificationError("signal field allowlist changed")
    if nested(protocol, "signal", "executionReferenceFieldOnly") != "OPEN":
        raise VerificationError("execution reference field changed")
    if nested(protocol, "signal", "attributionControl", "insufficientMatches") != (
        "TERMINAL_UNMEASURED_NO_PARTIAL_MATCH_REPLACEMENT_OR_FORMATION_DROP"
    ):
        raise VerificationError("matched-control fail-closed law changed")
    sources = require_list(official.get("sources"), field="official.sources")
    if len(sources) != 5 or any(len(str(row.get("sha256", ""))) != 64 for row in sources):
        raise VerificationError("official source evidence is incomplete")
    return protocol, collision, sha256_bytes(protocol_raw)


def verify_freeze(protocol: Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    freeze, freeze_raw = load_json(HERE / "freeze.v1.json", canonical=True)
    universe, universe_raw = load_json(HERE / "universe.v1.json", canonical=True)
    source, source_raw = load_json(HERE / "source-manifest.v1.json", canonical=True)
    if (
        freeze.get("schema") != "VG13FreezeV1"
        or freeze.get("archiveBodiesOpened") is not False
        or freeze.get("truth") != TRUTH
        or freeze.get("limitation") != LIMITATION
        or freeze.get("trialCount") != 6
    ):
        raise VerificationError("freeze truth/invariant mismatch")
    if (
        universe.get("schema") != "VG13UniverseV1"
        or universe.get("count") != 605
        or universe.get("sha256") != UNIVERSE_SHA
    ):
        raise VerificationError("universe artifact mismatch")
    symbols = require_list(universe.get("symbols"), field="universe.symbols")
    if symbols != sorted(set(symbols)):
        raise VerificationError("universe symbols are not sorted unique")
    logical_sha = sha256_bytes(("\n".join(cast(list[str], symbols)) + "\n").encode())
    if logical_sha != UNIVERSE_SHA:
        raise VerificationError("universe logical digest mismatch")
    if (
        source.get("schema") != "VG13SourceManifestV1"
        or source.get("archiveBodiesOpened") is not False
        or source.get("discoverySha256") != DISCOVERY_SHA
        or source.get("acquisitionManifestSha256") != ACQUISITION_SHA
        or source.get("selectedRowCount") != 605 * 15
    ):
        raise VerificationError("source manifest mismatch")
    if nested(freeze, "sourceBindings", "universeFileSha256") != sha256_bytes(universe_raw):
        raise VerificationError("freeze universe bytes mismatch")
    if nested(freeze, "sourceBindings", "sourceManifestSha256") != sha256_bytes(source_raw):
        raise VerificationError("freeze source bytes mismatch")
    bindings = nested(freeze, "packetBindings")
    if not isinstance(bindings, dict):
        raise VerificationError("freeze packet bindings malformed")
    for path in (
        HERE / "protocol.v1.json",
        HERE / "collision-matrix.v1.json",
        HERE / "OFFICIAL_SOURCE_RESEARCH.md",
        HERE / "official-source-freeze.v1.json",
        HERE / "README.md",
        HERE / "__init__.py",
        HERE / "experiment.py",
        HERE / "verify.py",
        HERE / "test_experiment.py",
        QUANT_ROOT / "pyproject.toml",
        QUANT_ROOT / "uv.lock",
    ):
        if bindings.get(path.name) != sha256_path(path):
            raise VerificationError(f"post-freeze mutation: {path.name}")
    return source, sha256_bytes(freeze_raw)


def verify_source_bytes(source: Mapping[str, Any], source_root: Path) -> int:
    frozen_root = Path(require_text(source.get("sourceRoot"), field="sourceRoot")).resolve()
    if frozen_root != source_root.resolve():
        raise VerificationError("source root differs from frozen manifest")
    verified = 0
    for raw_row in require_list(source.get("rows"), field="source.rows"):
        if not isinstance(raw_row, dict):
            raise VerificationError("source row is not an object")
        row = cast(dict[str, Any], raw_row)
        if row.get("state") == "ABSENT":
            continue
        if row.get("state") != "PRESENT_CHECKSUM_VERIFIED_COMPRESSED_NOT_OPENED":
            raise VerificationError("source row state changed")
        zip_path = source_root / require_text(row.get("zipRelativePath"), field="zipRelativePath")
        checksum_path = source_root / require_text(
            row.get("checksumRelativePath"), field="checksumRelativePath"
        )
        if sha256_path(zip_path) != row.get("zipSha256") or zip_path.stat().st_size != row.get(
            "zipBytes"
        ):
            raise VerificationError("compressed source ZIP changed")
        if sha256_path(checksum_path) != row.get("checksumSha256"):
            raise VerificationError("publisher checksum sidecar changed")
        verified += 1
    return verified


def verify_markers_and_result(
    protocol: Mapping[str, Any],
    freeze_sha: str,
    external_state_root: Path,
) -> tuple[dict[str, Any], str]:
    expected_external = Path(
        require_text(nested(protocol, "runControl", "externalStateRoot"), field="external")
    )
    if external_state_root.resolve() != expected_external.resolve():
        raise VerificationError("external state root differs from protocol")
    development, development_raw = load_json(
        HERE / "development-run-marker.v1.json", canonical=True
    )
    external_development = safe_file(
        external_state_root / "development-run-marker.v1.json"
    ).read_bytes()
    if development_raw != external_development:
        raise VerificationError("local/external development marker bytes differ")
    if (
        development.get("schema") != "VG13DevelopmentRunMarkerV1"
        or development.get("attempt") != 1
        or development.get("freezeSha256") != freeze_sha
        or development.get("state")
        != "CONSUMED_BEFORE_FIRST_ARCHIVE_CENTRAL_DIRECTORY_OR_MEMBER_OPEN"
        or development.get("repairDropDeduplicateFallbackRetryOrRerun") is not False
    ):
        raise VerificationError("development marker invariant mismatch")
    result, result_raw = load_json(HERE / "result.v1.json", canonical=True)
    verdict = result.get("verdict")
    if (
        result.get("schema") != "VG13ResultV1"
        or verdict not in {"GO", "NO_GO", "UNMEASURED"}
        or result.get("terminal") is not True
        or result.get("freezeSha256") != freeze_sha
        or result.get("developmentMarkerSha256") != sha256_bytes(development_raw)
        or result.get("repairOrRerunAllowed") is not False
        or result.get("truth") != TRUTH
        or result.get("limitation") != LIMITATION
    ):
        raise VerificationError("result truth or lifecycle mismatch")
    if verdict == "UNMEASURED":
        phase = result.get("terminalPhase")
        if phase == "DEVELOPMENT":
            if result.get("holdoutOpened") is not False:
                raise VerificationError("invalid development opened holdout")
            if any(
                path.exists()
                for path in (
                    HERE / "candidate-seal.v1.json",
                    HERE / "holdout-open-marker.v1.json",
                    external_state_root / "holdout-open-marker.v1.json",
                )
            ):
                raise VerificationError("development invalidity has holdout artifacts")
        elif phase != "HOLDOUT":
            raise VerificationError("unknown UNMEASURED terminal phase")
    else:
        candidate, candidate_raw = load_json(HERE / "candidate-seal.v1.json", canonical=True)
        holdout, holdout_raw = load_json(HERE / "holdout-open-marker.v1.json", canonical=True)
        external_holdout = safe_file(
            external_state_root / "holdout-open-marker.v1.json"
        ).read_bytes()
        if holdout_raw != external_holdout:
            raise VerificationError("local/external holdout marker bytes differ")
        if (
            candidate.get("schema") != "VG13CandidateSealV1"
            or candidate.get("state") != "SEALED_BEFORE_HOLDOUT_OPEN"
            or holdout.get("schema") != "VG13HoldoutOpenMarkerV1"
            or holdout.get("attempt") != 1
            or holdout.get("candidateSealSha256") != sha256_bytes(candidate_raw)
            or result.get("candidateSealSha256") != sha256_bytes(candidate_raw)
            or result.get("holdoutMarkerSha256") != sha256_bytes(holdout_raw)
            or result.get("holdoutOpened") is not True
            or result.get("holdoutOpenCount") != 1
        ):
            raise VerificationError("candidate/holdout seal mismatch")
        candidate_time = parse_timestamp(candidate.get("createdAtUtc"), field="candidate.created")
        holdout_time = parse_timestamp(holdout.get("createdAtUtc"), field="holdout.created")
        if candidate_time > holdout_time:
            raise VerificationError("candidate seal postdates holdout marker")
        development_results, development_results_raw = load_json(
            HERE / "development-results.v1.json", canonical=True
        )
        if (
            development_results.get("trialCount") != 6
            or len(require_list(development_results.get("trials"), field="trials")) != 6
            or nested(development_results, "pbo", "splitCount") != 70
            or candidate.get("developmentResultsSha256") != sha256_bytes(development_results_raw)
            or result.get("developmentResultsSha256") != sha256_bytes(development_results_raw)
        ):
            raise VerificationError("development family evidence mismatch")
        for record in require_list(development_results.get("trials"), field="trials"):
            if not isinstance(record, dict):
                raise VerificationError("development trial is malformed")
            if "notionalMatchedHighRvControl" not in nested(record, "scenarios", "STRESS"):
                raise VerificationError("development trial lacks matched control")
            if "matchedControlExcessBootstrap" not in nested(record, "scenarios", "STRESS"):
                raise VerificationError("development trial lacks excess bootstrap")
            if "stressMatchedExcessMultiplicity" not in record:
                raise VerificationError("development trial lacks family correction")
        development_gates = nested(result, "developmentGates")
        holdout_gates = nested(result, "holdoutGates")
        if not isinstance(development_gates, dict) or not isinstance(holdout_gates, dict):
            raise VerificationError("result gates malformed")
        combined_pass = all(value is True for value in development_gates.values()) and all(
            value is True for value in holdout_gates.values()
        )
        if (verdict == "GO") != combined_pass:
            raise VerificationError("verdict does not equal frozen gate conjunction")
        if verdict == "GO":
            if float(nested(result, "developmentPbo", "pbo")) > 0.50:
                raise VerificationError("GO exceeds PBO gate")
            if not development_gates.get("stressMatchedControlExcessBootstrapLowerPositive"):
                raise VerificationError("GO lacks development excess LCB")
            if not holdout_gates.get("stressMatchedControlExcessBootstrapLowerPositive"):
                raise VerificationError("GO lacks holdout excess LCB")
    proof, _ = load_json(HERE / "proof.v1.json", canonical=True)
    if (
        proof.get("resultSha256") != sha256_bytes(result_raw)
        or proof.get("externalMarkerConsumedBeforeBodyOpen") is not True
        or proof.get("sharedSourceMode") != "READ_ONLY"
        or proof.get("authority") != "NONE"
        or proof.get("truth") != TRUTH
    ):
        raise VerificationError("focused proof mismatch")
    return result, sha256_bytes(result_raw)


def verify_checksum_inventory() -> tuple[int, str]:
    checksum_path = HERE / "SHA256SUMS"
    lines = safe_file(checksum_path).read_text(encoding="utf-8").splitlines()
    observed: dict[str, str] = {}
    for line in lines:
        if len(line) < 67 or line[64:66] != "  ":
            raise VerificationError("malformed SHA256SUMS row")
        digest, filename = line[:64], line[66:]
        if (
            len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
            or "/" in filename
            or filename in observed
        ):
            raise VerificationError("unsafe SHA256SUMS row")
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
            raise VerificationError(f"packet digest mismatch: {filename}")
    return len(observed), sha256_path(checksum_path)


def verify(source_root: Path, external_state_root: Path) -> dict[str, object]:
    changed_count, scope_sha = verify_scope()
    protocol, collision, protocol_sha = verify_static()
    source, freeze_sha = verify_freeze(protocol)
    source_count = verify_source_bytes(source, source_root)
    result, result_sha = verify_markers_and_result(protocol, freeze_sha, external_state_root)
    checksum_count, checksum_sha = verify_checksum_inventory()
    return {
        "verdict": result["verdict"],
        "scopeFileCount": changed_count,
        "scopeSha256": scope_sha,
        "protocolSha256": protocol_sha,
        "collisionSiblingCount": len(cast(list[Any], collision["siblings"])),
        "freezeSha256": freeze_sha,
        "verifiedCompressedArchiveCount": source_count,
        "resultSha256": result_sha,
        "checksumFileCount": checksum_count,
        "sha256SumsSha256": checksum_sha,
        "authority": "NONE",
        "status": "VG13_PACKET_VERIFIED",
    }


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    argument_parser.add_argument("--source-root", type=Path, required=True)
    argument_parser.add_argument("--external-state-root", type=Path, required=True)
    return argument_parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    try:
        result = verify(arguments.source_root, arguments.external_state_root)
    except VerificationError as error:
        print(f"V-G13 VERIFY REFUSED: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
