"""Terminal V-G36 packet verifier.

Verification authenticates frozen compressed sources and lifecycle/output hashes.
It never opens ZIP members and never recomputes development or holdout outcomes.
"""

from __future__ import annotations

import json
import re
import stat
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

sys.dont_write_bytecode = True

from research.vg36 import experiment as vg36  # noqa: E402

type JsonValue = vg36.JsonValue
type JsonObject = vg36.JsonObject

CHECKSUM_LINE_RE = re.compile(r"^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$")


def _bool(value: JsonValue | None, field: str) -> bool:
    if not isinstance(value, bool):
        raise vg36.MeasurementError(f"{field} must be boolean")
    return value


def _gate_rows(value: JsonValue | None, field: str) -> dict[str, dict[str, bool]]:
    raw_rows = vg36._object(value, field)
    rows: dict[str, dict[str, bool]] = {}
    for trial_id, raw_row in raw_rows.items():
        row_object = vg36._object(raw_row, f"{field}.{trial_id}")
        if not row_object:
            raise vg36.MeasurementError(f"{field}.{trial_id} is empty")
        row: dict[str, bool] = {}
        for gate, raw_gate in row_object.items():
            row[gate] = _bool(raw_gate, f"{field}.{trial_id}.{gate}")
        rows[trial_id] = row
    return rows


def _validate_development_summary(
    development: Mapping[str, JsonValue],
) -> tuple[str | None, frozenset[str]]:
    expected_trials = tuple(trial.trial_id for trial in vg36.trial_grid())
    gate_rows = _gate_rows(development.get("gateResults"), "development.gateResults")
    if tuple(sorted(gate_rows)) != tuple(sorted(expected_trials)):
        raise vg36.MeasurementError("development gate family drift")
    passers = frozenset(trial_id for trial_id, gates in gate_rows.items() if all(gates.values()))
    champion_raw = development.get("championTrialId")
    if champion_raw is not None and not isinstance(champion_raw, str):
        raise vg36.MeasurementError("development champion type drift")
    champion = champion_raw
    if champion is None and passers:
        raise vg36.MeasurementError("development omitted passing champion")
    if champion is not None and champion not in passers:
        raise vg36.MeasurementError("development champion did not pass every gate")
    evaluations = vg36._array(
        development.get("allTrialEvaluations"),
        "development.allTrialEvaluations",
    )
    evaluation_ids: list[str] = []
    for index, raw_evaluation in enumerate(evaluations):
        evaluation = vg36._object(raw_evaluation, f"development.evaluation[{index}]")
        trial = vg36._object(evaluation.get("trial"), f"development.evaluation[{index}].trial")
        evaluation_ids.append(
            vg36._string(
                trial.get("trialId"),
                f"development.evaluation[{index}].trial.trialId",
            )
        )
    if tuple(evaluation_ids) != expected_trials:
        raise vg36.MeasurementError("development evaluation family/order drift")
    return champion, passers


def _verify_holdout_body_open_receipt() -> None:
    receipt = vg36._read_canonical_json(vg36.HOLDOUT_BODY_OPEN_PATH)
    if receipt.get("schema") != "VG36FirstHoldoutArchiveBodyOpenV1":
        raise vg36.MeasurementError("holdout body-open receipt schema drift")
    if receipt.get("archiveMemberBodyOpened") is not True:
        raise vg36.MeasurementError("holdout body-open receipt truth drift")
    if receipt.get("candidateSealSha256") != vg36.sha256_path(vg36.CANDIDATE_SEAL_PATH):
        raise vg36.MeasurementError("holdout body-open candidate binding drift")
    if receipt.get("holdoutMarkerSha256") != vg36.sha256_path(vg36.HOLDOUT_MARKER_PATH):
        raise vg36.MeasurementError("holdout body-open marker binding drift")
    symbol = vg36._string(receipt.get("symbol"), "holdout body-open symbol")
    month = vg36._string(receipt.get("month"), "holdout body-open month")
    if symbol not in vg36.COHORT or month not in vg36.HOLDOUT_SOURCE_MONTHS:
        raise vg36.MeasurementError("holdout body-open partition drift")
    matching = tuple(
        row
        for row in vg36._artifact_rows(vg36._read_canonical_json(vg36.SOURCE_MANIFEST_PATH))
        if row.get("symbol") == symbol and row.get("month") == month
    )
    if len(matching) != 1 or receipt.get("archiveSha256") != matching[0].get("archiveSha256"):
        raise vg36.MeasurementError("holdout body-open source binding drift")


