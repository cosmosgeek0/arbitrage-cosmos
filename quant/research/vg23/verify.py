#!/usr/bin/env python3.13
"""Independent network-free verifier for the sealed V-G23 packet."""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any, Final

PACKET_DIR: Final = Path(__file__).resolve().parent
STATE_ROOT: Final = Path("/private/tmp/cosmos-vg23-abnormal-volume-breadth-1be1-a780")
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
TERMINAL_CORE_FILENAME: Final = "terminal-result-core.v1.json"
PACKET_FILES: Final = frozenset(
    {
        "HANDOFF.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "VERIFICATION.md",
        "experiment.py",
        "freeze.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "run-receipt.v1.json",
        "test_experiment.py",
        "verify.py",
    }
)
HEX64: Final = re.compile(r"[0-9a-f]{64}")
SAFE_NAME: Final = re.compile(r"[A-Za-z0-9_.-]+")
HEX40: Final = re.compile(r"[0-9a-f]{40}")
STATIC_FREEZE_PATHS: Final = (
    "quant/research/vg23/OFFICIAL_SOURCE_RESEARCH.md",
    "quant/research/vg23/README.md",
    "quant/research/vg23/experiment.py",
    "quant/research/vg23/protocol.v1.json",
    "quant/research/vg23/test_experiment.py",
    "quant/research/vg23/verify.py",
)
TERMINAL_PATHS: Final = (
    "quant/research/vg23/HANDOFF.md",
    "quant/research/vg23/SHA256SUMS",
    "quant/research/vg23/VERIFICATION.md",
    "quant/research/vg23/result.v1.json",
    "quant/research/vg23/run-receipt.v1.json",
)


class VerificationError(RuntimeError):
    """A final packet invariant failed."""


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_bytes(name: str) -> bytes:
    path = PACKET_DIR / name
    if path.is_symlink() or not path.is_file():
        raise VerificationError(f"required regular packet file unavailable: {name}")
    return path.read_bytes()


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def clone_json_object(payload: dict[str, Any]) -> dict[str, Any]:
    cloned = json.loads(canonical_bytes(payload))
    if not isinstance(cloned, dict):
        raise VerificationError("canonical JSON clone is not an object")
    return cloned


def result_core_from_terminal_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if (
        payload.get("schema") != "VG23TerminalResultCoreV1"
        or payload.get("state") != "IMMUTABLE_PRE_RECEIPT_TERMINAL_RESULT_CORE"
    ):
        raise VerificationError("terminal result-core marker schema/state mismatch")
    core = require_dict(payload.get("resultCore"), "terminalResultCore.resultCore")
    if payload.get("resultCoreSha256") != digest(canonical_bytes(core)):
        raise VerificationError("terminal result-core payload digest mismatch")
    return clone_json_object(core)


def reconstruct_final_result(
    core: dict[str, Any],
    *,
    terminal_core_sha: str,
    run_receipt_sha: str,
) -> dict[str, Any]:
    result = clone_json_object(core)
    bindings = require_dict(result.get("bindings"), "result.bindings")
    if "terminalResultCoreSha256" in bindings or "runReceiptSha256" in bindings:
        raise VerificationError("result core contains circular terminal bindings")
    bindings["terminalResultCoreSha256"] = terminal_core_sha
    bindings["runReceiptSha256"] = run_receipt_sha
    return result


