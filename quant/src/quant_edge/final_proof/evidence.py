"""Fail-closed projection of accepted Q-lane research evidence.

The projector deliberately does not evaluate models or reinterpret validation output.
It verifies an exact allowlist of immutable evidence bytes, checks the narrow semantic
claims used by Q17, and emits a JSON-safe projection whose conclusion remains advisory.
"""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object, require_exact_keys
from quant_edge.errors import ContractValueError, QuantEdgeError


class EvidenceVerificationError(QuantEdgeError):
    """Accepted evidence bytes, semantics, or projection failed closed."""


@dataclass(frozen=True, slots=True)
class _ArtifactSpec:
    artifact_id: str
    relative_path: str
    sha256: str
    byte_length: int
    media_type: str
    schema_name: str | None
    schema_version: int | None
    top_level_keys: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class _PostAcceptanceCorrectionSpec:
    phase: str
    correction_id: str
    current_artifact_ids: tuple[str, ...]
    historical_accepted_artifacts: tuple[_ArtifactSpec, ...]


_ARTIFACTS: Final[tuple[_ArtifactSpec, ...]] = (
    _ArtifactSpec(
        "q10.implementation-receipt.v1",
        "quant/RECEIPTS/Q10.md",
        "d9261dbdc5cb141e529b2978182563acd4754a2c0003b43236f23a58d7c89f37",
        14_945,
        "text/markdown",
        None,
        None,
        None,
    ),
    _ArtifactSpec(
        "q10.model-campaign.v1",
        "quant/generated/q10/model_campaign.v1.json",
        "38167324fd83977ddfc55e256540acb9080e7ac1e9efd47536c73f2a4476b3f1",
        1_135,
        "application/json",
        "Q10ModelCampaignV1",
        1,
        (
            "batterySha256",
            "evidencePosture",
            "fixtureSha256",
            "honestChallengerLosses",
            "schema",
            "seed",
            "studySummaries",
            "version",
            "winnersByTarget",
        ),
    ),
    _ArtifactSpec(
        "q10.model-golden.v1",
        "quant/fixtures/q10_model_golden_v1.json",
        "fa8b5dd28dc6753ae410296730bb21f09a1c19c3bb76785bc84b01944907fcbf",
        38_697,
        "application/json",
        "Q10ModelGoldenFixtureV1",
        1,
        ("battery", "schema", "version"),
    ),
    _ArtifactSpec(
        "q12.ensemble-campaign.v1",
        "quant/generated/q12/ensemble_campaign.v1.json",
        "3230b579cf7d8262761591209bad5dbc024214a3cd5c5fd22fff82e72c3f9863",
        2_376,
        "application/json",
        "Q12EnsembleCampaignV1",
        1,
        (
            "abstentionActions",
            "closureDigest",
            "coverageStatus",
            "evidencePosture",
            "fixtureSha256",
            "q10WaitingQ14Closed",
            "schema",
            "seed",
            "selectedCalibration",
            "specialistWeights",
            "stackTrainingBrier",
            "validation",
            "version",
        ),
    ),
    _ArtifactSpec(
        "q12.ensemble-golden.v1",
        "quant/fixtures/q12_ensemble_golden_v1.json",
        "28d657a80b4c0328529c62e6dccf8631c2cb3574cc399ff27108b192677a942e",
        153_683,
        "application/json",
        "Q12EnsembleGoldenFixtureV1",
        1,
        (
            "adaptive",
            "calibration",
            "chronology",
            "closure",
            "conformal",
            "decisions",
            "evidencePosture",
            "matrixDigest",
            "plan",
            "schema",
            "seed",
            "stack",
            "validationSummary",
            "version",
        ),
    ),
    _ArtifactSpec(
        "q13.data-sufficiency.v1",
        "quant/generated/q13/data_sufficiency.v1.json",
        "126e27674a99f18accfc21638cbb5bdb1d1bda0f563a03284a7e4ad75665365d",
        1_813,
        "application/json",
        "Q13DeepDataSufficiencyReportV1",
        None,
        ("evidence", "findings", "schema", "status", "trainingPermitted"),
    ),
    _ArtifactSpec(
        "q14.validation-campaign.v1",
        "quant/generated/q14/validation_campaign.v1.json",
        "a0522034a97c2676d4af31c7b22c10412ebb06a115df4de72f307081b23d9f87",
        2_322,
        "application/json",
        "Q14ValidationCampaignV1",
        1,
        (
            "battery",
            "batteryDatasets",
            "behavioralRejections",
            "comparisonVerdict",
            "goldenFixtureSha256",
            "honestAccepted",
            "schema",
            "seed",
            "stressFlipsFeeSlippage",
            "stressFlipsLatency",
            "temporalRejections",
            "version",
        ),
    ),
    _ArtifactSpec(
        "q14.validation-golden.v1",
        "quant/generated/q14/q14_validation_golden_v1.json",
        "539c95b264333208dfd37c96856be32bd130b41907560558a38bd323e53b20c9",
        16_525,
        "application/json",
        "Q14ValidationGoldenFixtureV1",
        1,
        (
            "bootstrapInterval",
            "comparison",
            "datasetDigest",
            "deflatedSharpe",
            "forgedAssessment",
            "honestAssessment",
            "leakedAssessment",
            "multipleTesting",
            "pbo",
            "plan",
            "schema",
            "seed",
            "stress",
            "trialLedger",
            "version",
        ),
    ),
    _ArtifactSpec(
        "q15.registry-campaign.v1",
        "quant/generated/q15/registry_campaign.v1.json",
        "8f82c0bd951417c70634daae9410768335dfc16394d16938f7b0080739f66d88",
        4_425,
        "application/json",
        "Q15RegistryCampaignV1",
        1,
        (
            "artifactManifestSha256",
            "challengerSelfPromotedByDrift",
            "delayedFeedback",
            "driftAlarm",
            "feedbackSha256",
            "feedbackState",
            "finalChampion",
            "initialChampion",
            "lifecycles",
            "q14IdentityMismatchRejected",
            "schema",
            "shadowBatch",
            "shadowBatchSha256",
            "shadowComparison",
            "shadowComparisonSha256",
            "shadowEvaluationCounts",
            "transitionCount",
            "version",
        ),
    ),
    _ArtifactSpec(
        "q15.registry-cards.v1",
        "quant/generated/q15/registry_cards.v1.json",
        "f1c2d508680691328c9ae8fb4b2663ace69c2d0032d35d884fab5a859b886a08",
        16_676,
        "application/json",
        "Q15RegistryCardsV1",
        1,
        (
            "artifactManifest",
            "datasetCards",
            "experimentCard",
            "modelCards",
            "registrations",
            "schema",
            "version",
        ),
    ),
)