def _regular_packet_files(paths: Sequence[Path]) -> None:
    identities: set[tuple[int, int]] = set()
    for path in paths:
        try:
            metadata = path.lstat()
        except OSError as exc:
            raise vg36.MeasurementError(f"missing packet file: {path}") from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise vg36.MeasurementError(f"packet file is not regular: {path}")
        identity = metadata.st_dev, metadata.st_ino
        if identity in identities:
            raise vg36.MeasurementError("packet file inode collision")
        identities.add(identity)


def _expected_packet_files(result: Mapping[str, JsonValue]) -> tuple[Path, ...]:
    expected = {
        *vg36.SOURCE_FILES,
        vg36.ACQUISITION_PATH,
        vg36.SOURCE_MANIFEST_PATH,
        vg36.FREEZE_PATH,
        vg36.RUN_MARKER_PATH,
        vg36.RESULT_PATH,
        vg36.SHA256SUMS_PATH,
    }
    lifecycle = (
        ("developmentMaterialized", vg36.DEVELOPMENT_PATH),
        ("candidateSealed", vg36.CANDIDATE_SEAL_PATH),
        ("holdoutAuthorized", vg36.HOLDOUT_MARKER_PATH),
        ("holdoutOpened", vg36.HOLDOUT_BODY_OPEN_PATH),
        ("holdoutOutcomeMaterialized", vg36.HOLDOUT_PATH),
    )
    for field, path in lifecycle:
        if _bool(result.get(field), f"result.{field}"):
            expected.add(path)
    return tuple(sorted(expected, key=lambda item: item.name))


def _verify_exact_packet_inventory(result: Mapping[str, JsonValue]) -> tuple[Path, ...]:
    expected = _expected_packet_files(result)
    expected_names = {path.name for path in expected}
    if len(expected_names) != len(expected):
        raise vg36.MeasurementError("packet basenames are not unique")
    try:
        actual = tuple(vg36.PACKET_DIR.iterdir())
    except OSError as exc:
        raise vg36.MeasurementError("cannot enumerate packet directory") from exc
    actual_names = {path.name for path in actual}
    if len(actual_names) != len(actual) or actual_names != expected_names:
        raise vg36.MeasurementError("terminal packet file set drift")
    _regular_packet_files(expected)
    return expected


def _verify_checksums(expected_packet: Sequence[Path]) -> int:
    try:
        lines = vg36.SHA256SUMS_PATH.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise vg36.MeasurementError("invalid SHA256SUMS") from exc
    expected_files = tuple(path for path in expected_packet if path != vg36.SHA256SUMS_PATH)
    if len(lines) != len(expected_files):
        raise vg36.MeasurementError("SHA256SUMS cardinality drift")
    seen: set[str] = set()
    for line, path in zip(lines, expected_files, strict=True):
        matched = CHECKSUM_LINE_RE.fullmatch(line)
        if matched is None:
            raise vg36.MeasurementError("invalid SHA256SUMS line")
        digest, basename = matched.groups()
        if basename != path.name or basename in seen:
            raise vg36.MeasurementError("SHA256SUMS name/order collision")
        seen.add(basename)
        if digest != vg36.sha256_path(path):
            raise vg36.MeasurementError(f"checksum mismatch: {basename}")
    return len(lines)


