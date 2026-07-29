#!/usr/bin/env python3
"""Independent, network-free verifier for the sealed V-G38 terminal packet.

The verifier reads packet bytes and local Git objects only.  It never imports the
evaluator, opens an archive, reads the source corpus, or recomputes the experiment.
It authenticates the three-commit packet lineage and independently derives every
recorded development/holdout gate from the terminal result's primitive fields.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import sys
from collections.abc import Mapping
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from fractions import Fraction
from itertools import combinations
from pathlib import Path
from typing import Final, NoReturn, cast

PACKET_DIR: Final = Path(__file__).resolve().parent
REPO_ROOT: Final = PACKET_DIR.parents[2]
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
SOURCE_ACQUISITION_SHA256: Final = (
    "fb9335c4372b979cb930bee059e41f02db355973ddf1e1ae4d878b828df3517a"
)
BRANCH_NAME: Final = "codex/vg38-quote-volume-vov-compression-1be1-a07d"
ORIGIN_REF: Final = f"refs/remotes/origin/{BRANCH_NAME}"
PACKET_PREFIX: Final = "quant/research/vg38/"

STATIC_NAMES: Final = frozenset(
    {
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "__init__.py",
        "experiment.py",
        "protocol.v1.json",
        "test_experiment.py",
        "verify.py",
    }
)
SOURCE_FREEZE_NAMES: Final = frozenset(
    {
        "freeze.v1.json",
        "source-manifest.v1.json",
    }
)
TERMINAL_REQUIRED_NAMES: Final = frozenset(
    {
        "SHA256SUMS",
        "result.v1.json",
        "run-marker.v1.json",
    }
)
CANDIDATE_NAME: Final = "candidate-seal.v1.json"
HOLDOUT_NAME: Final = "holdout-open.v1.json"
CHECKSUM_NAME: Final = "SHA256SUMS"

BASE_PACKET_NAMES: Final = (
    STATIC_NAMES
    | frozenset({"freeze.v1.json", "source-manifest.v1.json"})
    | frozenset({"result.v1.json", "run-marker.v1.json"})
)
ALLOWED_PACKET_NAMES: Final = (
    BASE_PACKET_NAMES,
    BASE_PACKET_NAMES | frozenset({CANDIDATE_NAME}),
    BASE_PACKET_NAMES | frozenset({CANDIDATE_NAME, HOLDOUT_NAME}),
)
ALLOWED_TERMINAL_DIFF_NAMES: Final = (
    TERMINAL_REQUIRED_NAMES,
    TERMINAL_REQUIRED_NAMES | frozenset({CANDIDATE_NAME}),
    TERMINAL_REQUIRED_NAMES | frozenset({CANDIDATE_NAME, HOLDOUT_NAME}),
)

RESULT_KEYS: Final = frozenset(
    {
        "accountEffectiveFees",
        "baseCommit",
        "boundaryPurge",
        "capitalAuthority",
        "capacityTruth",
        "costScenarios",
        "createdAtUtc",
        "development",
        "freezeSha256",
        "holdout",
        "netEdge",
        "noSideEffects",
        "protocolSha256",
        "runMarkerSha256",
        "schema",
        "sourceManifestSha256",
        "sourceScope",
        "universeTruth",
        "verdict",
    }
)
NET_EDGE_KEYS: Final = frozenset(
    {
        "alwaysOnBenchmarkTotalUsdPer1000",
        "baseNetMeanDailyReturn",
        "baseNetOneSided95LcbDailyReturn",
        "baseNetTotalUsdPer1000",
        "excessVsAlwaysOnMeanDailyReturn",
        "excessVsAlwaysOnOneSided95LcbDailyReturn",
        "excessVsAlwaysOnTotalUsdPer1000",
        "scope",
        "trialId",
    }
)
DEVELOPMENT_ROW_KEYS: Final = frozenset(
    {
        "base",
        "capacity",
        "developmentMonthlyExcessReturns",
        "gates",
        "gross",
        "inference",
        "positiveAbsoluteTwoMonthFoldCount",
        "positiveExcessTwoMonthFoldCount",
        "stress",
        "trial",
        "twoMonthAbsoluteFoldReturns",
        "twoMonthExcessFoldReturns",
    }
)
DEVELOPMENT_GATE_KEYS: Final = frozenset(
    {
        "absoluteBaseOneSided95LcbPositive",
        "baseExcessTotalPositive",
        "excessOneSided95LcbPositive",
        "maxDrawdownAtMost20Pct",
        "offDayCountAtLeast30",
        "onDayCountAtLeast30",
        "positiveAbsoluteTwoMonthFoldsAtLeast4Of5",
        "positiveExcessTwoMonthFoldsAtLeast4Of5",
        "q14HolmSelectedAtFwer005",
        "q14PboAvailableAndAtMost020",
        "stressExcessTotalPositive",
        "stressNetTotalPositive",
    }
)
HOLDOUT_GATE_KEYS: Final = frozenset(
    {
        "absoluteBaseMeanPositive",
        "absoluteBaseOneSided95LcbPositive",
        "excessMeanPositive",
        "excessOneSided95LcbPositive",
        "excessOneSidedPBelow005",
        "maxDrawdownAtMost20Pct",
        "offDayCountAtLeast10",
        "onDayCountAtLeast10",
        "positiveAbsoluteMonthsAtLeast2Of3",
        "positiveExcessMonthsAtLeast2Of3",
        "stressExcessTotalPositive",
        "stressNetTotalPositive",
    }
)
NO_SIDE_EFFECTS: Final = {
    "hostMutation": False,
    "moneyMovement": False,
    "orderPlacement": False,
    "privateApiRead": False,
    "signedApiCall": False,
    "uiMutation": False,
}
ACCOUNT_FEE_TRUTH: Final = {
    "scope": "UNKNOWN",
    "value": None,
    "why": "PUBLIC_ONLY_PROTOCOL_FORBIDS_SIGNED_ACCOUNT_COMMISSION_READS",
}
CAPACITY_TRUTH: Final = {
    "executableCapacityUsd": None,
    "scope": "UNMEASURED",
    "why": "DAILY_PUBLIC_QUOTE_VOLUME_DOES_NOT_MEASURE_BOOK_DEPTH_FILL_PROBABILITY_OR_IMPACT",
}
RESULT_BOUNDARY_PURGE: Final = {
    "developmentFinalComputedScoreTraded": False,
    "developmentFinalLiquidationOpen": "2025-12-31",
    "developmentFirstEligibleLatestFeatureBar": "2025-03-01",
    "developmentFirstEligibleTargetOpen": "2025-03-03",
    "developmentFirstFullGapBar": "2025-03-02",
    "holdoutFinalComputedScoreTraded": False,
    "holdoutFinalLiquidationOpen": "2026-03-31",
    "holdoutFirstEligibleLatestFeatureBar": "2025-12-31",
    "holdoutFirstEligibleTargetOpen": "2026-01-02",
    "holdoutFirstFullGapBar": "2026-01-01",
}
DEVELOPMENT_BOUNDARY_PURGE: Final = {
    "firstEligibleLatestFeatureBar": "2025-03-01",
    "firstEligibleTargetOpen": "2025-03-03",
    "forcedFinalComputedScoreTraded": False,
    "forcedFinalLiquidationOpen": "2025-12-31",
    "fullGapBar": "2025-03-02",
}
HOLDOUT_BOUNDARY_PURGE: Final = {
    "firstEligibleLatestFeatureBar": "2025-12-31",
    "firstEligibleTargetOpen": "2026-01-02",
    "forcedFinalLiquidationOpen": "2026-03-31",
    "fullGapBar": "2026-01-01",
    "march31ComputedScoreTraded": False,
}
DEVELOPMENT_MONTHS: Final = tuple(f"2025-{month:02d}" for month in range(3, 13))
SELECTION_RULE: Final = (
    "HIGHEST_EXCESS_LCB_THEN_ABSOLUTE_LCB_THEN_LOWER_TRANSITIONS_THEN_"
    "LOWER_COMPRESSION_THRESHOLD_THEN_LONGER_BASELINE_THEN_LONGER_RECENT_"
    "THEN_TRIAL_ID"
)

HEX40: Final = re.compile(r"[0-9a-f]{40}")
HEX64: Final = re.compile(r"[0-9a-f]{64}")
SAFE_NAME: Final = re.compile(r"[A-Za-z0-9_.-]+")
SAFE_TRIAL_ID: Final = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
DECIMAL_TEXT: Final = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?")
MAX_PACKET_FILE_BYTES: Final = 64 * 1024 * 1024


class VerificationError(RuntimeError):
    """One terminal packet invariant failed."""


def digest(raw: bytes) -> str:
    """Return a lowercase SHA-256 digest."""

    return hashlib.sha256(raw).hexdigest()


def packet_path(name: str) -> Path:
    """Resolve one fixed packet basename without accepting traversal."""

    if SAFE_NAME.fullmatch(name) is None or name.startswith("."):
        raise VerificationError(f"unsafe packet filename: {name}")
    return PACKET_DIR / name


def file_bytes(name: str) -> bytes:
    """Read one bounded regular packet file."""

    path = packet_path(name)
    if path.is_symlink() or not path.is_file():
        raise VerificationError(f"required regular packet file unavailable: {name}")
    size = path.stat().st_size
    if size > MAX_PACKET_FILE_BYTES:
        raise VerificationError(f"packet file exceeds byte limit: {name}")
    return path.read_bytes()


def _object_without_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_float(raw: str) -> NoReturn:
    raise VerificationError(f"floating JSON number is forbidden: {raw}")


def _reject_constant(raw: str) -> NoReturn:
    raise VerificationError(f"non-finite JSON number is forbidden: {raw}")


def canonical_bytes(value: object) -> bytes:
    """Encode the evaluator's canonical, newline-terminated JSON representation."""

    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode()