_POST_ACCEPTANCE_CORRECTIONS: Final[tuple[_PostAcceptanceCorrectionSpec, ...]] = (
    _PostAcceptanceCorrectionSpec(
        phase="Q12",
        correction_id="Q12_RESEARCH_INTEGRITY_LINEAGE_CORRECTION",
        current_artifact_ids=("q12.ensemble-campaign.v1", "q12.ensemble-golden.v1"),
        historical_accepted_artifacts=(
            _ArtifactSpec(
                "q12.ensemble-campaign.v1",
                "quant/generated/q12/ensemble_campaign.v1.json",
                "ad9d9b1f6ba9ffe3fc59450075f5221792f6c900403775f6820e2da763c28bb2",
                2_376,
                "application/json",
                "Q12EnsembleCampaignV1",
                1,
                None,
            ),
            _ArtifactSpec(
                "q12.ensemble-golden.v1",
                "quant/fixtures/q12_ensemble_golden_v1.json",
                "88382d291f6d0ddb4443888df80ce1d03bc893790ca746d13237b23b58d2bb77",
                153_049,
                "application/json",
                "Q12EnsembleGoldenFixtureV1",
                1,
                None,
            ),
        ),
    ),
    _PostAcceptanceCorrectionSpec(
        phase="Q15",
        correction_id="Q15_RESEARCH_INTEGRITY_EVALUATION_UNIT_CORRECTION",
        current_artifact_ids=("q15.registry-campaign.v1", "q15.registry-cards.v1"),
        historical_accepted_artifacts=(
            _ArtifactSpec(
                "q15.registry-campaign.v1",
                "quant/generated/q15/registry_campaign.v1.json",
                "24debb2a96b91338d937b67878c75be2ef38615880c9c0ad8cd30590ac0bd11b",
                4_322,
                "application/json",
                "Q15RegistryCampaignV1",
                1,
                None,
            ),
            _ArtifactSpec(
                "q15.registry-cards.v1",
                "quant/generated/q15/registry_cards.v1.json",
                "0457f22f9b713955f654d99b7dcfe9795d84c71c7ec8baf5a927e007d5a08fb5",
                16_676,
                "application/json",
                "Q15RegistryCardsV1",
                1,
                None,
            ),
        ),
    ),
)

_CLASSIFICATIONS: Final = frozenset(
    {"SYNTHETIC", "REFERENCE_ONLY", "DATA_INSUFFICIENT", "REJECTED", "UNKNOWN"}
)


def _require_root(repo_root: Path) -> tuple[Path, os.stat_result]:
    if not isinstance(repo_root, Path) or not repo_root.is_absolute():
        raise ContractValueError("repo_root must be an absolute pathlib.Path")
    try:
        before = repo_root.lstat()
        resolved = repo_root.resolve(strict=True)
    except OSError as error:
        raise EvidenceVerificationError("repo_root is absent") from error
    if not stat.S_ISDIR(before.st_mode) or repo_root.is_symlink() or resolved != repo_root:
        raise EvidenceVerificationError("repo_root must be an exact real non-symlink directory")
    return resolved, before