def _terminal_truth(result: Mapping[str, JsonValue]) -> None:
    expected: JsonObject = {
        "accountEffectiveFees": "UNKNOWN",
        "capitalAuthority": "NONE",
        "causalIdentification": "NOT_CLAIMED",
        "consumer": "N3_SUCCESSOR_ORCHESTRATOR_SCOREBOARD",
        "executableCapacity": "UNMEASURED",
        "globalSharedHoldoutRisk": "PRESENT_VERIFIED_POSITIVE_INELIGIBLE",
        "intradayDrawdown": "UNMEASURED",
    }
    for key, value in expected.items():
        if result.get(key) != value:
            raise vg36.MeasurementError(f"terminal truth drift: {key}")
    verdict = result.get("verdict")
    if verdict not in ("NO_GO", "UNMEASURED"):
        raise vg36.MeasurementError("global verdict can never be GO")


def _verify_development_no_go(
    result: Mapping[str, JsonValue],
    development: Mapping[str, JsonValue],
) -> None:
    if result.get("localVerdict") != "NO_GO" or result.get("verdict") != "NO_GO":
        raise vg36.MeasurementError("development no-go local verdict drift")
    if result.get("disposition") != "VALID_DEVELOPMENT_GATE_FAILURE_HOLDOUT_UNOPENED":
        raise vg36.MeasurementError("development no-go disposition drift")
    champion, passers = _validate_development_summary(development)
    if champion is not None or passers:
        raise vg36.MeasurementError("development no-go has a champion")
    if result.get("developmentSha256") != vg36.sha256_path(vg36.DEVELOPMENT_PATH):
        raise vg36.MeasurementError("development result binding drift")
    forbidden = (
        vg36.CANDIDATE_SEAL_PATH,
        vg36.HOLDOUT_MARKER_PATH,
        vg36.HOLDOUT_BODY_OPEN_PATH,
        vg36.HOLDOUT_PATH,
    )
    if any(path.exists() for path in forbidden):
        raise vg36.MeasurementError("development no-go opened candidate/holdout lifecycle")
    if (
        result.get("developmentMaterialized") is not True
        or result.get("holdoutAuthorized") is not False
        or result.get("holdoutOpened") is not False
        or result.get("holdoutOutcomeMaterialized") is not False
        or result.get("candidateSealed") is not False
    ):
        raise vg36.MeasurementError("development no-go lifecycle truth drift")