def json_file(name: str, *, canonical: bool) -> tuple[dict[str, object], bytes]:
    """Load one duplicate-free JSON object and optionally require canonical bytes."""

    raw = file_bytes(name)
    try:
        parsed: object = json.loads(
            raw,
            object_pairs_hook=_object_without_duplicates,
            parse_float=_reject_float,
            parse_constant=_reject_constant,
        )
    except (json.JSONDecodeError, UnicodeDecodeError, RecursionError) as error:
        raise VerificationError(f"invalid JSON: {name}") from error
    if not isinstance(parsed, dict):
        raise VerificationError(f"JSON root is not an object: {name}")
    value = cast(dict[str, object], parsed)
    if canonical and raw != canonical_bytes(value):
        raise VerificationError(f"generated JSON is not canonical: {name}")
    return value, raw


def require_mapping(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise VerificationError(f"{field} must be an object")
    return cast(dict[str, object], value)


def require_sequence(value: object, field: str) -> list[object]:
    if not isinstance(value, list):
        raise VerificationError(f"{field} must be an array")
    return value


def require_string(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise VerificationError(f"{field} must be a string")
    return value


def require_int(value: object, field: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise VerificationError(f"{field} must be an integer >= {minimum}")
    return value


def require_sha256(value: object, field: str) -> str:
    text = require_string(value, field)
    if HEX64.fullmatch(text) is None:
        raise VerificationError(f"{field} must be a lowercase SHA-256 digest")
    return text


def require_exact_keys(value: Mapping[str, object], expected: frozenset[str], field: str) -> None:
    actual = set(value)
    if actual != set(expected):
        missing = sorted(set(expected) - actual)
        extra = sorted(actual - set(expected))
        raise VerificationError(f"{field} key mismatch; missing={missing} extra={extra}")


def decimal_value(value: object, field: str) -> Decimal:
    text = require_string(value, field)
    if DECIMAL_TEXT.fullmatch(text) is None:
        raise VerificationError(f"{field} is not canonical decimal text")
    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise VerificationError(f"{field} is not a decimal") from error
    if not parsed.is_finite():
        raise VerificationError(f"{field} is not finite")
    return parsed


def exact_fraction(value: object, field: str) -> Fraction:
    """Parse one reduced exact-rational mapping with bounded integer text."""

    exact = require_mapping(value, field)
    require_exact_keys(exact, frozenset({"denominator", "numerator"}), field)
    numerator_text = require_string(exact.get("numerator"), f"{field}.numerator")
    denominator_text = require_string(exact.get("denominator"), f"{field}.denominator")
    if (
        len(numerator_text) > 80
        or len(denominator_text) > 80
        or re.fullmatch(r"-?(?:0|[1-9][0-9]*)", numerator_text) is None
        or re.fullmatch(r"[1-9][0-9]*", denominator_text) is None
    ):
        raise VerificationError(f"{field} exact-rational grammar is invalid")
    numerator = int(numerator_text)
    denominator = int(denominator_text)
    if math.gcd(abs(numerator), denominator) != 1:
        raise VerificationError(f"{field} exact rational is not reduced")
    return Fraction(numerator, denominator)


def displayed_fraction(value: Fraction) -> Decimal:
    """Apply the evaluator's twelve-place HALF_EVEN display law."""

    return (Decimal(value.numerator) / Decimal(value.denominator)).quantize(
        Decimal("0.000000000001"),
        rounding=ROUND_HALF_EVEN,
    )


def git_bytes(*arguments: str) -> bytes:
    """Run one read-only local Git query."""

    try:
        completed = subprocess.run(
            ("git", *arguments),
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise VerificationError(f"Git evidence unavailable: {' '.join(arguments)}") from error
    return completed.stdout


def git_text(*arguments: str) -> str:
    return git_bytes(*arguments).decode("utf-8", errors="strict").strip()


def single_parent(commit: str, field: str) -> str:
    row = git_text("rev-list", "--parents", "-n", "1", commit).split()
    if len(row) != 2 or row[0] != commit or HEX40.fullmatch(row[1]) is None:
        raise VerificationError(f"{field} must be a single-parent commit")
    return row[1]


def changed_paths(commit: str) -> frozenset[str]:
    raw = git_bytes("diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit)
    names = [item.decode("utf-8", errors="strict") for item in raw.split(b"\0") if item]
    if len(names) != len(set(names)):
        raise VerificationError(f"duplicate changed path in commit {commit}")
    return frozenset(names)


def prefixed(names: frozenset[str]) -> frozenset[str]:
    return frozenset(f"{PACKET_PREFIX}{name}" for name in names)


def verify_git_lineage(packet_names: frozenset[str]) -> dict[str, str]:
    """Authenticate the exact three-commit local/origin packet lineage."""

    if git_text("status", "--porcelain=v1", "--untracked-files=all"):
        raise VerificationError("terminal worktree is not clean")
    branch = git_text("symbolic-ref", "--quiet", "--short", "HEAD")
    if branch != BRANCH_NAME:
        raise VerificationError(f"terminal branch mismatch: {branch}")

    head = git_text("rev-parse", "--verify", "HEAD^{commit}")
    origin = git_text("rev-parse", "--verify", f"{ORIGIN_REF}^{{commit}}")
    if HEX40.fullmatch(head) is None or origin != head:
        raise VerificationError("origin branch ref does not equal terminal HEAD")

    source_commit = single_parent(head, "terminal commit")
    static_commit = single_parent(source_commit, "source-freeze commit")
    static_parent = single_parent(static_commit, "static commit")
    if static_parent != BASE_COMMIT:
        raise VerificationError("static commit is not a direct child of the canonical base")

    static_paths = changed_paths(static_commit)
    source_paths = changed_paths(source_commit)
    terminal_paths = changed_paths(head)
    if static_paths != prefixed(STATIC_NAMES):
        raise VerificationError("static commit path set differs from the frozen allowlist")
    if source_paths != prefixed(SOURCE_FREEZE_NAMES):
        raise VerificationError("source-freeze commit path set differs from the frozen allowlist")
    if terminal_paths not in tuple(prefixed(names) for names in ALLOWED_TERMINAL_DIFF_NAMES):
        raise VerificationError("terminal commit path set differs from the frozen allowlist")
    for paths in (static_paths, source_paths, terminal_paths):
        if any(not path.startswith(PACKET_PREFIX) for path in paths):
            raise VerificationError("packet lineage contains an out-of-scope path")

    tree_paths = frozenset(
        line
        for line in git_text(
            "ls-tree", "-r", "--name-only", "HEAD", "--", PACKET_PREFIX
        ).splitlines()
        if line
    )
    expected_tree_paths = prefixed(packet_names | frozenset({CHECKSUM_NAME}))
    if tree_paths != expected_tree_paths:
        raise VerificationError("terminal Git tree differs from the packet inventory")

    for name in STATIC_NAMES:
        if git_bytes("show", f"{static_commit}:{PACKET_PREFIX}{name}") != file_bytes(name):
            raise VerificationError(f"static packet bytes drifted after freeze: {name}")
    for name in ("freeze.v1.json", "source-manifest.v1.json"):
        if git_bytes("show", f"{source_commit}:{PACKET_PREFIX}{name}") != file_bytes(name):
            raise VerificationError(f"source-freeze packet bytes drifted: {name}")
    for name in packet_names | frozenset({CHECKSUM_NAME}):
        if git_bytes("show", f"HEAD:{PACKET_PREFIX}{name}") != file_bytes(name):
            raise VerificationError(f"terminal packet bytes differ from HEAD: {name}")

    return {
        "head": head,
        "sourceCommit": source_commit,
        "staticCommit": static_commit,
    }


def parse_checksums() -> tuple[frozenset[str], dict[str, str]]:
    """Authenticate a fixed packet inventory, excluding only SHA256SUMS itself."""

    raw = file_bytes(CHECKSUM_NAME)
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError as error:
        raise VerificationError("SHA256SUMS is not ASCII") from error
    expected: dict[str, str] = {}
    for line in lines:
        parts = line.split("  ", 1)
        if len(parts) != 2 or HEX64.fullmatch(parts[0]) is None:
            raise VerificationError("SHA256SUMS row is malformed")
        name = parts[1]
        if (
            SAFE_NAME.fullmatch(name) is None
            or name.startswith(".")
            or "/" in name
            or "\\" in name
            or name in expected
            or name == CHECKSUM_NAME
        ):
            raise VerificationError("SHA256SUMS filename is malformed or duplicate")
        expected[name] = parts[0]

    packet_names = frozenset(expected)
    if packet_names not in ALLOWED_PACKET_NAMES:
        raise VerificationError("SHA256SUMS file set differs from every fixed packet allowlist")
    entries = {path.name for path in PACKET_DIR.iterdir()}
    if entries != set(packet_names | frozenset({CHECKSUM_NAME})):
        raise VerificationError("packet directory contains an unexpected or missing entry")
    for name, expected_digest in expected.items():
        if digest(file_bytes(name)) != expected_digest:
            raise VerificationError(f"packet byte drift: {name}")
    return packet_names, expected


def protocol_trial_grid(protocol: Mapping[str, object]) -> list[dict[str, object]]:
    """Reconstruct the exact frozen 2x2x2 V-G38 trial family."""

    signal = require_mapping(protocol.get("signal"), "protocol.signal")
    grid = require_mapping(signal.get("candidateGrid"), "protocol.signal.candidateGrid")
    recent = require_sequence(
        grid.get("recentCompleteChanges"),
        "protocol.signal.candidateGrid.recentCompleteChanges",
    )
    baseline = require_sequence(
        grid.get("baselineCompleteChanges"),
        "protocol.signal.candidateGrid.baselineCompleteChanges",
    )
    thresholds = require_sequence(
        grid.get("compressionRatioThreshold"),
        "protocol.signal.candidateGrid.compressionRatioThreshold",
    )
    if (
        recent != [7, 14]
        or baseline != [30, 45]
        or thresholds != ["0.50", "0.75"]
        or grid.get("trialCount") != 8
    ):
        raise VerificationError("protocol trial grid differs from the frozen 2x2x2 family")
    trials: list[dict[str, object]] = [
        {
            "baselineDays": baseline_days,
            "compressionThreshold": threshold,
            "recentDays": recent_days,
            "trialId": (
                f"vg38-r{recent_days:02d}-b{baseline_days:02d}-c{int(Decimal(threshold) * 100):02d}"
            ),
        }
        for recent_days in (7, 14)
        for baseline_days in (30, 45)
        for threshold in ("0.50", "0.75")
    ]
    return sorted(trials, key=lambda trial: cast(str, trial["trialId"]))


def verify_protocol_and_freeze(
    *,
    lineage: Mapping[str, str],
) -> tuple[dict[str, object], dict[str, object], dict[str, object], dict[str, object]]:
    """Verify protocol, source manifest, freeze receipt, and run marker bindings."""

    protocol, protocol_raw = json_file("protocol.v1.json", canonical=False)
    source, source_raw = json_file("source-manifest.v1.json", canonical=True)
    freeze, freeze_raw = json_file("freeze.v1.json", canonical=True)
    marker, _marker_raw = json_file("run-marker.v1.json", canonical=True)

    if (
        protocol.get("schema") != "VG38QuoteVolumeVoVCompressionProtocolV1"
        or protocol.get("baseCommit") != BASE_COMMIT
    ):
        raise VerificationError("protocol schema or canonical base mismatch")
    verdict_law = require_mapping(protocol.get("verdictLaw"), "protocol.verdictLaw")
    if (
        verdict_law.get("capitalAuthority") != "NONE"
        or verdict_law.get("consumer") != "N3_SUCCESSOR_ORCHESTRATOR_SCOREBOARD"
    ):
        raise VerificationError("protocol verdict authority boundary mismatch")
    costs = require_mapping(protocol.get("costs"), "protocol.costs")
    if costs.get("accountEffectiveFeeTruth") != "UNKNOWN":
        raise VerificationError("protocol account fee truth is not UNKNOWN")
    data = require_mapping(protocol.get("data"), "protocol.data")
    signal = require_mapping(protocol.get("signal"), "protocol.signal")
    execution = require_mapping(protocol.get("execution"), "protocol.execution")
    if (
        data.get("boundaryPurge")
        != (
            "for an open on D the latest feature bar is D-2 and D-1 is a complete unused "
            "gap bar; the first development feature ends 2025-03-01, gap is 2025-03-02, "
            "and entry is 2025-03-03; the first holdout feature ends 2025-12-31, gap is "
            "2026-01-01, and entry is 2026-01-02; final liquidation scores are computed "
            "but forcibly ignored"
        )
        or signal.get("strictLag")
        != (
            "for target open D the latest input quote-volume bar is D-2; D-1 and every "
            "later field are excluded"
        )
        or execution.get("entry")
        != "score using quote-volume bars only through D-2, leave D-1 unused, enter at D open"
    ):
        raise VerificationError("protocol D-2 feature / D-1 gap boundary law mismatch")

    if (
        source.get("schema") != "VG38FrozenBinancePublicSourceManifestV1"
        or source.get("state") != "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG38"
        or source.get("archiveBodiesOpenedDuringFreeze") is not False
        or source.get("protocolSha256") != digest(protocol_raw)
        or source.get("acquisitionManifestSha256") != SOURCE_ACQUISITION_SHA256
        or data.get("acquisitionManifestSha256") != SOURCE_ACQUISITION_SHA256
    ):
        raise VerificationError("source manifest schema, state, or protocol binding mismatch")
    artifacts = require_sequence(source.get("artifacts"), "source.artifacts")
    if require_int(source.get("artifactCount"), "source.artifactCount") != len(artifacts):
        raise VerificationError("source artifact count mismatch")
    identities: set[tuple[str, str]] = set()
    for index, raw_artifact in enumerate(artifacts):
        artifact = require_mapping(raw_artifact, f"source.artifacts[{index}]")
        identity = (
            require_string(artifact.get("symbol"), f"source.artifacts[{index}].symbol"),
            require_string(artifact.get("month"), f"source.artifacts[{index}].month"),
        )
        if identity in identities:
            raise VerificationError("source manifest contains a duplicate symbol-month")
        identities.add(identity)
        require_sha256(artifact.get("zipSha256"), f"source.artifacts[{index}].zipSha256")
        require_sha256(
            artifact.get("checksumSha256"),
            f"source.artifacts[{index}].checksumSha256",
        )
    universe = require_mapping(protocol.get("universe"), "protocol.universe")
    cohort = tuple(
        require_string(value, f"protocol.universe.cohort[{index}]")
        for index, value in enumerate(
            require_sequence(universe.get("cohort"), "protocol.universe.cohort")
        )
    )
    months = tuple(
        require_string(value, f"protocol.data.sourceMonths[{index}]")
        for index, value in enumerate(
            require_sequence(data.get("sourceMonths"), "protocol.data.sourceMonths")
        )
    )
    expected_identities = {(symbol, month) for symbol in cohort for month in months}
    if (
        identities != expected_identities
        or len(artifacts) != 180
        or source.get("symbolCount") != len(cohort)
        or source.get("monthCount") != len(months)
        or source.get("cohort") != list(cohort)
        or source.get("months") != list(months)
    ):
        raise VerificationError("source manifest matrix differs from the frozen protocol")

    if (
        freeze.get("schema") != "VG38PreOutcomeFreezeV1"
        or freeze.get("state") != "READY_FOR_SOLE_ARCHIVE_DECOMPRESSION_RUN"
        or freeze.get("archiveBodiesOpened") is not False
        or freeze.get("baseCommit") != BASE_COMMIT
        or freeze.get("gitHead") != lineage["staticCommit"]
        or freeze.get("evaluatorPath") != f"{PACKET_PREFIX}experiment.py"
    ):
        raise VerificationError("freeze receipt schema, state, or static lineage mismatch")
    expected_freeze_hashes = {
        "evaluatorSha256": digest(file_bytes("experiment.py")),
        "initSha256": digest(file_bytes("__init__.py")),
        "officialSourceResearchSha256": digest(file_bytes("OFFICIAL_SOURCE_RESEARCH.md")),
        "protocolSha256": digest(protocol_raw),
        "readmeSha256": digest(file_bytes("README.md")),
        "sourceManifestSha256": digest(source_raw),
        "testSha256": digest(file_bytes("test_experiment.py")),
        "verifierSha256": digest(file_bytes("verify.py")),
    }
    for field, expected in expected_freeze_hashes.items():
        if freeze.get(field) != expected:
            raise VerificationError(f"freeze byte binding mismatch: {field}")
    if freeze.get("trialGridSha256") != digest(canonical_bytes(protocol_trial_grid(protocol))):
        raise VerificationError("freeze trial-grid digest does not recompute")

    if (
        marker.get("schema") != "VG38ExclusiveRunMarkerV1"
        or marker.get("state") != "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED"
        or marker.get("archiveDecompressionRunOrdinal") != 1
        or marker.get("holdoutReuseMaximum") != 1
        or marker.get("gitHead") != lineage["sourceCommit"]
        or marker.get("evaluatorSha256") != expected_freeze_hashes["evaluatorSha256"]
        or marker.get("freezeSha256") != digest(freeze_raw)
        or marker.get("sourceManifestSha256") != digest(source_raw)
    ):
        raise VerificationError("run marker schema, count, lineage, or digest binding mismatch")

    return protocol, source, freeze, marker


def gate_inputs(protocol: Mapping[str, object], section: str) -> dict[str, object]:
    return require_mapping(protocol.get(section), f"protocol.{section}")


def development_family_decisions(
    rows: list[dict[str, object]],
    development: Mapping[str, object],
    protocol: Mapping[str, object],
) -> tuple[frozenset[str], bool]:
    """Recompute Q14 Holm selection and the serialized PBO threshold decision."""

    raw_p_values: dict[str, Fraction] = {}
    recorded_adjusted: dict[str, Fraction] = {}
    monthly_paths: list[tuple[Fraction, ...]] = []
    ordered_trial_ids: list[str] = []
    for index, row in enumerate(rows):
        field = f"result.development.candidateRows[{index}]"
        trial = require_mapping(row.get("trial"), f"{field}.trial")
        trial_id = require_string(trial.get("trialId"), f"{field}.trial.trialId")
        if SAFE_TRIAL_ID.fullmatch(trial_id) is None or trial_id in raw_p_values:
            raise VerificationError("development trial identity is invalid or duplicate")
        ordered_trial_ids.append(trial_id)
        inference = require_mapping(row.get("inference"), f"{field}.inference")
        absolute = require_mapping(
            inference.get("absoluteBase"),
            f"{field}.inference.absoluteBase",
        )
        excess = require_mapping(
            inference.get("excessVsAlwaysOn"),
            f"{field}.inference.excessVsAlwaysOn",
        )
        absolute_p = exact_fraction(
            absolute.get("oneSidedPExact"),
            f"{field}.inference.absoluteBase.oneSidedPExact",
        )
        if decimal_value(
            absolute.get("oneSidedPValue"),
            f"{field}.inference.absoluteBase.oneSidedPValue",
        ) != displayed_fraction(absolute_p):
            raise VerificationError(f"{field} absolute p-value display differs from exact value")
        p_display = decimal_value(
            excess.get("oneSidedPValue"),
            f"{field}.inference.excessVsAlwaysOn.oneSidedPValue",
        )
        p_value = exact_fraction(
            excess.get("oneSidedPExact"),
            f"{field}.inference.excessVsAlwaysOn.oneSidedPExact",
        )
        if p_value < 0 or p_value > 1 or p_display != displayed_fraction(p_value):
            raise VerificationError(f"{field} excess p-value lies outside [0, 1]")
        raw_p_values[trial_id] = p_value
        adjusted_display = decimal_value(
            inference.get("holmAdjustedPValue"),
            f"{field}.inference.holmAdjustedPValue",
        )
        adjusted_exact = exact_fraction(
            inference.get("holmAdjustedPExact"),
            f"{field}.inference.holmAdjustedPExact",
        )
        if adjusted_display != displayed_fraction(adjusted_exact):
            raise VerificationError(f"{field} adjusted p-value display differs from exact value")
        recorded_adjusted[trial_id] = adjusted_exact
        monthly_rows = require_sequence(
            row.get("developmentMonthlyExcessReturns"),
            f"{field}.developmentMonthlyExcessReturns",
        )
        if len(monthly_rows) != len(DEVELOPMENT_MONTHS):
            raise VerificationError(f"{field} must expose all ten development months")
        monthly_values: list[Fraction] = []
        for month_index, expected_month in enumerate(DEVELOPMENT_MONTHS):
            monthly = require_mapping(
                monthly_rows[month_index],
                f"{field}.developmentMonthlyExcessReturns[{month_index}]",
            )
            require_exact_keys(
                monthly,
                frozenset({"exactReturn", "month", "return"}),
                f"{field}.developmentMonthlyExcessReturns[{month_index}]",
            )
            if monthly.get("month") != expected_month:
                raise VerificationError(f"{field} development months are not frozen and ordered")
            decimal_value(
                monthly.get("return"),
                f"{field}.developmentMonthlyExcessReturns[{month_index}].return",
            )
            exact = require_mapping(
                monthly.get("exactReturn"),
                f"{field}.developmentMonthlyExcessReturns[{month_index}].exactReturn",
            )
            require_exact_keys(
                exact,
                frozenset({"denominator", "numerator"}),
                f"{field}.developmentMonthlyExcessReturns[{month_index}].exactReturn",
            )
            numerator_text = require_string(
                exact.get("numerator"),
                f"{field}.developmentMonthlyExcessReturns[{month_index}].exactReturn.numerator",
            )
            denominator_text = require_string(
                exact.get("denominator"),
                f"{field}.developmentMonthlyExcessReturns[{month_index}].exactReturn.denominator",
            )
            if (
                re.fullmatch(r"-?(?:0|[1-9][0-9]*)", numerator_text) is None
                or re.fullmatch(r"[1-9][0-9]*", denominator_text) is None
            ):
                raise VerificationError(f"{field} exact monthly return grammar is invalid")
            numerator = int(numerator_text)
            denominator = int(denominator_text)
            if math.gcd(abs(numerator), denominator) != 1:
                raise VerificationError(f"{field} exact monthly return is not reduced")
            monthly_values.append(Fraction(numerator, denominator))
        monthly_paths.append(tuple(monthly_values))
    if ordered_trial_ids != sorted(ordered_trial_ids):
        raise VerificationError("development candidate rows are not sorted by trial identity")

    gates = gate_inputs(protocol, "developmentGates")
    alpha = decimal_value(
        gates.get("holmFamilywiseAlpha"),
        "protocol.developmentGates.holmFamilywiseAlpha",
    )
    if alpha <= 0 or alpha >= 1:
        raise VerificationError("protocol Holm alpha lies outside (0, 1)")
    ordered = sorted(raw_p_values.items(), key=lambda item: (item[1], item[0]))
    selected: set[str] = set()
    adjusted: dict[str, Fraction] = {}
    latched_failure = False
    running_adjusted = Fraction(0)
    count = len(ordered)
    for rank, (trial_id, p_value) in enumerate(ordered):
        multiplier = count - rank
        threshold = Fraction(alpha) / multiplier
        passes = not latched_failure and p_value <= threshold
        if not passes:
            latched_failure = True
        else:
            selected.add(trial_id)
        running_adjusted = max(running_adjusted, min(Fraction(1), multiplier * p_value))
        adjusted[trial_id] = running_adjusted
    if adjusted != recorded_adjusted:
        raise VerificationError("recorded Holm-adjusted p-values do not recompute")

    pbo = require_mapping(development.get("pbo"), "result.development.pbo")
    distinct_path_count = len(set(monthly_paths))
    split_count = 0
    underperform_count = 0
    if distinct_path_count >= 2:
        for in_sample in combinations(range(len(DEVELOPMENT_MONTHS)), 5):
            split_count += 1
            in_sample_set = frozenset(in_sample)
            out_sample = tuple(
                index for index in range(len(DEVELOPMENT_MONTHS)) if index not in in_sample_set
            )
            in_sample_scores = [
                sum((path[index] for index in in_sample), Fraction(0)) for path in monthly_paths
            ]
            best_trial = 0
            for trial_index in range(1, len(monthly_paths)):
                if in_sample_scores[trial_index] > in_sample_scores[best_trial]:
                    best_trial = trial_index
            out_sample_scores = [
                sum((path[index] for index in out_sample), Fraction(0)) for path in monthly_paths
            ]
            ordered_scores = sorted(out_sample_scores)
            median = (
                ordered_scores[(len(ordered_scores) - 1) // 2]
                + ordered_scores[len(ordered_scores) // 2]
            ) / 2
            if out_sample_scores[best_trial] <= median:
                underperform_count += 1
    pbo_passes = False
    if distinct_path_count < 2:
        if (
            pbo.get("status") != "INVALID_DISTINCT_PATHS_BELOW_2"
            or pbo.get("pbo") is not None
            or pbo.get("splitCount") != 0
            or pbo.get("underperformCount") != 0
        ):
            raise VerificationError("serialized degenerate PBO does not independently recompute")
    else:
        recomputed_pbo = (Decimal(underperform_count) / Decimal(split_count)).quantize(
            Decimal("0.000000000001"),
            rounding=ROUND_HALF_EVEN,
        )
        if (
            pbo.get("status") != "AVAILABLE"
            or decimal_value(pbo.get("pbo"), "result.development.pbo.pbo") != recomputed_pbo
            or pbo.get("splitCount") != split_count
            or pbo.get("underperformCount") != underperform_count
        ):
            raise VerificationError("serialized CSCV-PBO does not independently recompute")
        pbo_passes = recomputed_pbo <= decimal_value(
            gates.get("pboMustBeAvailableAndAtMost"),
            "protocol.developmentGates.pboMustBeAvailableAndAtMost",
        )
    if (
        pbo.get("blockCount") != len(DEVELOPMENT_MONTHS)
        or pbo.get("distinctTrialPathCount") != distinct_path_count
        or pbo.get("method") != "Q14_CSCV_10_MONTHS_CHOOSE_5"
        or pbo.get("gateAtMost020") is not pbo_passes
    ):
        raise VerificationError("recorded PBO metadata or gate does not recompute")
    return frozenset(selected), pbo_passes


def development_gate_decisions(
    row: Mapping[str, object],
    protocol: Mapping[str, object],
    index: int,
    *,
    holm_selected: frozenset[str],
    pbo_passes: bool,
) -> tuple[str, dict[str, bool]]:
    """Independently derive all development gate booleans from serialized inputs."""

    field = f"result.development.candidateRows[{index}]"
    require_exact_keys(row, DEVELOPMENT_ROW_KEYS, field)
    base = require_mapping(row.get("base"), f"{field}.base")
    stress = require_mapping(row.get("stress"), f"{field}.stress")
    capacity = require_mapping(row.get("capacity"), f"{field}.capacity")
    if (
        capacity.get("executableCapacityUsd") is not None
        or capacity.get("scope")
        != "UNMEASURED_EXECUTABLE_CAPACITY; PUBLIC_PARTICIPATION_SENSITIVITY_ONLY"
    ):
        raise VerificationError(f"{field}.capacity overstates executable capacity")
    inference = require_mapping(row.get("inference"), f"{field}.inference")
    absolute = require_mapping(inference.get("absoluteBase"), f"{field}.inference.absoluteBase")
    excess = require_mapping(
        inference.get("excessVsAlwaysOn"),
        f"{field}.inference.excessVsAlwaysOn",
    )
    trial = require_mapping(row.get("trial"), f"{field}.trial")
    trial_id = require_string(trial.get("trialId"), f"{field}.trial.trialId")
    if SAFE_TRIAL_ID.fullmatch(trial_id) is None:
        raise VerificationError(f"{field}.trial.trialId has invalid grammar")

    absolute_folds = [
        decimal_value(value, f"{field}.twoMonthAbsoluteFoldReturns[{offset}]")
        for offset, value in enumerate(
            require_sequence(row.get("twoMonthAbsoluteFoldReturns"), f"{field}.absoluteFolds")
        )
    ]
    excess_folds = [
        decimal_value(value, f"{field}.twoMonthExcessFoldReturns[{offset}]")
        for offset, value in enumerate(
            require_sequence(row.get("twoMonthExcessFoldReturns"), f"{field}.excessFolds")
        )
    ]
    if len(absolute_folds) != 5 or len(excess_folds) != 5:
        raise VerificationError(f"{field} must carry exactly five development folds")
    absolute_positive = sum(value > 0 for value in absolute_folds)
    excess_positive = sum(value > 0 for value in excess_folds)
    if (
        row.get("positiveAbsoluteTwoMonthFoldCount") != absolute_positive
        or row.get("positiveExcessTwoMonthFoldCount") != excess_positive
    ):
        raise VerificationError(f"{field} positive-fold counts do not derive from fold returns")

    gates = gate_inputs(protocol, "developmentGates")
    expected = {
        "absoluteBaseOneSided95LcbPositive": decimal_value(
            absolute.get("oneSided95LcbUsdPerDayPer1000"),
            f"{field}.inference.absoluteBase.oneSided95LcbUsdPerDayPer1000",
        )
        > decimal_value(
            gates.get("absoluteBaseOneSided95LcbMustExceedUsdPerDayPer1000"),
            "protocol.developmentGates.absoluteBaseOneSided95LcbMustExceed",
        ),
        "baseExcessTotalPositive": decimal_value(
            base.get("excessTotalUsdPer1000"),
            f"{field}.base.excessTotalUsdPer1000",
        )
        > decimal_value(
            gates.get("baseExcessTotalUsdPer1000MustExceed"),
            "protocol.developmentGates.baseExcessTotalMustExceed",
        ),
        "excessOneSided95LcbPositive": decimal_value(
            excess.get("oneSided95LcbUsdPerDayPer1000"),
            f"{field}.inference.excessVsAlwaysOn.oneSided95LcbUsdPerDayPer1000",
        )
        > decimal_value(
            gates.get("excessOneSided95LcbMustExceedUsdPerDayPer1000"),
            "protocol.developmentGates.excessOneSided95LcbMustExceed",
        ),
        "maxDrawdownAtMost20Pct": decimal_value(
            base.get("maxDrawdown"),
            f"{field}.base.maxDrawdown",
        )
        <= decimal_value(
            gates.get("maximumDrawdownFraction"),
            "protocol.developmentGates.maximumDrawdownFraction",
        ),
        "offDayCountAtLeast30": require_int(
            base.get("offDayCount"),
            f"{field}.base.offDayCount",
        )
        >= require_int(
            gates.get("minimumOffDays"),
            "protocol.developmentGates.minimumOffDays",
        ),
        "onDayCountAtLeast30": require_int(
            base.get("onDayCount"),
            f"{field}.base.onDayCount",
        )
        >= require_int(
            gates.get("minimumOnDays"),
            "protocol.developmentGates.minimumOnDays",
        ),
        "positiveAbsoluteTwoMonthFoldsAtLeast4Of5": absolute_positive
        >= require_int(
            gates.get("minimumPositiveAbsoluteTwoMonthFolds"),
            "protocol.developmentGates.minimumPositiveAbsoluteTwoMonthFolds",
        ),
        "positiveExcessTwoMonthFoldsAtLeast4Of5": excess_positive
        >= require_int(
            gates.get("minimumPositiveExcessTwoMonthFolds"),
            "protocol.developmentGates.minimumPositiveExcessTwoMonthFolds",
        ),
        "q14HolmSelectedAtFwer005": trial_id in holm_selected,
        "q14PboAvailableAndAtMost020": pbo_passes,
        "stressExcessTotalPositive": decimal_value(
            stress.get("excessTotalUsdPer1000"),
            f"{field}.stress.excessTotalUsdPer1000",
        )
        > decimal_value(
            gates.get("stressExcessTotalUsdPer1000MustExceed"),
            "protocol.developmentGates.stressExcessTotalUsdPer1000MustExceed",
        ),
        "stressNetTotalPositive": decimal_value(
            stress.get("totalUsdPer1000"),
            f"{field}.stress.totalUsdPer1000",
        )
        > decimal_value(
            gates.get("stressNetTotalUsdPer1000MustExceed"),
            "protocol.developmentGates.stressNetTotalUsdPer1000MustExceed",
        ),
    }
    if frozenset(expected) != DEVELOPMENT_GATE_KEYS:
        raise VerificationError("independent development gate implementation is incomplete")
    recorded = require_mapping(row.get("gates"), f"{field}.gates")
    if recorded != expected:
        raise VerificationError(f"{field} recorded gates do not recompute")
    return trial_id, expected


def verify_development(
    result: Mapping[str, object],
    protocol: Mapping[str, object],
) -> tuple[dict[str, object] | None, dict[str, dict[str, bool]]]:
    development_raw = result.get("development")
    if development_raw is None:
        return None, {}
    development = require_mapping(development_raw, "result.development")
    if (
        development.get("alignedDailyPath") is not True
        or development.get("boundaryPurge") != DEVELOPMENT_BOUNDARY_PURGE
    ):
        raise VerificationError("development D-2 feature / D-1 gap evidence mismatch")
    rows_raw = require_sequence(
        development.get("candidateRows"),
        "result.development.candidateRows",
    )
    candidate_count = require_int(
        development.get("candidateCount"),
        "result.development.candidateCount",
    )
    if candidate_count != len(rows_raw):
        raise VerificationError("development candidate count does not equal row count")
    signal = require_mapping(protocol.get("signal"), "protocol.signal")
    grid = require_mapping(signal.get("candidateGrid"), "protocol.signal.candidateGrid")
    if candidate_count != require_int(
        grid.get("trialCount"),
        "protocol.signal.candidateGrid.trialCount",
        minimum=1,
    ):
        raise VerificationError("development candidate count differs from frozen protocol")

    rows = [
        require_mapping(raw_row, f"result.development.candidateRows[{index}]")
        for index, raw_row in enumerate(rows_raw)
    ]
    recorded_trials = [
        require_mapping(
            row.get("trial"),
            f"result.development.candidateRows[{index}].trial",
        )
        for index, row in enumerate(rows)
    ]
    if recorded_trials != protocol_trial_grid(protocol):
        raise VerificationError("development rows differ from the exact frozen trial grid")
    holm_selected, pbo_passes = development_family_decisions(rows, development, protocol)
    decisions: dict[str, dict[str, bool]] = {}
    ordered_ids: list[str] = []
    for index, row in enumerate(rows):
        trial_id, gates = development_gate_decisions(
            row,
            protocol,
            index,
            holm_selected=holm_selected,
            pbo_passes=pbo_passes,
        )
        if trial_id in decisions:
            raise VerificationError("development contains a duplicate trial identity")
        decisions[trial_id] = gates
        ordered_ids.append(trial_id)
    if ordered_ids != sorted(ordered_ids):
        raise VerificationError("development candidate rows are not sorted by trial identity")
    return development, decisions


def holdout_gate_decisions(
    metrics: Mapping[str, object],
    protocol: Mapping[str, object],
) -> dict[str, bool]:
    """Independently derive all holdout gate booleans."""

    base = require_mapping(metrics.get("base"), "result.holdout.metrics.base")
    if metrics.get("boundaryPurge") != HOLDOUT_BOUNDARY_PURGE:
        raise VerificationError("holdout D-2 feature / D-1 gap evidence mismatch")
    stress = require_mapping(metrics.get("stress"), "result.holdout.metrics.stress")
    capacity = require_mapping(metrics.get("capacity"), "result.holdout.metrics.capacity")
    if (
        capacity.get("executableCapacityUsd") is not None
        or capacity.get("scope")
        != "UNMEASURED_EXECUTABLE_CAPACITY; PUBLIC_PARTICIPATION_SENSITIVITY_ONLY"
    ):
        raise VerificationError("holdout capacity evidence overstates executable capacity")
    inference = require_mapping(metrics.get("inference"), "result.holdout.metrics.inference")
    absolute = require_mapping(
        inference.get("absoluteBase"),
        "result.holdout.metrics.inference.absoluteBase",
    )
    excess = require_mapping(
        inference.get("excessVsAlwaysOn"),
        "result.holdout.metrics.inference.excessVsAlwaysOn",
    )
    for label, packet in (("absoluteBase", absolute), ("excessVsAlwaysOn", excess)):
        exact_p = exact_fraction(
            packet.get("oneSidedPExact"),
            f"result.holdout.metrics.inference.{label}.oneSidedPExact",
        )
        displayed_p = decimal_value(
            packet.get("oneSidedPValue"),
            f"result.holdout.metrics.inference.{label}.oneSidedPValue",
        )
        if displayed_p != displayed_fraction(exact_p):
            raise VerificationError(f"holdout {label} p-value display differs from exact value")
    absolute_months = [
        decimal_value(value, f"result.holdout.metrics.absoluteMonthReturns[{index}]")
        for index, value in enumerate(
            require_sequence(
                metrics.get("absoluteMonthReturns"),
                "result.holdout.metrics.absoluteMonthReturns",
            )
        )
    ]
    excess_months = [
        decimal_value(value, f"result.holdout.metrics.excessMonthReturns[{index}]")
        for index, value in enumerate(
            require_sequence(
                metrics.get("excessMonthReturns"),
                "result.holdout.metrics.excessMonthReturns",
            )
        )
    ]
    if len(absolute_months) != 3 or len(excess_months) != 3:
        raise VerificationError("holdout must carry exactly three calendar-month returns")
    absolute_positive = sum(value > 0 for value in absolute_months)
    excess_positive = sum(value > 0 for value in excess_months)
    if (
        metrics.get("positiveAbsoluteMonthCount") != absolute_positive
        or metrics.get("positiveExcessMonthCount") != excess_positive
    ):
        raise VerificationError("holdout positive-month counts do not derive from month returns")

    gates = gate_inputs(protocol, "holdoutGates")
    expected = {
        "absoluteBaseMeanPositive": decimal_value(
            absolute.get("meanDailyReturn"),
            "result.holdout.metrics.inference.absoluteBase.meanDailyReturn",
        )
        * Decimal(1000)
        > decimal_value(
            gates.get("absoluteBaseMeanMustExceedUsdPerDayPer1000"),
            "protocol.holdoutGates.absoluteBaseMeanMustExceed",
        ),
        "absoluteBaseOneSided95LcbPositive": decimal_value(
            absolute.get("oneSided95LcbUsdPerDayPer1000"),
            "result.holdout.metrics.inference.absoluteBase.oneSided95LcbUsdPerDayPer1000",
        )
        > decimal_value(
            gates.get("absoluteBaseOneSided95LcbMustExceedUsdPerDayPer1000"),
            "protocol.holdoutGates.absoluteBaseOneSided95LcbMustExceed",
        ),
        "excessMeanPositive": decimal_value(
            excess.get("meanDailyReturn"),
            "result.holdout.metrics.inference.excessVsAlwaysOn.meanDailyReturn",
        )
        * Decimal(1000)
        > decimal_value(
            gates.get("excessMeanMustExceedUsdPerDayPer1000"),
            "protocol.holdoutGates.excessMeanMustExceed",
        ),
        "excessOneSided95LcbPositive": decimal_value(
            excess.get("oneSided95LcbUsdPerDayPer1000"),
            "result.holdout.metrics.inference.excessVsAlwaysOn.oneSided95LcbUsdPerDayPer1000",
        )
        > decimal_value(
            gates.get("excessOneSided95LcbMustExceedUsdPerDayPer1000"),
            "protocol.holdoutGates.excessOneSided95LcbMustExceed",
        ),
        "excessOneSidedPBelow005": decimal_value(
            excess.get("oneSidedPValue"),
            "result.holdout.metrics.inference.excessVsAlwaysOn.oneSidedPValue",
        )
        < decimal_value(
            gates.get("excessOneSidedBootstrapPValueMustBeBelow"),
            "protocol.holdoutGates.excessOneSidedBootstrapPValueMustBeBelow",
        ),
        "maxDrawdownAtMost20Pct": decimal_value(
            base.get("maxDrawdown"),
            "result.holdout.metrics.base.maxDrawdown",
        )
        <= decimal_value(
            gates.get("maximumDrawdownFraction"),
            "protocol.holdoutGates.maximumDrawdownFraction",
        ),
        "offDayCountAtLeast10": require_int(
            base.get("offDayCount"),
            "result.holdout.metrics.base.offDayCount",
        )
        >= require_int(
            gates.get("minimumOffDays"),
            "protocol.holdoutGates.minimumOffDays",
        ),
        "onDayCountAtLeast10": require_int(
            base.get("onDayCount"),
            "result.holdout.metrics.base.onDayCount",
        )
        >= require_int(
            gates.get("minimumOnDays"),
            "protocol.holdoutGates.minimumOnDays",
        ),
        "positiveAbsoluteMonthsAtLeast2Of3": absolute_positive
        >= require_int(
            gates.get("minimumPositiveAbsoluteCalendarMonths"),
            "protocol.holdoutGates.minimumPositiveAbsoluteCalendarMonths",
        ),
        "positiveExcessMonthsAtLeast2Of3": excess_positive
        >= require_int(
            gates.get("minimumPositiveExcessCalendarMonths"),
            "protocol.holdoutGates.minimumPositiveExcessCalendarMonths",
        ),
        "stressExcessTotalPositive": decimal_value(
            stress.get("excessTotalUsdPer1000"),
            "result.holdout.metrics.stress.excessTotalUsdPer1000",
        )
        > decimal_value(
            gates.get("stressExcessTotalUsdPer1000MustExceed"),
            "protocol.holdoutGates.stressExcessTotalUsdPer1000MustExceed",
        ),
        "stressNetTotalPositive": decimal_value(
            stress.get("totalUsdPer1000"),
            "result.holdout.metrics.stress.totalUsdPer1000",
        )
        > decimal_value(
            gates.get("stressNetTotalUsdPer1000MustExceed"),
            "protocol.holdoutGates.stressNetTotalUsdPer1000MustExceed",
        ),
    }
    if frozenset(expected) != HOLDOUT_GATE_KEYS:
        raise VerificationError("independent holdout gate implementation is incomplete")
    recorded = require_mapping(metrics.get("gates"), "result.holdout.metrics.gates")
    if recorded != expected:
        raise VerificationError("recorded holdout gates do not recompute")
    return expected


def canonical_sha(value: object) -> str:
    return digest(canonical_bytes(value))


def verify_candidate_chain(
    *,
    packet_names: frozenset[str],
    result: Mapping[str, object],
    development: Mapping[str, object] | None,
    decisions: Mapping[str, Mapping[str, bool]],
) -> tuple[dict[str, object] | None, dict[str, object] | None]:
    """Verify optional candidate/holdout receipts and their result bindings."""

    candidate: dict[str, object] | None = None
    holdout_open: dict[str, object] | None = None
    if CANDIDATE_NAME in packet_names:
        candidate, candidate_raw = json_file(CANDIDATE_NAME, canonical=True)
        if (
            candidate.get("schema") != "VG38CandidateSealV1"
            or candidate.get("state") != "CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN"
            or candidate.get("baseCommit") != BASE_COMMIT
            or candidate.get("freezeSha256") != digest(file_bytes("freeze.v1.json"))
            or candidate.get("sourceManifestSha256")
            != digest(file_bytes("source-manifest.v1.json"))
            or candidate.get("selectionRule") != SELECTION_RULE
        ):
            raise VerificationError("candidate seal schema, state, or digest binding mismatch")
        require_sha256(candidate.get("developmentRowsSha256"), "candidate.developmentRowsSha256")
        del candidate_raw
    if HOLDOUT_NAME in packet_names:
        if candidate is None:
            raise VerificationError("holdout receipt exists without a candidate seal")
        holdout_open, _holdout_raw = json_file(HOLDOUT_NAME, canonical=True)
        if (
            holdout_open.get("schema") != "VG38HoldoutOpenReceiptV1"
            or holdout_open.get("state") != "HOLDOUT_OPENED_ONCE"
            or holdout_open.get("reuseCount") != 1
            or holdout_open.get("candidateSealSha256") != digest(file_bytes(CANDIDATE_NAME))
        ):
            raise VerificationError(
                "holdout-open receipt schema, count, or candidate binding mismatch"
            )

    if candidate is not None:
        if development is None:
            if (
                require_mapping(result.get("holdout"), "result.holdout").get("candidateSealPresent")
                is not True
            ):
                raise VerificationError("UNMEASURED result omits its candidate seal")
        else:
            rows = require_sequence(
                development.get("candidateRows"),
                "result.development.candidateRows",
            )
            if candidate.get("developmentRowsSha256") != canonical_sha(rows):
                raise VerificationError("candidate seal does not bind development rows")
            champion_id = require_string(
                development.get("championTrialId"),
                "result.development.championTrialId",
            )
            sealed_trial = require_mapping(candidate.get("candidate"), "candidate.candidate")
            if sealed_trial.get("trialId") != champion_id:
                raise VerificationError("candidate seal and result champion differ")
            if champion_id not in decisions or not all(decisions[champion_id].values()):
                raise VerificationError("sealed development champion did not pass every gate")
            typed_rows = [require_mapping(row, "result.development.candidateRow") for row in rows]
            matching = [row for row in typed_rows if row.get("trial") == sealed_trial]
            if len(matching) != 1:
                raise VerificationError("candidate seal does not exactly match one trial row")
            passing_rows = [
                row
                for row in typed_rows
                if all(
                    decisions[
                        require_string(
                            require_mapping(
                                row.get("trial"),
                                "result.development.candidateRow.trial",
                            ).get("trialId"),
                            "result.development.candidateRow.trial.trialId",
                        )
                    ].values()
                )
            ]
            if not passing_rows:
                raise VerificationError("candidate exists without a development gate passer")

            def selection_key(row: Mapping[str, object]) -> tuple[object, ...]:
                trial = require_mapping(
                    row.get("trial"),
                    "result.development.candidateRow.trial",
                )
                inference = require_mapping(
                    row.get("inference"),
                    "result.development.candidateRow.inference",
                )
                excess = require_mapping(
                    inference.get("excessVsAlwaysOn"),
                    "result.development.candidateRow.inference.excessVsAlwaysOn",
                )
                absolute = require_mapping(
                    inference.get("absoluteBase"),
                    "result.development.candidateRow.inference.absoluteBase",
                )
                base = require_mapping(
                    row.get("base"),
                    "result.development.candidateRow.base",
                )
                return (
                    -decimal_value(
                        excess.get("oneSided95Lcb"),
                        "candidateRow.excess.oneSided95Lcb",
                    ),
                    -decimal_value(
                        absolute.get("oneSided95Lcb"),
                        "candidateRow.absolute.oneSided95Lcb",
                    ),
                    require_int(
                        base.get("transitionLegCount"),
                        "candidateRow.base.transitionLegCount",
                    ),
                    decimal_value(
                        trial.get("compressionThreshold"),
                        "candidateRow.trial.compressionThreshold",
                    ),
                    -require_int(
                        trial.get("baselineDays"),
                        "candidateRow.trial.baselineDays",
                    ),
                    -require_int(
                        trial.get("recentDays"),
                        "candidateRow.trial.recentDays",
                    ),
                    require_string(
                        trial.get("trialId"),
                        "candidateRow.trial.trialId",
                    ),
                )

            expected_champion = require_mapping(
                min(passing_rows, key=selection_key).get("trial"),
                "expectedChampion.trial",
            )
            if sealed_trial != expected_champion:
                raise VerificationError(
                    "sealed champion violates the frozen deterministic selection rule"
                )
            if canonical_sha(development.get("pbo")) != canonical_sha(candidate.get("pboGate")):
                raise VerificationError("candidate seal does not bind development PBO")

    if holdout_open is not None:
        if candidate is None:
            raise VerificationError("holdout receipt candidate is absent")
        sealed_trial = require_mapping(candidate.get("candidate"), "candidate.candidate")
        if holdout_open.get("sealedTrialId") != sealed_trial.get("trialId"):
            raise VerificationError("holdout-open trial differs from the sealed champion")
    return candidate, holdout_open


def verify_truth_boundary(result: Mapping[str, object]) -> None:
    require_exact_keys(result, RESULT_KEYS, "result")
    if (
        result.get("schema") != "VG38TerminalProfitabilityVerdictV1"
        or result.get("baseCommit") != BASE_COMMIT
        or result.get("capitalAuthority") != "NONE"
        or result.get("accountEffectiveFees") != ACCOUNT_FEE_TRUTH
        or result.get("capacityTruth") != CAPACITY_TRUTH
        or result.get("noSideEffects") != NO_SIDE_EFFECTS
        or result.get("boundaryPurge") != RESULT_BOUNDARY_PURGE
    ):
        raise VerificationError("result schema, base, fee, capacity, authority, or effects drift")
    costs = require_mapping(result.get("costScenarios"), "result.costScenarios")
    if costs.get("scope") != "PUBLIC_SCENARIOS_NOT_ACCOUNT_TRUTH":
        raise VerificationError("result presents public cost scenarios as account truth")
    universe = require_mapping(result.get("universeTruth"), "result.universeTruth")
    if universe.get("historicalWholeMarketMembership") != "UNMEASURED":
        raise VerificationError("result overstates historical universe truth")
    if result.get("sourceScope") != "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG38":
        raise VerificationError("result source scope mismatch")


def expected_measured_net_edge(
    metrics: Mapping[str, object],
    *,
    scope: str,
    trial_id: str,
) -> dict[str, object]:
    """Derive the public net-edge summary from already verified metrics."""

    base = require_mapping(metrics.get("base"), "netEdgeSource.base")
    inference = require_mapping(metrics.get("inference"), "netEdgeSource.inference")
    absolute = require_mapping(
        inference.get("absoluteBase"),
        "netEdgeSource.inference.absoluteBase",
    )
    excess = require_mapping(
        inference.get("excessVsAlwaysOn"),
        "netEdgeSource.inference.excessVsAlwaysOn",
    )
    return {
        "alwaysOnBenchmarkTotalUsdPer1000": base.get("alwaysOnBenchmarkTotalUsdPer1000"),
        "baseNetMeanDailyReturn": absolute.get("meanDailyReturn"),
        "baseNetOneSided95LcbDailyReturn": absolute.get("oneSided95Lcb"),
        "baseNetTotalUsdPer1000": base.get("totalUsdPer1000"),
        "excessVsAlwaysOnMeanDailyReturn": excess.get("meanDailyReturn"),
        "excessVsAlwaysOnOneSided95LcbDailyReturn": excess.get("oneSided95Lcb"),
        "excessVsAlwaysOnTotalUsdPer1000": base.get("excessTotalUsdPer1000"),
        "scope": scope,
        "trialId": trial_id,
    }


def verify_terminal_verdict(
    *,
    packet_names: frozenset[str],
    result: Mapping[str, object],
    protocol: Mapping[str, object],
) -> str:
    """Verify verdict state and independently recomputed GO/NO_GO laws."""

    verdict = require_mapping(result.get("verdict"), "result.verdict")
    status = require_string(verdict.get("status"), "result.verdict.status")
    if status not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VerificationError("result verdict is not closed")
    if verdict.get("consumer") != "N3_SUCCESSOR_ORCHESTRATOR_SCOREBOARD":
        raise VerificationError("result consumer mismatch")
    holdout = require_mapping(result.get("holdout"), "result.holdout")
    net_edge = require_mapping(result.get("netEdge"), "result.netEdge")
    require_exact_keys(net_edge, NET_EDGE_KEYS, "result.netEdge")
    development, decisions = verify_development(result, protocol)
    candidate, holdout_open = verify_candidate_chain(
        packet_names=packet_names,
        result=result,
        development=development,
        decisions=decisions,
    )
    holdout_state = holdout.get("state")

    if status == "UNMEASURED":
        if (
            development is not None
            or holdout.get("metrics") is not None
            or holdout_state not in {"UNOPENED_UNTOUCHED", "OPENED_INCOMPLETE"}
            or net_edge.get("scope") != "UNMEASURED"
            or net_edge.get("trialId") is not None
            or verdict.get("goScope") != "NONE"
            or any(
                net_edge.get(field) is not None
                for field in (
                    "alwaysOnBenchmarkTotalUsdPer1000",
                    "baseNetMeanDailyReturn",
                    "baseNetOneSided95LcbDailyReturn",
                    "baseNetTotalUsdPer1000",
                    "excessVsAlwaysOnMeanDailyReturn",
                    "excessVsAlwaysOnOneSided95LcbDailyReturn",
                    "excessVsAlwaysOnTotalUsdPer1000",
                )
            )
        ):
            raise VerificationError("UNMEASURED result contains measured outcome evidence")
        if (holdout_open is not None) != (holdout_state == "OPENED_INCOMPLETE"):
            raise VerificationError("UNMEASURED holdout state differs from its open receipt")
        if candidate is None and holdout.get("candidateSealPresent") is True:
            raise VerificationError("UNMEASURED result claims an absent candidate seal")
        return status

    if development is None or not decisions:
        raise VerificationError("measured verdict lacks development evidence")
    development_state = development.get("state")
    metrics_raw = holdout.get("metrics")

    if holdout_state == "UNOPENED_UNTOUCHED":
        if (
            status != "NO_GO"
            or development_state != "COMPLETE_NO_GATE_PASSER"
            or holdout.get("archiveBodiesOpened") is not False
            or holdout.get("reuseCount") != 0
            or metrics_raw is not None
            or candidate is not None
            or holdout_open is not None
            or any(all(gates.values()) for gates in decisions.values())
            or verdict.get("goScope") != "NONE"
            or verdict.get("reasons") != ["NO_PREDECLARED_TRIAL_CLEARED_ALL_DEVELOPMENT_GATES"]
        ):
            raise VerificationError("development NO_GO is malformed or has a hidden gate passer")
        reporting_id = require_string(
            development.get("reportingBestTrialId"),
            "result.development.reportingBestTrialId",
        )
        reporting_rows: list[dict[str, object]] = []
        for index, raw_row in enumerate(
            require_sequence(
                development.get("candidateRows"),
                "result.development.candidateRows",
            )
        ):
            row = require_mapping(
                raw_row,
                f"result.development.candidateRows[{index}]",
            )
            trial = require_mapping(
                row.get("trial"),
                f"result.development.candidateRows[{index}].trial",
            )
            if trial.get("trialId") == reporting_id:
                reporting_rows.append(row)
        if len(reporting_rows) != 1 or net_edge != expected_measured_net_edge(
            reporting_rows[0],
            scope="DEVELOPMENT_REPORTING_ONLY",
            trial_id=reporting_id,
        ):
            raise VerificationError(
                "development NO_GO net-edge values do not bind its reporting row"
            )
        return status

    if (
        holdout_state != "OPENED_ONCE_COMPLETE"
        or development_state != "COMPLETE_CHAMPION_SEALED"
        or holdout.get("archiveBodiesOpened") is not True
        or holdout.get("reuseCount") != 1
        or candidate is None
        or holdout_open is None
    ):
        raise VerificationError("opened measured verdict lacks the complete candidate chain")
    metrics = require_mapping(metrics_raw, "result.holdout.metrics")
    sealed_trial = require_mapping(candidate.get("candidate"), "candidate.candidate")
    if metrics.get("trial") != sealed_trial:
        raise VerificationError("holdout metrics trial differs from the sealed champion")
    holdout_gates = holdout_gate_decisions(metrics, protocol)
    all_holdout_passed = all(holdout_gates.values())
    if status == "GO":
        if (
            not all_holdout_passed
            or verdict.get("goScope") != "PUBLIC_RESEARCH_ONLY_NO_CAPITAL_AUTHORITY"
            or verdict.get("reasons") != ["ALL_PREDECLARED_HOLDOUT_GATES_PASSED"]
        ):
            raise VerificationError("GO does not satisfy every independently recomputed gate")
    elif (
        all_holdout_passed
        or verdict.get("goScope") != "NONE"
        or verdict.get("reasons") != ["ONE_OR_MORE_PREDECLARED_HOLDOUT_GATES_FAILED"]
    ):
        raise VerificationError("opened NO_GO lacks an independently recomputed failed gate")
    champion_id = require_string(
        development.get("championTrialId"),
        "result.development.championTrialId",
    )
    if net_edge != expected_measured_net_edge(
        metrics,
        scope="SEALED_HOLDOUT_PUBLIC_COST_SCENARIO",
        trial_id=champion_id,
    ):
        raise VerificationError("opened net-edge values differ from the sealed holdout metrics")
    return status


def verify_result_bindings(
    *,
    result: Mapping[str, object],
    protocol: Mapping[str, object],
    source: Mapping[str, object],
) -> None:
    if (
        result.get("protocolSha256") != digest(file_bytes("protocol.v1.json"))
        or result.get("sourceManifestSha256") != digest(file_bytes("source-manifest.v1.json"))
        or result.get("freezeSha256") != digest(file_bytes("freeze.v1.json"))
        or result.get("runMarkerSha256") != digest(file_bytes("run-marker.v1.json"))
    ):
        raise VerificationError("result protocol/source/freeze/marker byte binding mismatch")
    if source.get("protocolSha256") != result.get("protocolSha256"):
        raise VerificationError("result and source manifest disagree on protocol bytes")
    if protocol.get("baseCommit") != result.get("baseCommit"):
        raise VerificationError("result and protocol disagree on canonical base")


def verify() -> dict[str, object]:
    """Run the complete packet-only verification."""

    packet_names, checksums = parse_checksums()
    lineage = verify_git_lineage(packet_names)
    protocol, source, _freeze, _marker = verify_protocol_and_freeze(lineage=lineage)
    result, _result_raw = json_file("result.v1.json", canonical=True)
    verify_truth_boundary(result)
    verify_result_bindings(result=result, protocol=protocol, source=source)
    verdict = verify_terminal_verdict(
        packet_names=packet_names,
        result=result,
        protocol=protocol,
    )
    return {
        "branch": BRANCH_NAME,
        "head": lineage["head"],
        "packetFileCount": len(checksums),
        "resultSha256": checksums["result.v1.json"],
        "status": "PASS",
        "verdict": verdict,
    }


def main() -> int:
    try:
        report = verify()
    except (VerificationError, OSError, subprocess.CalledProcessError) as error:
        print(f"VG38_VERIFY_ERROR {error}", file=sys.stderr)
        return 1
    print(canonical_bytes(report).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