def _checked_parts(relative_path: str) -> tuple[str, ...]:
    if not isinstance(relative_path, str) or not relative_path:
        raise EvidenceVerificationError("evidence path is not an exact relative POSIX path")
    parsed = PurePosixPath(relative_path)
    raw_parts = relative_path.split("/")
    if (
        parsed.is_absolute()
        or not parsed.parts
        or any(part in ("", ".", "..") for part in raw_parts)
        or "\\" in relative_path
        or "://" in relative_path
    ):
        raise EvidenceVerificationError("evidence path is not an exact relative POSIX path")
    return parsed.parts


def _descriptor_flags(*, directory: bool) -> int:
    nonblocking = getattr(os, "O_NONBLOCK", None)
    if not isinstance(nonblocking, int):
        raise EvidenceVerificationError("platform lacks non-blocking descriptor opens")
    flags = os.O_RDONLY | nonblocking | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    if directory:
        flags |= getattr(os, "O_DIRECTORY", 0)
    return flags


def _file_snapshot(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev,
        info.st_ino,
        stat.S_IFMT(info.st_mode),
        info.st_nlink,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def _read_exact_artifact(
    repo_root: Path,
    root_before: os.stat_result,
    spec: _ArtifactSpec,
) -> bytes:
    parts = _checked_parts(spec.relative_path)
    candidate = repo_root.joinpath(*parts)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise EvidenceVerificationError(f"evidence {spec.artifact_id} is absent") from error
    if not resolved.is_relative_to(repo_root) or resolved != candidate:
        raise EvidenceVerificationError(f"evidence {spec.artifact_id} escapes or uses a link")

    directory_flags = _descriptor_flags(directory=True)
    file_flags = _descriptor_flags(directory=False)
    try:
        root_fd = os.open(repo_root, directory_flags)
    except OSError as error:
        raise EvidenceVerificationError("repo_root cannot be opened safely") from error
    directory_fds = [root_fd]
    directory_edges: list[tuple[int, str, int]] = []
    descriptor = -1
    try:
        opened_root = os.fstat(root_fd)
        if (opened_root.st_dev, opened_root.st_ino) != (
            root_before.st_dev,
            root_before.st_ino,
        ):
            raise EvidenceVerificationError("repo_root changed while opening")
        for part in parts[:-1]:
            next_fd = -1
            try:
                next_fd = os.open(part, directory_flags, dir_fd=directory_fds[-1])
                linked_parent = os.stat(part, dir_fd=directory_fds[-1], follow_symlinks=False)
                opened_parent = os.fstat(next_fd)
            except OSError as error:
                if next_fd >= 0:
                    os.close(next_fd)
                raise EvidenceVerificationError(
                    "evidence parent path is absent or unsafe"
                ) from error
            if not stat.S_ISDIR(linked_parent.st_mode) or (
                linked_parent.st_dev,
                linked_parent.st_ino,
            ) != (opened_parent.st_dev, opened_parent.st_ino):
                os.close(next_fd)
                raise EvidenceVerificationError("evidence parent path changed while opening")
            directory_edges.append((directory_fds[-1], part, next_fd))
            directory_fds.append(next_fd)
        leaf_parent_fd = directory_fds[-1]
        try:
            entry_before = os.stat(parts[-1], dir_fd=leaf_parent_fd, follow_symlinks=False)
            descriptor = os.open(
                parts[-1],
                file_flags,
                dir_fd=leaf_parent_fd,
            )
            before = os.fstat(descriptor)
            entry_after_open = os.stat(
                parts[-1],
                dir_fd=leaf_parent_fd,
                follow_symlinks=False,
            )
        except OSError as error:
            raise EvidenceVerificationError("evidence file cannot be opened safely") from error
        if not (
            stat.S_ISREG(entry_before.st_mode)
            and stat.S_ISREG(before.st_mode)
            and stat.S_ISREG(entry_after_open.st_mode)
            and before.st_nlink == 1
            and _file_snapshot(entry_before) == _file_snapshot(before)
            and _file_snapshot(before) == _file_snapshot(entry_after_open)
        ):
            raise EvidenceVerificationError(
                "evidence must be one identity-stable regular non-symlink file"
            )
        if before.st_size != spec.byte_length:
            raise EvidenceVerificationError(f"evidence {spec.artifact_id} size is not accepted")
        chunks: list[bytes] = []
        remaining = spec.byte_length + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        try:
            linked_after = os.stat(
                parts[-1],
                dir_fd=leaf_parent_fd,
                follow_symlinks=False,
            )
        except OSError as error:
            raise EvidenceVerificationError(
                "evidence path changed during its bounded read"
            ) from error
        for parent_fd, part, child_fd in directory_edges:
            try:
                linked_parent = os.stat(part, dir_fd=parent_fd, follow_symlinks=False)
                opened_parent = os.fstat(child_fd)
            except OSError as error:
                raise EvidenceVerificationError(
                    "evidence parent path changed during its bounded read"
                ) from error
            if not stat.S_ISDIR(linked_parent.st_mode) or (
                linked_parent.st_dev,
                linked_parent.st_ino,
            ) != (opened_parent.st_dev, opened_parent.st_ino):
                raise EvidenceVerificationError(
                    "evidence parent path changed during its bounded read"
                )
        if (
            len(raw) != spec.byte_length
            or after.st_nlink != 1
            or _file_snapshot(before) != _file_snapshot(after)
            or _file_snapshot(after) != _file_snapshot(linked_after)
        ):
            raise EvidenceVerificationError("evidence changed during its bounded read")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        for directory_fd in reversed(directory_fds):
            os.close(directory_fd)

    try:
        root_after = repo_root.lstat()
    except OSError as error:
        raise EvidenceVerificationError("repo_root disappeared during verification") from error
    if (root_before.st_dev, root_before.st_ino) != (root_after.st_dev, root_after.st_ino):
        raise EvidenceVerificationError("repo_root changed during verification")
    if hashlib.sha256(raw).hexdigest() != spec.sha256:
        raise EvidenceVerificationError(f"evidence {spec.artifact_id} digest is not accepted")
    return raw


def _require_mapping(value: object, *, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise EvidenceVerificationError(f"{path} must be an object")
    if any(not isinstance(key, str) for key in value):
        raise EvidenceVerificationError(f"{path} keys must be text")
    return cast(dict[str, object], value)


def _require_list(value: object, *, path: str) -> list[object]:
    if not isinstance(value, list):
        raise EvidenceVerificationError(f"{path} must be an array")
    return cast(list[object], value)


def _expect(value: object, expected: object, *, path: str) -> None:
    if type(value) is not type(expected) or value != expected:
        raise EvidenceVerificationError(f"{path} is not the accepted semantic value")


def _exact_keys(value: dict[str, object], expected: tuple[str, ...], *, path: str) -> None:
    try:
        require_exact_keys(value, expected=expected, path=path)
    except QuantEdgeError as error:
        raise EvidenceVerificationError(f"{path} fields are not schema exact") from error


def _dispositions_by_id(golden: dict[str, object]) -> dict[str, dict[str, object]]:
    battery = _require_mapping(golden.get("battery"), path="q10.$.battery")
    rows = _require_list(battery.get("dispositions"), path="q10.$.battery.dispositions")
    result: dict[str, dict[str, object]] = {}
    for index, row in enumerate(rows):
        mapping = _require_mapping(row, path=f"q10.$.battery.dispositions[{index}]")
        bullet_id = mapping.get("bulletId")
        if not isinstance(bullet_id, str) or bullet_id in result:
            raise EvidenceVerificationError("Q10 disposition identity is absent or duplicated")
        result[bullet_id] = mapping
    return result


def _validate_q10(values: dict[str, dict[str, object]], receipt_raw: bytes) -> None:
    campaign = values["q10.model-campaign.v1"]
    golden = values["q10.model-golden.v1"]
    _expect(campaign.get("evidencePosture"), "SYNTHETIC_ONLY", path="q10.campaign.posture")
    _expect(campaign.get("seed"), "20260712", path="q10.campaign.seed")
    _expect(
        campaign.get("fixtureSha256"),
        "fa8b5dd28dc6753ae410296730bb21f09a1c19c3bb76785bc84b01944907fcbf",
        path="q10.campaign.fixtureSha256",
    )
    _expect(
        campaign.get("winnersByTarget"),
        {
            "attention_rank:v1": "xgb_ranker:v1",
            "net_edge_quantiles:v1": "xgb_quantile_tuned:v1",
            "net_edge_regression:v1": "ols:v1",
            "transition_binary:v1": "xgb_classifier:v1",
        },
        path="q10.campaign.winnersByTarget",
    )
    _expect(
        campaign.get("honestChallengerLosses"),
        [
            {
                "losingChallengers": ["xgb_regressor:v1", "xgb_regressor_tuned:v1"],
                "primaryMetric": "mse",
                "targetId": "net_edge_regression:v1",
                "winnerModelId": "ols:v1",
                "winnerRole": "TRANSPARENT_BASELINE",
            }
        ],
        path="q10.campaign.honestChallengerLosses",
    )
    summaries = _require_list(campaign.get("studySummaries"), path="q10.studySummaries")
    observed_indices: dict[str, int] = {}
    for index, row in enumerate(summaries):
        mapping = _require_mapping(row, path=f"q10.studySummaries[{index}]")
        _exact_keys(
            mapping,
            ("bestTrialIndex", "completeTrials", "loggedTrials", "requestedTrials", "studyId"),
            path=f"q10.studySummaries[{index}]",
        )
        study_id = mapping.get("studyId")
        best = mapping.get("bestTrialIndex")
        if not isinstance(study_id, str) or type(best) is not int or study_id in observed_indices:
            raise EvidenceVerificationError("Q10 study summary identity is ambiguous")
        _expect(mapping.get("completeTrials"), 12, path=f"q10.studySummaries[{index}].complete")
        _expect(mapping.get("loggedTrials"), 12, path=f"q10.studySummaries[{index}].logged")
        _expect(mapping.get("requestedTrials"), 12, path=f"q10.studySummaries[{index}].requested")
        observed_indices[study_id] = best
    _expect(
        observed_indices,
        {
            "study_xgb_classifier:v1": 4,
            "study_xgb_quantile:v1": 7,
            "study_xgb_ranker:v1": 0,
            "study_xgb_regressor:v1": 10,
        },
        path="q10.studySummaries.bestTrialIndices",
    )

    battery = _require_mapping(golden.get("battery"), path="q10.golden.battery")
    _exact_keys(
        battery,
        (
            "dataset",
            "dispositions",
            "dispositionsSha256",
            "frameworks",
            "reports",
            "schema",
            "seed",
            "split",
            "studies",
            "version",
        ),
        path="q10.golden.battery",
    )
    _expect(battery.get("schema"), "Q10BatteryResultV1", path="q10.golden.battery.schema")
    golden_studies = _require_list(battery.get("studies"), path="q10.golden.battery.studies")
    golden_indices: dict[str, int] = {}
    for index, row in enumerate(golden_studies):
        study = _require_mapping(row, path=f"q10.golden.battery.studies[{index}]")
        study_spec = _require_mapping(
            study.get("spec"), path=f"q10.golden.battery.studies[{index}].spec"
        )
        study_id = study_spec.get("studyId")
        best = study.get("bestTrialIndex")
        if not isinstance(study_id, str) or type(best) is not int or study_id in golden_indices:
            raise EvidenceVerificationError("Q10 golden study identity is ambiguous")
        golden_indices[study_id] = best
    _expect(golden_indices, observed_indices, path="q10.golden.bestTrialIndices")
    dataset = _require_mapping(battery.get("dataset"), path="q10.golden.battery.dataset")
    _expect(dataset.get("posture"), "SYNTHETIC", path="q10.golden.dataset.posture")
    split = _require_mapping(battery.get("split"), path="q10.golden.battery.split")
    _expect(
        split.get("authority"),
        "BATTERY_INTERNAL_NON_AUTHORITATIVE",
        path="q10.golden.split.authority",
    )
    dispositions = _dispositions_by_id(golden)
    for bullet_id in ("14.1-04-gam-spline", "14.3-02-lightgbm", "14.3-03-catboost"):
        row = dispositions.get(bullet_id)
        if row is None:
            raise EvidenceVerificationError(f"Q10 disposition {bullet_id} is absent")
        _expect(row.get("disposition"), "REFERENCE_ONLY", path=f"q10.{bullet_id}")
    receipt = receipt_raw.decode("utf-8", errors="strict")
    stale_line = (
        "- Studies: 4 \u00d7 12/12 trials logged, all `COMPLETE`; best trial indices 4 "
        "(classifier), 11 (quantile), 0 (ranker), 10 (regressor)."
    )
    if stale_line not in receipt.splitlines():
        raise EvidenceVerificationError("Q10 documentary erratum source line is absent")


def _validate_q12(values: dict[str, dict[str, object]]) -> None:
    campaign = values["q12.ensemble-campaign.v1"]
    golden = values["q12.ensemble-golden.v1"]
    _expect(campaign.get("evidencePosture"), "SYNTHETIC_ONLY", path="q12.campaign.posture")
    _expect(campaign.get("selectedCalibration"), "PLATT_CHRONOLOGICAL", path="q12.calibration")
    _expect(campaign.get("coverageStatus"), "AVAILABLE", path="q12.coverage")
    _expect(campaign.get("q10WaitingQ14Closed"), 5, path="q12.q10Closure")
    actions = _require_mapping(campaign.get("abstentionActions"), path="q12.actions")
    for scenario in ("conflicting", "costNegative", "costUnknown", "ood", "stale"):
        _expect(actions.get(scenario), "ABSTAIN_UNKNOWN", path=f"q12.actions.{scenario}")
    _expect(actions.get("healthy"), "WATCH", path="q12.actions.healthy")
    _expect(golden.get("evidencePosture"), "SYNTHETIC_ONLY", path="q12.golden.posture")
    calibration = _require_mapping(golden.get("calibration"), path="q12.golden.calibration")
    _expect(
        calibration.get("chosenMethod"),
        "PLATT_CHRONOLOGICAL",
        path="q12.golden.calibration.method",
    )
    conformal = _require_mapping(golden.get("conformal"), path="q12.golden.conformal")
    coverage = _require_mapping(conformal.get("coverage"), path="q12.golden.coverage")
    _expect(coverage.get("status"), "AVAILABLE", path="q12.golden.coverage.status")


def _validate_q13(values: dict[str, dict[str, object]]) -> None:
    report = values["q13.data-sufficiency.v1"]
    _expect(report.get("status"), "FAIL_DATA_INSUFFICIENT", path="q13.status")
    _expect(report.get("trainingPermitted"), False, path="q13.trainingPermitted")
    evidence = _require_mapping(report.get("evidence"), path="q13.evidence")
    _expect(
        evidence.get("schema"),
        "Q13DeepDataSufficiencyEvidenceV1",
        path="q13.evidence.schema",
    )
    facts = _require_mapping(evidence.get("facts"), path="q13.evidence.facts")
    _expect(facts.get("MEASURED_COMPUTE_BUDGET"), None, path="q13.computeBudget")
    for key in (
        "COMPLETE_HISTORICAL_L2",
        "INDEPENDENT_EVENTS_REGIMES",
        "REALISTIC_COST_ACTIONABILITY",
        "SAME_COHORT_SIMPLE_BASELINE",
        "STABLE_POINT_IN_TIME_LABELS",
        "UNTOUCHED_CHRONOLOGICAL_HOLDOUT",
    ):
        _expect(facts.get(key), False, path=f"q13.evidence.facts.{key}")


def _validate_q14(values: dict[str, dict[str, object]]) -> None:
    campaign = values["q14.validation-campaign.v1"]
    golden = values["q14.validation-golden.v1"]
    for key in ("batteryDatasets", "behavioralRejections", "honestAccepted", "temporalRejections"):
        _expect(campaign.get(key), 8, path=f"q14.campaign.{key}")
    _expect(campaign.get("comparisonVerdict"), "IMPROVES", path="q14.comparisonVerdict")
    _expect(campaign.get("stressFlipsFeeSlippage"), 62, path="q14.stress.feeSlippage")
    _expect(campaign.get("stressFlipsLatency"), 62, path="q14.stress.latency")
    battery = _require_list(campaign.get("battery"), path="q14.campaign.battery")
    for index, row in enumerate(battery):
        item = _require_mapping(row, path=f"q14.campaign.battery[{index}]")
        _expect(item.get("datasetId"), f"q14-battery-{index:02d}", path="q14.datasetId")
        _expect(
            item.get("honestVerdict"),
            "ACCEPTED_FOR_COMPARISON",
            path="q14.honestVerdict",
        )
        _expect(
            item.get("temporalVerdict"),
            "REJECTED_TEMPORAL_LEAK",
            path="q14.temporalVerdict",
        )
        _expect(
            item.get("behavioralVerdict"),
            "REJECTED_IMPLAUSIBLE_SKILL",
            path="q14.behavioralVerdict",
        )
    comparison = _require_mapping(golden.get("comparison"), path="q14.golden.comparison")
    _expect(comparison.get("verdict"), "IMPROVES", path="q14.golden.comparison.verdict")
    grant = _require_mapping(comparison.get("holdoutGrant"), path="q14.golden.holdoutGrant")
    _expect(grant.get("grantId"), "grant-golden-final", path="q14.golden.holdoutGrant.id")
    honest = _require_mapping(golden.get("honestAssessment"), path="q14.golden.honest")
    leaked = _require_mapping(golden.get("leakedAssessment"), path="q14.golden.leaked")
    forged = _require_mapping(golden.get("forgedAssessment"), path="q14.golden.forged")
    _expect(honest.get("verdict"), "ACCEPTED_FOR_COMPARISON", path="q14.golden.honest")
    _expect(leaked.get("verdict"), "REJECTED_TEMPORAL_LEAK", path="q14.golden.leaked")
    _expect(forged.get("verdict"), "REJECTED_IMPLAUSIBLE_SKILL", path="q14.golden.forged")


def _validate_q15(values: dict[str, dict[str, object]]) -> None:
    campaign = values["q15.registry-campaign.v1"]
    cards = values["q15.registry-cards.v1"]
    evaluation_counts = _require_mapping(
        campaign.get("shadowEvaluationCounts"), path="q15.shadowEvaluationCounts"
    )
    _exact_keys(
        evaluation_counts,
        ("distinctEventCount", "evaluationUnitCount", "slotId"),
        path="q15.shadowEvaluationCounts",
    )
    _expect(
        evaluation_counts,
        {"distinctEventCount": 1, "evaluationUnitCount": 1, "slotId": "transition-binary"},
        path="q15.shadowEvaluationCounts",
    )
    champion = _require_mapping(campaign.get("finalChampion"), path="q15.finalChampion")
    _expect(champion.get("modelId"), "logistic:v1", path="q15.finalChampion.modelId")
    _expect(champion.get("modelRevision"), "q10.golden.v1", path="q15.finalChampion.revision")
    _expect(champion.get("posture"), "ABSTAIN_UNKNOWN", path="q15.finalChampion.posture")
    model_cards = _require_list(cards.get("modelCards"), path="q15.modelCards")
    matches = [
        _require_mapping(row, path=f"q15.modelCards[{index}]")
        for index, row in enumerate(model_cards)
        if isinstance(row, dict) and row.get("modelId") == "logistic:v1"
    ]
    if len(matches) != 1:
        raise EvidenceVerificationError("Q15 champion model card identity is ambiguous")
    card = matches[0]
    _expect(card.get("posture"), "SYNTHETIC_ONLY", path="q15.championCard.posture")
    _expect(card.get("loadableModelPayload"), False, path="q15.championCard.loadable")


def _artifact_row(spec: _ArtifactSpec) -> dict[str, object]:
    return {
        "artifactId": spec.artifact_id,
        "byteLength": spec.byte_length,
        "mediaType": spec.media_type,
        "relativePath": spec.relative_path,
        "schemaName": spec.schema_name,
        "schemaVersion": spec.schema_version,
        "sha256": spec.sha256,
    }


def _artifact_rows() -> list[dict[str, object]]:
    return [_artifact_row(spec) for spec in _ARTIFACTS]


def _post_acceptance_correction_rows() -> list[dict[str, object]]:
    current_by_id = {spec.artifact_id: spec for spec in _ARTIFACTS}
    rows: list[dict[str, object]] = []
    for correction in _POST_ACCEPTANCE_CORRECTIONS:
        try:
            current = [
                current_by_id[artifact_id] for artifact_id in correction.current_artifact_ids
            ]
        except KeyError as error:
            raise EvidenceVerificationError(
                "post-acceptance correction references unavailable current evidence"
            ) from error
        historical_ids = tuple(
            spec.artifact_id for spec in correction.historical_accepted_artifacts
        )
        if historical_ids != correction.current_artifact_ids:
            raise EvidenceVerificationError(
                "post-acceptance correction historical and current identities differ"
            )
        rows.append(
            {
                "acceptanceState": "NOT_ACCEPTED",
                "correctionId": correction.correction_id,
                "currentArtifacts": [_artifact_row(spec) for spec in current],
                "historicalAcceptedArtifacts": [
                    _artifact_row(spec) for spec in correction.historical_accepted_artifacts
                ],
                "historicalReceipts": "DOES_NOT_ATTEST_CORRECTED_BYTES",
                "implementationCommit": "PENDING_NOT_EMBEDDED",
                "implementationState": ("CORRECTION_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION"),
                "implementationTree": "PENDING_NOT_EMBEDDED",
                "phase": correction.phase,
                "verificationState": "PENDING_INDEPENDENT_EXACT_COMMIT_VERIFICATION",
            }
        )
    return rows


def _expected_projection() -> dict[str, object]:
    return {
        "artifacts": _artifact_rows(),
        "axes": {
            "evidence": "SYNTHETIC_ONLY",
            "implementation": "BUILT_AND_TESTED",
            "productIntegration": "NOT_CONFIGURED",
        },
        "claims": [
            {
                "claimId": "q10.transparent-baselines-and-challengers",
                "classification": "SYNTHETIC",
                "sourceArtifactIds": ["q10.model-campaign.v1", "q10.model-golden.v1"],
                "status": "MACHINERY_RESULT_ONLY",
            },
            {
                "claimId": "q10.framework-ablation-candidates",
                "classification": "REFERENCE_ONLY",
                "sourceArtifactIds": ["q10.model-golden.v1"],
                "status": "GAM_LIGHTGBM_CATBOOST_NOT_IMPLEMENTED",
            },
            {
                "claimId": "q10.real-evidence-ablation",
                "classification": "DATA_INSUFFICIENT",
                "sourceArtifactIds": ["q10.model-golden.v1"],
                "status": "UNAVAILABLE_REAL_EVIDENCE",
            },
            {
                "artifactBestTrialIndex": 7,
                "claimId": "q10.quantile-best-trial-documentary-erratum",
                "classification": "UNKNOWN",
                "documentaryBestTrialIndex": 11,
                "resolution": "MACHINE_ARTIFACT_AUTHORITATIVE",
                "sourceArtifactIds": [
                    "q10.implementation-receipt.v1",
                    "q10.model-campaign.v1",
                    "q10.model-golden.v1",
                ],
                "status": "DOCUMENTARY_ERRATUM",
            },
            {
                "claimId": "q12.calibration-and-uncertainty",
                "classification": "SYNTHETIC",
                "sourceArtifactIds": ["q12.ensemble-campaign.v1", "q12.ensemble-golden.v1"],
                "status": "SYNTHETIC_ONLY",
            },
            {
                "claimId": "q12.post-acceptance-correction",
                "classification": "UNKNOWN",
                "sourceArtifactIds": ["q12.ensemble-campaign.v1", "q12.ensemble-golden.v1"],
                "status": "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED",
            },
            {
                "claimId": "q13.deep-data-gate",
                "classification": "DATA_INSUFFICIENT",
                "sourceArtifactIds": ["q13.data-sufficiency.v1"],
                "status": "FAIL_DATA_INSUFFICIENT",
            },
            {
                "claimId": "q13.measured-compute-budget",
                "classification": "UNKNOWN",
                "sourceArtifactIds": ["q13.data-sufficiency.v1"],
                "status": "UNKNOWN",
            },
            {
                "claimId": "q14.synthetic-validation-factory",
                "classification": "SYNTHETIC",
                "sourceArtifactIds": ["q14.validation-campaign.v1", "q14.validation-golden.v1"],
                "status": "Q14_FIXTURE_COMPARISON_ONLY_NOT_Q10_OR_Q11_VALIDATION",
            },
            {
                "claimId": "q14.leakage-negative-controls",
                "classification": "REJECTED",
                "sourceArtifactIds": ["q14.validation-campaign.v1", "q14.validation-golden.v1"],
                "status": "TEMPORAL_AND_IMPLAUSIBLE_SKILL_REJECTED",
            },
            {
                "claimId": "q15.synthetic-registry-mechanism",
                "classification": "SYNTHETIC",
                "sourceArtifactIds": ["q15.registry-campaign.v1", "q15.registry-cards.v1"],
                "status": "SYNTHETIC_ONLY",
            },
            {
                "claimId": "q15.post-acceptance-correction",
                "classification": "UNKNOWN",
                "sourceArtifactIds": ["q15.registry-campaign.v1", "q15.registry-cards.v1"],
                "status": "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED",
            },
            {
                "claimId": "q15.champion-inference-readiness",
                "classification": "REJECTED",
                "sourceArtifactIds": ["q15.registry-campaign.v1", "q15.registry-cards.v1"],
                "status": "UNAVAILABLE_NONLOADABLE",
            },
        ],
        "conclusion": {
            "actionability": "ABSTAIN_UNKNOWN",
            "advisoryOnly": True,
            "edgeClaim": "NOT_ESTABLISHED",
            "executionAuthority": False,
            "overallClassification": "DATA_INSUFFICIENT",
        },
        "postAcceptanceCorrections": _post_acceptance_correction_rows(),
        "schema": "Q17AcceptedResearchEvidenceV1",
        "version": 1,
    }


def validate_research_evidence_projection(value: object) -> dict[str, object]:
    """Validate the exact Q17 evidence projection and return a shallow-safe copy."""

    if type(value) is not dict:
        raise EvidenceVerificationError("research evidence projection must be a plain object")
    mapping = cast(dict[str, object], value)
    try:
        observed_bytes = canonical_json_bytes(mapping)
    except (QuantEdgeError, RecursionError) as error:
        raise EvidenceVerificationError("research evidence projection is not JSON-safe") from error
    _exact_keys(
        mapping,
        (
            "artifacts",
            "axes",
            "claims",
            "conclusion",
            "postAcceptanceCorrections",
            "schema",
            "version",
        ),
        path="$",
    )
    claims = _require_list(mapping.get("claims"), path="$.claims")
    for index, row in enumerate(claims):
        claim = _require_mapping(row, path=f"$.claims[{index}]")
        classification = claim.get("classification")
        if classification not in _CLASSIFICATIONS:
            raise EvidenceVerificationError("research evidence classification is not allowlisted")
    corrections = _require_list(
        mapping.get("postAcceptanceCorrections"), path="$.postAcceptanceCorrections"
    )
    for index, row in enumerate(corrections):
        correction = _require_mapping(row, path=f"$.postAcceptanceCorrections[{index}]")
        _expect(
            correction.get("acceptanceState"),
            "NOT_ACCEPTED",
            path=f"$.postAcceptanceCorrections[{index}].acceptanceState",
        )
        _expect(
            correction.get("historicalReceipts"),
            "DOES_NOT_ATTEST_CORRECTED_BYTES",
            path=f"$.postAcceptanceCorrections[{index}].historicalReceipts",
        )
    expected = _expected_projection()
    if observed_bytes != canonical_json_bytes(expected):
        raise EvidenceVerificationError("research evidence projection differs from accepted truth")
    return _expected_projection()


def project_research_evidence(repo_root: Path) -> dict[str, object]:
    """Verify accepted evidence at ``repo_root`` and project fail-closed Q17 truth."""

    resolved_root, root_before = _require_root(repo_root)
    values: dict[str, dict[str, object]] = {}
    receipt_raw = b""
    for spec in _ARTIFACTS:
        raw = _read_exact_artifact(resolved_root, root_before, spec)
        if spec.media_type == "text/markdown":
            receipt_raw = raw
            continue
        try:
            value = parse_canonical_object(raw)
            if spec.top_level_keys is None or spec.schema_name is None:
                raise EvidenceVerificationError("JSON evidence spec is incomplete")
            _exact_keys(value, spec.top_level_keys, path=f"{spec.artifact_id}.$")
        except QuantEdgeError as error:
            raise EvidenceVerificationError(
                f"evidence {spec.artifact_id} is not canonical schema-exact JSON"
            ) from error
        _expect(value.get("schema"), spec.schema_name, path=f"{spec.artifact_id}.schema")
        if spec.schema_version is not None:
            _expect(value.get("version"), spec.schema_version, path=f"{spec.artifact_id}.version")
        values[spec.artifact_id] = value
    if not receipt_raw:
        raise EvidenceVerificationError("Q10 documentary evidence is absent")
    _validate_q10(values, receipt_raw)
    _validate_q12(values)
    _validate_q13(values)
    _validate_q14(values)
    _validate_q15(values)
    return validate_research_evidence_projection(_expected_projection())


__all__ = [
    "EvidenceVerificationError",
    "project_research_evidence",
    "validate_research_evidence_projection",
]