def _verify_holdout_chain(
    result: Mapping[str, JsonValue],
    development: Mapping[str, JsonValue],
) -> None:
    seal = vg36._read_canonical_json(vg36.CANDIDATE_SEAL_PATH)
    marker = vg36._read_canonical_json(vg36.HOLDOUT_MARKER_PATH)
    holdout = vg36._read_canonical_json(vg36.HOLDOUT_PATH)
    _verify_holdout_body_open_receipt()
    champion, _ = _validate_development_summary(development)
    if seal.get("schema") != "VG36DevelopmentCandidateSealV1":
        raise vg36.MeasurementError("candidate seal schema drift")
    if seal.get("developmentSha256") != vg36.sha256_path(vg36.DEVELOPMENT_PATH):
        raise vg36.MeasurementError("candidate/development binding drift")
    if seal.get("runMarkerSha256") != vg36.sha256_path(vg36.RUN_MARKER_PATH):
        raise vg36.MeasurementError("candidate/run binding drift")
    if seal.get("freezeSha256") != vg36.sha256_path(vg36.FREEZE_PATH):
        raise vg36.MeasurementError("candidate/freeze binding drift")
    champion_object = vg36._object(seal.get("championTrial"), "championTrial")
    if champion is None or champion_object.get("trialId") != champion:
        raise vg36.MeasurementError("candidate champion binding drift")
    if marker.get("schema") != "VG36ExclusiveHoldoutOpenMarkerV1":
        raise vg36.MeasurementError("holdout marker schema drift")
    if marker.get("candidateSealSha256") != vg36.sha256_path(vg36.CANDIDATE_SEAL_PATH):
        raise vg36.MeasurementError("holdout marker candidate binding drift")
    if marker.get("championTrialId") != champion:
        raise vg36.MeasurementError("holdout marker champion drift")
    if marker.get("freezeSha256") != vg36.sha256_path(vg36.FREEZE_PATH):
        raise vg36.MeasurementError("holdout marker freeze binding drift")
    if holdout.get("schema") != "VG36HoldoutEvaluationV1":
        raise vg36.MeasurementError("holdout schema drift")
    if holdout.get("candidateSealSha256") != vg36.sha256_path(vg36.CANDIDATE_SEAL_PATH):
        raise vg36.MeasurementError("holdout candidate binding drift")
    if holdout.get("holdoutMarkerSha256") != vg36.sha256_path(vg36.HOLDOUT_MARKER_PATH):
        raise vg36.MeasurementError("holdout marker binding drift")
    if holdout.get("holdoutBodyOpenReceiptSha256") != vg36.sha256_path(vg36.HOLDOUT_BODY_OPEN_PATH):
        raise vg36.MeasurementError("holdout body-open receipt binding drift")
    if holdout.get("championTrialId") != champion:
        raise vg36.MeasurementError("holdout champion drift")
    evaluation = vg36._object(holdout.get("evaluation"), "holdout.evaluation")
    trial = vg36._object(evaluation.get("trial"), "holdout.evaluation.trial")
    if trial.get("trialId") != champion:
        raise vg36.MeasurementError("holdout evaluation champion drift")
    if result.get("candidateSealSha256") != vg36.sha256_path(vg36.CANDIDATE_SEAL_PATH):
        raise vg36.MeasurementError("terminal candidate binding drift")
    if result.get("holdoutSha256") != vg36.sha256_path(vg36.HOLDOUT_PATH):
        raise vg36.MeasurementError("terminal holdout binding drift")
    if result.get("holdoutBodyOpenReceiptSha256") != vg36.sha256_path(vg36.HOLDOUT_BODY_OPEN_PATH):
        raise vg36.MeasurementError("terminal body-open receipt binding drift")
    if result.get("holdoutMarkerSha256") != vg36.sha256_path(vg36.HOLDOUT_MARKER_PATH):
        raise vg36.MeasurementError("terminal holdout-marker binding drift")
    if (
        result.get("developmentMaterialized") is not True
        or result.get("holdoutAuthorized") is not True
        or result.get("holdoutOpened") is not True
        or result.get("holdoutOutcomeMaterialized") is not True
        or result.get("candidateSealed") is not True
    ):
        raise vg36.MeasurementError("terminal holdout lifecycle truth drift")
    gate_rows = _gate_rows(
        {"holdout": holdout.get("gateResults")},
        "holdout-gate-wrapper",
    )
    local_pass = all(gate_rows["holdout"].values())
    if holdout.get("allHoldoutGatesPass") is not local_pass:
        raise vg36.MeasurementError("holdout gate conjunction drift")
    expected_local = "LOCAL_PUBLIC_GO" if local_pass else "NO_GO"
    expected_disposition = (
        "LOCAL_PUBLIC_GO_BUT_GLOBAL_SHARED_HOLDOUT_INELIGIBLE"
        if local_pass
        else "VALID_HOLDOUT_GATE_FAILURE"
    )
    if result.get("disposition") != expected_disposition:
        raise vg36.MeasurementError("terminal holdout disposition drift")
    if result.get("localVerdict") != expected_local or result.get("verdict") != "NO_GO":
        raise vg36.MeasurementError("shared-holdout global veto drift")