def git_text(*arguments: str) -> str:
    try:
        completed = subprocess.run(
            ("git", *arguments),
            cwd=PACKET_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise VerificationError(f"Git evidence unavailable: {' '.join(arguments)}") from error
    return completed.stdout.strip()


def git_bytes(*arguments: str) -> bytes:
    try:
        completed = subprocess.run(
            ("git", *arguments),
            cwd=PACKET_DIR,
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise VerificationError(f"Git byte evidence unavailable: {' '.join(arguments)}") from error
    return completed.stdout


def json_file(name: str) -> tuple[dict[str, Any], bytes]:
    raw = file_bytes(name)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise VerificationError(f"invalid JSON: {name}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"JSON root is not an object: {name}")
    if raw != canonical_bytes(value):
        raise VerificationError(f"JSON is not canonical: {name}")
    require_finite(value, name)
    return value, raw


def require_finite(value: object, field: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise VerificationError(f"non-finite JSON number: {field}")
    if isinstance(value, dict):
        for key, child in value.items():
            require_finite(child, f"{field}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            require_finite(child, f"{field}[{index}]")


def require_dict(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise VerificationError(f"{field} must be an object")
    return value


def parse_checksums() -> dict[str, str]:
    raw = file_bytes("SHA256SUMS")
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError as error:
        raise VerificationError("SHA256SUMS is not ASCII") from error
    expected: dict[str, str] = {}
    for line in lines:
        parts = line.split("  ", 1)
        if len(parts) != 2 or HEX64.fullmatch(parts[0]) is None:
            raise VerificationError("SHA256SUMS row malformed")
        name = parts[1]
        if (
            SAFE_NAME.fullmatch(name) is None
            or name.startswith(".")
            or "/" in name
            or "\\" in name
            or name in expected
        ):
            raise VerificationError("SHA256SUMS filename malformed or duplicate")
        expected[name] = parts[0]
    if set(expected) != PACKET_FILES:
        raise VerificationError("SHA256SUMS exact file set mismatch")
    root_files = {path.name for path in PACKET_DIR.iterdir() if path.is_file() or path.is_symlink()}
    if root_files != PACKET_FILES | {"SHA256SUMS"}:
        raise VerificationError("packet root contains an unexpected or missing file")
    for name, expected_digest in expected.items():
        if digest(file_bytes(name)) != expected_digest:
            raise VerificationError(f"packet byte drift: {name}")
    return expected


def verify_static_bindings(
    protocol: dict[str, Any],
    protocol_raw: bytes,
    freeze: dict[str, Any],
    freeze_raw: bytes,
    result: dict[str, Any],
) -> dict[str, Any]:
    if protocol.get("schema") != "VG23AbnormalVolumeBreadthProtocolV1":
        raise VerificationError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != BASE_COMMIT:
        raise VerificationError("protocol base mismatch")
    if freeze.get("schema") != "VG23FreezeV1":
        raise VerificationError("freeze schema mismatch")
    if freeze.get("canonicalBaseCommit") != BASE_COMMIT:
        raise VerificationError("freeze base mismatch")
    if freeze.get("state") != "FROZEN_BEFORE_ANY_VG23_ECONOMIC_OUTCOME_ACCESS":
        raise VerificationError("freeze pre-outcome state mismatch")
    if freeze.get("archiveBodiesOpenedByVG23Evaluator") is not False:
        raise VerificationError("freeze claims evaluator archive access")
    if freeze.get("economicOutcomeFieldsAccessedByVG23BeforeFreeze") is not False:
        raise VerificationError("freeze claims prefreeze outcome access")
    if freeze.get("developmentSchemaOnlyPrefreezeAuditObserved") is not True:
        raise VerificationError("prefreeze schema-audit disclosure missing")
    if freeze.get("holdoutArchiveBodiesOpenedByVG23") is not False:
        raise VerificationError("freeze claims holdout access")
    expected_freeze = {
        "protocolSha256": digest(protocol_raw),
        "evaluatorSha256": digest(file_bytes("experiment.py")),
        "verifierSha256": digest(file_bytes("verify.py")),
        "officialSourceResearchSha256": digest(file_bytes("OFFICIAL_SOURCE_RESEARCH.md")),
    }
    for key, expected in expected_freeze.items():
        if freeze.get(key) != expected:
            raise VerificationError(f"freeze static binding mismatch: {key}")
    bindings = require_dict(result.get("bindings"), "result.bindings")
    expected_result = {
        **expected_freeze,
        "freezeSha256": digest(freeze_raw),
        "sharedDiscoverySha256": freeze.get("sharedDiscoverySha256"),
        "sharedAcquisitionSha256": freeze.get("sharedAcquisitionSha256"),
        "targetArtifactInventorySha256": freeze.get("targetArtifactInventorySha256"),
    }
    for key, bound_value in expected_result.items():
        if not isinstance(bound_value, str) or bindings.get(key) != bound_value:
            raise VerificationError(f"result static binding mismatch: {key}")
    return bindings


def verify_git_lineage(
    freeze: dict[str, Any],
    freeze_raw: bytes,
    result_bindings: dict[str, Any],
) -> dict[str, Any]:
    if git_text("status", "--porcelain"):
        raise VerificationError("terminal worktree is not clean")
    code_commit = freeze.get("codeFreezeCommit")
    code_parent = freeze.get("codeFreezeParent")
    code_tree = freeze.get("codeFreezeTree")
    code_paths = freeze.get("codeFreezePaths")
    if (
        not isinstance(code_commit, str)
        or HEX40.fullmatch(code_commit) is None
        or code_parent != BASE_COMMIT
        or not isinstance(code_tree, str)
        or HEX40.fullmatch(code_tree) is None
        or code_paths != list(STATIC_FREEZE_PATHS)
    ):
        raise VerificationError("code-freeze lineage fields are malformed")
    if git_text("rev-parse", f"{code_commit}^") != BASE_COMMIT:
        raise VerificationError("code freeze is not a direct canonical successor")
    if git_text("rev-parse", f"{code_commit}^{{tree}}") != code_tree:
        raise VerificationError("code-freeze tree binding mismatch")
    actual_code_paths = tuple(
        row
        for row in git_text("diff", "--name-only", f"{BASE_COMMIT}..{code_commit}").splitlines()
        if row
    )
    if actual_code_paths != STATIC_FREEZE_PATHS:
        raise VerificationError("code-freeze Git path set mismatch")
    path_digest = digest(("\n".join(actual_code_paths) + "\n").encode())
    if freeze.get("codeFreezePathsSha256") != path_digest:
        raise VerificationError("code-freeze path digest mismatch")
    for path in STATIC_FREEZE_PATHS:
        if (
            git_bytes("show", f"{code_commit}:{path}")
            != (PACKET_DIR / Path(path).name).read_bytes()
        ):
            raise VerificationError(f"static packet bytes differ from code freeze: {path}")

    source_commit = result_bindings.get("sourceFreezeCommit")
    source_tree = result_bindings.get("sourceFreezeTree")
    if (
        not isinstance(source_commit, str)
        or HEX40.fullmatch(source_commit) is None
        or not isinstance(source_tree, str)
        or HEX40.fullmatch(source_tree) is None
    ):
        raise VerificationError("source-freeze result binding is malformed")
    if git_text("rev-parse", f"{source_commit}^") != code_commit:
        raise VerificationError("source freeze is not a direct code-freeze successor")
    if git_text("rev-parse", f"{source_commit}^{{tree}}") != source_tree:
        raise VerificationError("source-freeze tree binding mismatch")
    source_paths = tuple(
        row
        for row in git_text("diff", "--name-only", f"{code_commit}..{source_commit}").splitlines()
        if row
    )
    if source_paths != ("quant/research/vg23/freeze.v1.json",):
        raise VerificationError("source-freeze Git path set mismatch")
    if git_bytes("show", f"{source_commit}:quant/research/vg23/freeze.v1.json") != freeze_raw:
        raise VerificationError("freeze bytes differ from source-freeze commit")

    terminal_commit = git_text("rev-parse", "HEAD")
    if git_text("rev-parse", "HEAD^") != source_commit:
        raise VerificationError("terminal packet is not a direct source-freeze successor")
    terminal_paths = tuple(
        row
        for row in git_text(
            "diff", "--name-only", f"{source_commit}..{terminal_commit}"
        ).splitlines()
        if row
    )
    if terminal_paths != TERMINAL_PATHS:
        raise VerificationError("terminal Git path set mismatch")
    return {
        "codeFreezeCommit": code_commit,
        "sourceFreezeCommit": source_commit,
        "terminalCommit": terminal_commit,
        "terminalPaths": list(terminal_paths),
    }


def verify_markers(
    protocol: dict[str, Any],
    result: dict[str, Any],
    result_bindings: dict[str, Any],
) -> dict[str, Any]:
    receipt, receipt_raw = json_file("run-receipt.v1.json")
    if receipt.get("schema") != "VG23RunReceiptV1":
        raise VerificationError("receipt schema mismatch")
    if receipt.get("state") != "IMMUTABLE_PACKET_COPY_OF_ONE_USE_EXTERNAL_MARKERS":
        raise VerificationError("receipt state mismatch")
    if result_bindings.get("runReceiptSha256") != digest(receipt_raw):
        raise VerificationError("result receipt binding mismatch")
    run_control = require_dict(protocol.get("runControl"), "protocol.runControl")
    if run_control.get("stateRoot") != str(STATE_ROOT):
        raise VerificationError("protocol state root mismatch")
    if receipt.get("stateRoot") != str(STATE_ROOT):
        raise VerificationError("receipt state root mismatch")
    if STATE_ROOT.is_symlink() or not STATE_ROOT.is_dir():
        raise VerificationError("external state root unavailable")
    markers = require_dict(receipt.get("markers"), "receipt.markers")
    contract = (
        ("runMarker", "run-marker.v1.json", "runMarkerSha256"),
        ("candidateSeal", "candidate-seal.v1.json", "candidateSealSha256"),
        ("holdoutOpen", "holdout-open.v1.json", "holdoutOpenSha256"),
        (
            "terminalResultCore",
            TERMINAL_CORE_FILENAME,
            "terminalResultCoreSha256",
        ),
    )
    verified: list[str] = []
    for receipt_key, filename, binding_key in contract:
        record = markers.get(receipt_key)
        if record is None:
            if receipt_key == "runMarker":
                raise VerificationError("required run marker missing")
            if binding_key in result_bindings:
                raise VerificationError(f"result claims absent marker: {receipt_key}")
            continue
        row = require_dict(record, f"receipt.{receipt_key}")
        payload = require_dict(row.get("payload"), f"receipt.{receipt_key}.payload")
        embedded = canonical_bytes(payload)
        marker_digest = row.get("sha256")
        if row.get("filename") != filename or marker_digest != digest(embedded):
            raise VerificationError(f"embedded marker invalid: {receipt_key}")
        external_path = STATE_ROOT / filename
        if external_path.is_symlink() or not external_path.is_file():
            raise VerificationError(f"external marker unavailable: {receipt_key}")
        external = external_path.read_bytes()
        if external != embedded or digest(external) != marker_digest:
            raise VerificationError(f"external marker drift: {receipt_key}")
        if result_bindings.get(binding_key) != marker_digest:
            raise VerificationError(f"result marker binding mismatch: {receipt_key}")
        verified.append(receipt_key)
    verdict = result.get("measurementVerdict")
    run_record = require_dict(markers.get("runMarker"), "receipt.runMarker")
    run_payload = require_dict(run_record.get("payload"), "receipt.runMarker.payload")
    if (
        run_payload.get("schema") != "VG23RunMarkerV1"
        or run_payload.get("state") != "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED"
        or run_payload.get("allowedRunCount") != 1
        or run_payload.get("consumedRunCount") != 1
        or run_payload.get("networkPermitted") is not False
        or run_payload.get("sharedSourceMutationPermitted") is not False
    ):
        raise VerificationError("run marker semantics mismatch")
    for binding_name in (
        "protocolSha256",
        "freezeSha256",
        "evaluatorSha256",
        "verifierSha256",
        "officialSourceResearchSha256",
        "sharedDiscoverySha256",
        "sharedAcquisitionSha256",
        "targetArtifactInventorySha256",
        "sourceFreezeCommit",
        "sourceFreezeTree",
    ):
        if run_payload.get(binding_name) != result_bindings.get(binding_name):
            raise VerificationError(f"run marker binding mismatch: {binding_name}")
    terminal_record = require_dict(markers.get("terminalResultCore"), "receipt.terminalResultCore")
    terminal_payload = require_dict(
        terminal_record.get("payload"), "receipt.terminalResultCore.payload"
    )
    terminal_core = result_core_from_terminal_payload(terminal_payload)
    if receipt.get("terminalPhase") != terminal_payload.get("terminalPhase"):
        raise VerificationError("receipt/terminal-core phase mismatch")
    expected_result = reconstruct_final_result(
        terminal_core,
        terminal_core_sha=str(terminal_record.get("sha256")),
        run_receipt_sha=digest(receipt_raw),
    )
    if expected_result != result:
        raise VerificationError("result differs from immutable terminal result core")
    if verdict in {"GO", "NO_GO"} and verified != [
        "runMarker",
        "candidateSeal",
        "holdoutOpen",
        "terminalResultCore",
    ]:
        raise VerificationError("measured verdict lacks complete one-shot marker chain")
    if markers.get("candidateSeal") is not None:
        candidate_record = require_dict(markers["candidateSeal"], "receipt.candidateSeal")
        candidate = require_dict(candidate_record.get("payload"), "receipt.candidateSeal.payload")
        if (
            candidate.get("schema") != "VG23CandidateSealV1"
            or candidate.get("state") != "ONE_DEVELOPMENT_CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN"
        ):
            raise VerificationError("candidate marker semantics mismatch")
        development = result.get("development")
        if isinstance(development, dict) and (
            candidate.get("developmentEvidenceSha256") != digest(canonical_bytes(development))
            or candidate.get("championTrialId") != development.get("championTrialId")
        ):
            raise VerificationError("candidate marker does not bind development")
    if "holdoutOpen" in verified:
        holdout = require_dict(
            require_dict(markers["holdoutOpen"], "receipt.holdoutOpen").get("payload"),
            "receipt.holdoutOpen.payload",
        )
        candidate_record = require_dict(markers.get("candidateSeal"), "candidateSeal")
        candidate = require_dict(candidate_record.get("payload"), "candidateSeal.payload")
        if (
            holdout.get("schema") != "VG23HoldoutOpenMarkerV1"
            or holdout.get("state") != "SOLE_CHAMPION_ONLY_HOLDOUT_OPEN_CONSUMED"
            or holdout.get("consumedOpenCount") != 1
            or holdout.get("allowedOpenCount") != 1
            or holdout.get("postOpenRepairAllowed") is not False
            or holdout.get("runnerUpOpenAllowed") is not False
            or holdout.get("candidateSealSha256") != candidate_record.get("sha256")
            or holdout.get("championTrialId") != candidate.get("championTrialId")
        ):
            raise VerificationError("holdout marker semantics mismatch")
    return {"verifiedMarkers": verified, "runReceiptSha256": digest(receipt_raw)}


def expected_gate_decisions(
    protocol: dict[str, Any],
    result: dict[str, Any],
) -> list[dict[str, Any]]:
    development = require_dict(result.get("development"), "result.development")
    holdout = require_dict(result.get("holdout"), "result.holdout")
    champion_id = development.get("championTrialId")
    if not isinstance(champion_id, str):
        raise VerificationError("development champion ID is malformed")
    trials = require_dict(development.get("trials"), "development.trials")
    dev_trial = require_dict(trials.get(champion_id), "development.champion")
    dev = require_dict(dev_trial.get("strategy"), "development.champion.strategy")
    white_cash = require_dict(
        development.get("whiteRealityCheckVersusCash"), "development.whiteCash"
    )
    white_benchmark = require_dict(
        development.get("whiteRealityCheckVersusMatchedBenchmark"),
        "development.whiteBenchmark",
    )
    base = require_dict(
        require_dict(holdout.get("PUBLIC_BASE"), "holdout.PUBLIC_BASE").get("strategy"),
        "holdout.PUBLIC_BASE.strategy",
    )
    stress_packet = require_dict(holdout.get("PUBLIC_STRESS"), "holdout.PUBLIC_STRESS")
    stress = require_dict(stress_packet.get("strategy"), "holdout.PUBLIC_STRESS.strategy")
    fee_stress = require_dict(
        require_dict(holdout.get("FEE_STRESS"), "holdout.FEE_STRESS").get("strategy"),
        "holdout.FEE_STRESS.strategy",
    )
    excess = require_dict(
        stress_packet.get("matchedBenchmarkExcess"),
        "holdout.PUBLIC_STRESS.matchedBenchmarkExcess",
    )
    capacity = require_dict(stress.get("capacityProxy"), "stress.capacityProxy")
    gates = require_dict(protocol.get("gates"), "protocol.gates")
    dev_gates = require_dict(gates.get("development"), "protocol.gates.development")
    hold_gates = require_dict(gates.get("holdout"), "protocol.gates.holdout")
    capacity_spec = require_dict(protocol.get("capacity"), "protocol.capacity")
    expected: list[dict[str, Any]] = []

    def add(gate: str, actual: object, rule: str, passed: bool) -> None:
        expected.append({"gate": gate, "actual": actual, "rule": rule, "passed": passed})

    add(
        "DEV_VALID_FORMATIONS",
        dev.get("validFormations"),
        f">={dev_gates['minimumValidFormations']}",
        int(dev["validFormations"]) >= int(dev_gates["minimumValidFormations"]),
    )
    add(
        "DEV_HOLDING_SPELLS",
        dev.get("holdingSpells"),
        f">={dev_gates['minimumHoldingSpells']}",
        int(dev["holdingSpells"]) >= int(dev_gates["minimumHoldingSpells"]),
    )
    add(
        "DEV_FILLS",
        dev.get("fills"),
        f">={dev_gates['minimumFills']}",
        int(dev["fills"]) >= int(dev_gates["minimumFills"]),
    )
    add(
        "DEV_DISTINCT_SYMBOLS",
        dev.get("distinctHeldSymbols"),
        f">={dev_gates['minimumDistinctSymbols']}",
        int(dev["distinctHeldSymbols"]) >= int(dev_gates["minimumDistinctSymbols"]),
    )
    add(
        "DEV_POSITIVE_STRESS_MONTHS",
        dev.get("positiveMonths"),
        f">={dev_gates['minimumPositiveStressMonths']}/{dev_gates['requiredPositiveStressMonthsOf']}",
        int(dev["positiveMonths"]) >= int(dev_gates["minimumPositiveStressMonths"]),
    )
    holm_limit = float(dev_gates["holmAdjustedPExclusiveMaximum"])
    add(
        "DEV_HOLM_P",
        dev_trial.get("holmAdjustedP"),
        f"<{holm_limit}",
        float(dev_trial["holmAdjustedP"]) < holm_limit,
    )
    white_limit = float(dev_gates["whiteRealityCheckPExclusiveMaximum"])
    add(
        "DEV_WHITE_RC_CASH",
        white_cash.get("pValue"),
        f"<{white_limit}",
        float(white_cash["pValue"]) < white_limit,
    )
    add(
        "DEV_WHITE_RC_BENCHMARK",
        white_benchmark.get("pValue"),
        f"<{white_limit}",
        float(white_benchmark["pValue"]) < white_limit,
    )
    add(
        "DEV_STRESS_NET",
        dev.get("netUsdPerInitial1000"),
        ">0",
        float(dev["netUsdPerInitial1000"]) > 0,
    )
    dev_bootstrap = require_dict(dev.get("bootstrap"), "development.champion.bootstrap")
    add(
        "DEV_STRESS_LCB",
        dev_bootstrap.get("lower5PctNetUsdPer1k"),
        ">0",
        float(dev_bootstrap["lower5PctNetUsdPer1k"]) > 0,
    )
    add(
        "HOLDOUT_VALID_FORMATIONS",
        stress.get("validFormations"),
        f">={hold_gates['minimumValidFormations']}",
        int(stress["validFormations"]) >= int(hold_gates["minimumValidFormations"]),
    )
    add(
        "HOLDOUT_HOLDING_SPELLS",
        stress.get("holdingSpells"),
        f">={hold_gates['minimumHoldingSpells']}",
        int(stress["holdingSpells"]) >= int(hold_gates["minimumHoldingSpells"]),
    )
    add(
        "HOLDOUT_FILLS",
        stress.get("fills"),
        f">={hold_gates['minimumFills']}",
        int(stress["fills"]) >= int(hold_gates["minimumFills"]),
    )
    add(
        "HOLDOUT_DISTINCT_SYMBOLS",
        stress.get("distinctHeldSymbols"),
        f">={hold_gates['minimumDistinctSymbols']}",
        int(stress["distinctHeldSymbols"]) >= int(hold_gates["minimumDistinctSymbols"]),
    )
    add(
        "HOLDOUT_POSITIVE_STRESS_MONTHS",
        stress.get("positiveMonths"),
        f">={hold_gates['minimumPositiveStressMonths']}/{hold_gates['requiredPositiveStressMonthsOf']}",
        int(stress["positiveMonths"]) >= int(hold_gates["minimumPositiveStressMonths"]),
    )
    for label, summary in (
        ("HOLDOUT_BASE_NET", base),
        ("HOLDOUT_STRESS_NET", stress),
        ("HOLDOUT_FEE_STRESS_NET", fee_stress),
    ):
        add(
            label,
            summary.get("netUsdPerInitial1000"),
            ">0",
            float(summary["netUsdPerInitial1000"]) > 0,
        )
    stress_bootstrap = require_dict(stress.get("bootstrap"), "stress.bootstrap")
    add(
        "HOLDOUT_STRESS_LCB",
        stress_bootstrap.get("lower5PctNetUsdPer1k"),
        ">0",
        float(stress_bootstrap["lower5PctNetUsdPer1k"]) > 0,
    )
    holdout_p_limit = float(hold_gates["publicStressOneSidedPExclusiveMaximum"])
    add(
        "HOLDOUT_STRESS_ONE_SIDED_P",
        stress_packet.get("oneSidedP"),
        f"<{holdout_p_limit}",
        float(stress_packet["oneSidedP"]) < holdout_p_limit,
    )
    add(
        "HOLDOUT_MATCHED_BENCHMARK_EXCESS_LCB",
        excess.get("lower5PctNetUsdPer1k"),
        ">0",
        float(excess["lower5PctNetUsdPer1k"]) > 0,
    )
    drawdown_limit = float(hold_gates["maximumDailyCloseDrawdownPct"])
    add(
        "HOLDOUT_DRAWDOWN",
        stress.get("dailyCloseMaxDrawdownPct"),
        f"<={drawdown_limit}",
        float(stress["dailyCloseMaxDrawdownPct"]) <= drawdown_limit,
    )
    top_asset_limit = float(hold_gates["maximumTopAssetPositiveGrossProfitSharePct"])
    concentration = require_dict(stress.get("concentration"), "stress.concentration")
    top_asset = concentration.get("topAssetPositiveGrossProfitSharePct")
    add(
        "HOLDOUT_TOP_ASSET_CONCENTRATION",
        top_asset,
        f"<={top_asset_limit}",
        top_asset is not None and float(top_asset) <= top_asset_limit,
    )
    top_five_limit = float(hold_gates["maximumTopFiveHoldingSpellPositiveGrossProfitSharePct"])
    top_five = concentration.get("topFiveHoldingSpellPositiveGrossProfitSharePct")
    add(
        "HOLDOUT_TOP_FIVE_SPELL_CONCENTRATION",
        top_five,
        f"<={top_five_limit}",
        top_five is not None and float(top_five) <= top_five_limit,
    )
    add(
        "HOLDOUT_CAPACITY_PROXY_COMPLETE",
        capacity.get("fillsMissingProxy"),
        "==0",
        int(capacity["fillsMissingProxy"]) == 0,
    )
    max_limit = float(capacity_spec["gateMaximumParticipationBps"])
    max_participation = capacity.get("maximumParticipationBps")
    add(
        "HOLDOUT_MAX_PARTICIPATION_PROXY",
        max_participation,
        f"<={max_limit}bp",
        max_participation is not None and float(max_participation) <= max_limit,
    )
    minimum_capacity = float(capacity_spec["gateMinimumC1bpUsd"])
    c1bp = capacity.get("c1bpUsd")
    add(
        "HOLDOUT_C1BP_PROXY",
        c1bp,
        f">={minimum_capacity}",
        c1bp is not None and float(c1bp) >= minimum_capacity,
    )
    return expected


def verify_verdict(protocol: dict[str, Any], result: dict[str, Any]) -> None:
    if result.get("schema") != "VG23ResultV1":
        raise VerificationError("result schema mismatch")
    verdict = result.get("measurementVerdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VerificationError("result verdict vocabulary is open")
    authority = require_dict(result.get("authority"), "result.authority")
    if (
        authority.get("scope") != "PUBLIC_RESEARCH_ONLY"
        or authority.get("capitalVerdict") != "NO_GO"
        or authority.get("executionAuthority") != "NONE"
        or authority.get("effectUsd") != "0"
    ):
        raise VerificationError("result authority drift")
    if result.get("globalVolumeFamilyHoldoutStatus") != "NOT_CERTIFIED_SHARED_REUSE_RISK":
        raise VerificationError("global holdout reuse warning missing")
    if result.get("programWideMultiplicity") != {
        "status": "UNRESOLVED_OUTSIDE_PACKET",
        "consumerAdjustedPValue": "1",
        "localHolmAndWhiteRealityCheckScope": "VG23_SIX_TRIAL_FAMILY_ONLY",
        "verifiedPositiveEligible": False,
    }:
        raise VerificationError("program-wide multiplicity boundary drift")
    cost_truth = require_dict(result.get("costTruth"), "result.costTruth")
    if cost_truth != {
        "publicScenarioFees": "SENSITIVITY_ONLY",
        "accountEffectiveCommission": "UNKNOWN_PUBLIC_ONLY",
        "historicalAccountActualFee": "UNMEASURED",
    }:
        raise VerificationError("account-fee truth boundary drift")
    capacity_truth = require_dict(result.get("capacityTruth"), "result.capacityTruth")
    if capacity_truth != {
        "publicPrintCapacity": "PROXY_ONLY",
        "historicalExecutableBookCapacity": "UNMEASURED",
    }:
        raise VerificationError("executable-capacity truth boundary drift")
    gates = result.get("gateDecisions")
    if not isinstance(gates, list):
        raise VerificationError("gate decisions must be an array")
    if verdict == "GO":
        if not gates or not all(
            isinstance(row, dict) and row.get("passed") is True for row in gates
        ):
            raise VerificationError("GO is not the conjunction of frozen gates")
    elif verdict == "NO_GO":
        if not gates or not any(
            isinstance(row, dict) and row.get("passed") is False for row in gates
        ):
            raise VerificationError("NO_GO lacks a frozen failed gate")
    else:
        headline = require_dict(result.get("headline"), "result.headline")
        if any(
            headline.get(key) is not None
            for key in (
                "netUsdPerInitial1000",
                "samples",
                "fills",
                "holdoutInterval",
                "pbo",
                "drawdownPct",
                "feeStressNetUsdPerInitial1000",
            )
        ):
            raise VerificationError("UNMEASURED result contains economic estimates")
        if (
            headline.get("capacity") != "UNMEASURED"
            or result.get("development") is not None
            or result.get("holdout") is not None
            or gates
        ):
            raise VerificationError("UNMEASURED result contains measured state")
        return

    development = require_dict(result.get("development"), "result.development")
    holdout = require_dict(result.get("holdout"), "result.holdout")
    trials = require_dict(development.get("trials"), "development.trials")
    if (
        development.get("status") != "MEASURED"
        or development.get("scenario") != "PUBLIC_STRESS"
        or development.get("trialCount") != 6
        or set(trials)
        != {
            "A150_S20",
            "A150_S35",
            "A150_S50",
            "A200_S20",
            "A200_S35",
            "A200_S50",
        }
        or set(holdout) != {"PUBLIC_GROSS", "PUBLIC_BASE", "PUBLIC_STRESS", "FEE_STRESS"}
    ):
        raise VerificationError("measured trial/scenario family drift")
    pbo = require_dict(development.get("pbo"), "development.pbo")
    if (
        pbo.get("status") != "MEASURED"
        or pbo.get("method") != "CSCV"
        or pbo.get("role") != "DIAGNOSTIC_ONLY"
        or pbo.get("splits") != 70
        or pbo.get("pbo") is None
    ):
        raise VerificationError("PBO diagnostic is incomplete")
    headline = require_dict(result.get("headline"), "result.headline")
    stress_packet = require_dict(holdout.get("PUBLIC_STRESS"), "holdout.PUBLIC_STRESS")
    stress = require_dict(stress_packet.get("strategy"), "holdout.PUBLIC_STRESS.strategy")
    fee_packet = require_dict(holdout.get("FEE_STRESS"), "holdout.FEE_STRESS")
    fee_stress = require_dict(fee_packet.get("strategy"), "holdout.FEE_STRESS.strategy")
    capacity = require_dict(stress.get("capacityProxy"), "stress.capacityProxy")
    if (
        capacity.get("label") != "PUBLIC_PRINT_CAPACITY_PROXY_ONLY"
        or capacity.get("historicalExecutableBookCapacity") != "UNMEASURED"
    ):
        raise VerificationError("measured capacity proxy truth boundary drift")
    numeric_capacity_fields = (
        "maximumParticipationBps",
        "p95ParticipationBps",
        "c1bpUsd",
        "c1bpStrategyCapitalUsd",
        "minimumPerFillNotionalAt1bpUsd",
    )
    missing_proxy = capacity.get("fillsMissingProxy")
    if not isinstance(missing_proxy, int) or isinstance(missing_proxy, bool):
        raise VerificationError("capacity missing-fill count malformed")
    if missing_proxy:
        if capacity.get("status") != "UNMEASURED_REQUIRED_FILL_LIQUIDITY_MISSING" or any(
            capacity.get(field) is not None for field in numeric_capacity_fields
        ):
            raise VerificationError("incomplete capacity proxy contains numeric claims")
    elif capacity.get("status") == "MEASURED_PUBLIC_PRINT_PROXY":
        if any(capacity.get(field) is None for field in numeric_capacity_fields):
            raise VerificationError("measured capacity proxy lacks required values")
        if capacity.get("c1bpUsd") != capacity.get("c1bpStrategyCapitalUsd"):
            raise VerificationError("capacity strategy-capital aliases differ")
    elif capacity.get("status") != "NOT_APPLICABLE_NO_FILLS" or any(
        capacity.get(field) is not None for field in numeric_capacity_fields
    ):
        raise VerificationError("capacity proxy status/value mismatch")
    champion_id = development.get("championTrialId")
    if not isinstance(champion_id, str):
        raise VerificationError("development champion ID is malformed")
    champion = require_dict(trials.get(champion_id), "development.champion")
    champion_strategy = require_dict(champion.get("strategy"), "development.champion.strategy")
    expected_headline = {
        "netUsdPerInitial1000": stress.get("netUsdPerInitial1000"),
        "samples": {
            "developmentFormations": champion_strategy.get("validFormations"),
            "holdoutFormations": stress.get("validFormations"),
            "holdoutDailyObservations": stress.get("dailyObservations"),
        },
        "fills": {
            "development": champion_strategy.get("fills"),
            "holdout": stress.get("fills"),
        },
        "holdoutInterval": stress.get("bootstrap"),
        "pbo": development.get("pbo"),
        "drawdownPct": stress.get("dailyCloseMaxDrawdownPct"),
        "capacity": capacity,
        "feeStressNetUsdPerInitial1000": fee_stress.get("netUsdPerInitial1000"),
    }
    if headline != expected_headline:
        raise VerificationError("headline does not exactly derive from measured evidence")
    interval = require_dict(headline.get("holdoutInterval"), "headline.holdoutInterval")
    if any(
        interval.get(field) is None
        for field in (
            "lower5PctNetUsdPer1k",
            "medianNetUsdPer1k",
            "upper95PctNetUsdPer1k",
            "pointNetUsdPer1k",
        )
    ):
        raise VerificationError("holdout interval is incomplete")
    expected_gates = expected_gate_decisions(protocol, result)
    if gates != expected_gates:
        raise VerificationError("stored gates differ from frozen independent recomputation")
    expected_verdict = "GO" if all(row["passed"] is True for row in expected_gates) else "NO_GO"
    if verdict != expected_verdict:
        raise VerificationError("verdict differs from frozen gate conjunction")


def verify() -> dict[str, Any]:
    checksums = parse_checksums()
    protocol, protocol_raw = json_file("protocol.v1.json")
    freeze, freeze_raw = json_file("freeze.v1.json")
    result, _result_raw = json_file("result.v1.json")
    bindings = verify_static_bindings(protocol, protocol_raw, freeze, freeze_raw, result)
    lineage = verify_git_lineage(freeze, freeze_raw, bindings)
    marker_evidence = verify_markers(protocol, result, bindings)
    verify_verdict(protocol, result)
    return {
        "status": "PASS",
        "measurementVerdict": result["measurementVerdict"],
        "capitalVerdict": "NO_GO",
        "packetFileCount": len(checksums),
        "resultSha256": checksums["result.v1.json"],
        "lineage": lineage,
        "runControl": marker_evidence,
    }


def main() -> int:
    try:
        payload = verify()
    except (KeyError, OSError, TypeError, VerificationError, ValueError) as error:
        print(json.dumps({"status": "FAIL", "reason": str(error)}, sort_keys=True))
        return 1
    print(json.dumps(payload, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