def _verify_lifecycle(result: Mapping[str, JsonValue]) -> None:
    if result.get("schema") != "VG36TerminalResultV1":
        raise vg36.MeasurementError("terminal result schema drift")
    marker = vg36._read_canonical_json(vg36.RUN_MARKER_PATH)
    if marker.get("schema") != "VG36ExclusiveRunMarkerV1":
        raise vg36.MeasurementError("run marker schema drift")
    if marker.get("freezeSha256") != vg36.sha256_path(vg36.FREEZE_PATH):
        raise vg36.MeasurementError("run/freeze binding drift")
    if marker.get("protocolSha256") != vg36.sha256_path(vg36.PROTOCOL_PATH):
        raise vg36.MeasurementError("run/protocol binding drift")
    if marker.get("sourceManifestSha256") != vg36.sha256_path(vg36.SOURCE_MANIFEST_PATH):
        raise vg36.MeasurementError("run/source binding drift")
    if marker.get("holdoutAuthorized") is not False or marker.get("holdoutOpened") is not False:
        raise vg36.MeasurementError("run marker initial holdout truth drift")
    if result.get("runMarkerSha256") != vg36.sha256_path(vg36.RUN_MARKER_PATH):
        raise vg36.MeasurementError("result/run binding drift")
    local = result.get("localVerdict")
    if local == "UNMEASURED":
        _verify_unmeasured_chain(result)
        return
    development = vg36._read_canonical_json(vg36.DEVELOPMENT_PATH)
    if development.get("schema") != "VG36DevelopmentEvaluationV1":
        raise vg36.MeasurementError("development schema drift")
    if development.get("runMarkerSha256") != vg36.sha256_path(vg36.RUN_MARKER_PATH):
        raise vg36.MeasurementError("development/run binding drift")
    if development.get("freezeSha256") != vg36.sha256_path(vg36.FREEZE_PATH):
        raise vg36.MeasurementError("development/freeze binding drift")
    if local == "NO_GO" and not vg36.CANDIDATE_SEAL_PATH.exists():
        _verify_development_no_go(result, development)
        return
    _verify_holdout_chain(result, development)


def _verify_unmeasured_chain(result: Mapping[str, JsonValue]) -> None:
    if result.get("verdict") != "UNMEASURED":
        raise vg36.MeasurementError("unmeasured global verdict drift")
    if result.get("disposition") != "TERMINAL_DEFECT_NO_REPAIR_NO_RERUN":
        raise vg36.MeasurementError("unmeasured disposition drift")
    reason = result.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise vg36.MeasurementError("unmeasured reason missing")
    development_exists = vg36.DEVELOPMENT_PATH.exists()
    candidate_exists = vg36.CANDIDATE_SEAL_PATH.exists()
    holdout_marker_exists = vg36.HOLDOUT_MARKER_PATH.exists()
    holdout_open_exists = vg36.HOLDOUT_BODY_OPEN_PATH.exists()
    holdout_exists = vg36.HOLDOUT_PATH.exists()
    lifecycle = (
        ("developmentMaterialized", development_exists),
        ("candidateSealed", candidate_exists),
        ("holdoutAuthorized", holdout_marker_exists),
        ("holdoutOpened", holdout_open_exists),
        ("holdoutOutcomeMaterialized", holdout_exists),
    )
    for field, exists in lifecycle:
        if result.get(field) is not exists:
            raise vg36.MeasurementError(f"unmeasured {field} truth drift")
    hashes = (
        ("developmentSha256", vg36.DEVELOPMENT_PATH, development_exists),
        ("candidateSealSha256", vg36.CANDIDATE_SEAL_PATH, candidate_exists),
        ("holdoutMarkerSha256", vg36.HOLDOUT_MARKER_PATH, holdout_marker_exists),
        (
            "holdoutBodyOpenReceiptSha256",
            vg36.HOLDOUT_BODY_OPEN_PATH,
            holdout_open_exists,
        ),
        ("holdoutSha256", vg36.HOLDOUT_PATH, holdout_exists),
    )
    for field, path, exists in hashes:
        expected = vg36.sha256_path(path) if exists else None
        if result.get(field) != expected:
            raise vg36.MeasurementError(f"unmeasured {field} binding drift")
    if candidate_exists and not development_exists:
        raise vg36.MeasurementError("unmeasured candidate lacks development")
    if holdout_marker_exists and not candidate_exists:
        raise vg36.MeasurementError("unmeasured holdout marker lacks candidate")
    if holdout_open_exists and not holdout_marker_exists:
        raise vg36.MeasurementError("unmeasured body-open receipt lacks authorization")
    if holdout_exists and not holdout_open_exists:
        raise vg36.MeasurementError("unmeasured holdout outcome lacks body-open receipt")
    development: JsonObject | None = None
    champion: str | None = None
    if development_exists:
        development = vg36._read_canonical_json(vg36.DEVELOPMENT_PATH)
        if development.get("schema") != "VG36DevelopmentEvaluationV1":
            raise vg36.MeasurementError("unmeasured development schema drift")
        if development.get("runMarkerSha256") != vg36.sha256_path(vg36.RUN_MARKER_PATH):
            raise vg36.MeasurementError("unmeasured development/run binding drift")
        if development.get("freezeSha256") != vg36.sha256_path(vg36.FREEZE_PATH):
            raise vg36.MeasurementError("unmeasured development/freeze binding drift")
        champion, _ = _validate_development_summary(development)
    if not candidate_exists:
        return
    if development is None or champion is None:
        raise vg36.MeasurementError("unmeasured candidate lacks passing development")
    seal = vg36._read_canonical_json(vg36.CANDIDATE_SEAL_PATH)
    if development.get("schema") != "VG36DevelopmentEvaluationV1":
        raise vg36.MeasurementError("unmeasured development schema drift")
    if seal.get("schema") != "VG36DevelopmentCandidateSealV1":
        raise vg36.MeasurementError("unmeasured candidate schema drift")
    if seal.get("developmentSha256") != vg36.sha256_path(vg36.DEVELOPMENT_PATH):
        raise vg36.MeasurementError("unmeasured candidate/development binding drift")
    if seal.get("runMarkerSha256") != vg36.sha256_path(vg36.RUN_MARKER_PATH):
        raise vg36.MeasurementError("unmeasured candidate/run binding drift")
    champion_object = vg36._object(seal.get("championTrial"), "championTrial")
    if champion_object.get("trialId") != champion:
        raise vg36.MeasurementError("unmeasured candidate champion drift")
    if not holdout_marker_exists:
        return
    marker = vg36._read_canonical_json(vg36.HOLDOUT_MARKER_PATH)
    if marker.get("schema") != "VG36ExclusiveHoldoutOpenMarkerV1":
        raise vg36.MeasurementError("unmeasured holdout marker schema drift")
    if marker.get("candidateSealSha256") != vg36.sha256_path(vg36.CANDIDATE_SEAL_PATH):
        raise vg36.MeasurementError("unmeasured holdout/candidate binding drift")
    if marker.get("championTrialId") != champion:
        raise vg36.MeasurementError("unmeasured holdout champion drift")
    if holdout_open_exists:
        _verify_holdout_body_open_receipt()
    if holdout_exists:
        holdout = vg36._read_canonical_json(vg36.HOLDOUT_PATH)
        if holdout.get("schema") != "VG36HoldoutEvaluationV1":
            raise vg36.MeasurementError("unmeasured holdout schema drift")
        if holdout.get("candidateSealSha256") != vg36.sha256_path(vg36.CANDIDATE_SEAL_PATH):
            raise vg36.MeasurementError("unmeasured holdout candidate binding drift")
        if holdout.get("holdoutMarkerSha256") != vg36.sha256_path(vg36.HOLDOUT_MARKER_PATH):
            raise vg36.MeasurementError("unmeasured holdout marker binding drift")
        if holdout.get("holdoutBodyOpenReceiptSha256") != vg36.sha256_path(
            vg36.HOLDOUT_BODY_OPEN_PATH
        ):
            raise vg36.MeasurementError("unmeasured holdout body-open binding drift")


def _verify_git_identity(
    acquisition: Mapping[str, JsonValue],
    freeze: Mapping[str, JsonValue],
    expected_packet: Sequence[Path],
) -> str:
    marker = vg36._read_canonical_json(vg36.RUN_MARKER_PATH)
    acquisition_head = vg36._string(acquisition.get("gitHead"), "acquisition.gitHead")
    marker_head = vg36._string(marker.get("gitHead"), "runMarker.gitHead")
    if freeze.get("gitHeadBeforeFreezeOutputs") != acquisition_head:
        raise vg36.MeasurementError("freeze/acquisition Git identity drift")
    vg36._require_direct_child(marker_head, acquisition_head, "run-marker freeze commit")
    final_head = vg36._require_tracked_clean(expected_packet)
    vg36._require_direct_child(final_head, marker_head, "terminal packet commit")
    vg36._require_exclusive_scope(vg36.BASE_COMMIT, final_head)
    return final_head


def verify_packet() -> JsonObject:
    vg36.load_protocol()
    freeze = vg36._read_canonical_json(vg36.FREEZE_PATH)
    manifest = vg36._read_canonical_json(vg36.SOURCE_MANIFEST_PATH)
    acquisition = vg36._read_canonical_json(vg36.ACQUISITION_PATH)
    result = vg36._read_canonical_json(vg36.RESULT_PATH)
    if freeze.get("schema") != "VG36PreOutcomeFreezeV1":
        raise vg36.MeasurementError("freeze schema drift")
    if freeze.get("archiveBodiesOpened") is not False:
        raise vg36.MeasurementError("freeze archive-open truth drift")
    _validate_acquisition_head = vg36._validate_acquisition(acquisition)
    if freeze.get("gitHeadBeforeFreezeOutputs") != _validate_acquisition_head:
        raise vg36.MeasurementError("freeze acquisition-head binding drift")
    vg36._validate_source_manifest(manifest, acquisition)
    if freeze.get("acquisitionSha256") != vg36.sha256_path(vg36.ACQUISITION_PATH):
        raise vg36.MeasurementError("freeze/acquisition binding drift")
    if freeze.get("sourceManifestSha256") != vg36.sha256_path(vg36.SOURCE_MANIFEST_PATH):
        raise vg36.MeasurementError("freeze/source binding drift")
    if freeze.get("protocolSha256") != vg36.sha256_path(vg36.PROTOCOL_PATH):
        raise vg36.MeasurementError("freeze/protocol binding drift")
    expected_hashes: JsonObject = {
        str(path.relative_to(vg36.PACKET_DIR)): vg36.sha256_path(path) for path in vg36.SOURCE_FILES
    }
    if freeze.get("sourceFileSha256") != expected_hashes:
        raise vg36.MeasurementError("freeze source-file binding drift")
    _terminal_truth(result)
    _verify_lifecycle(result)
    expected_packet = _verify_exact_packet_inventory(result)
    checksum_count = _verify_checksums(expected_packet)
    final_head = _verify_git_identity(acquisition, freeze, expected_packet)
    return {
        "archiveBodiesOpened": False,
        "checksumCount": checksum_count,
        "gitHead": final_head,
        "localVerdict": result.get("localVerdict"),
        "schema": "VG36TerminalVerificationV1",
        "sourceArtifactCount": len(vg36._artifact_rows(manifest)),
        "verdict": result.get("verdict"),
    }


def main(_arguments: Sequence[str] | None = None) -> int:
    try:
        result = verify_packet()
    except vg36.VG36Error as exc:
        print(f"VG36_VERIFY_ERROR {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
