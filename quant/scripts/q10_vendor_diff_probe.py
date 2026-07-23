"""Diagnose Q10 mint drift without changing the canonical three-file mint.

Usage:
    python scripts/q10_vendor_diff_probe.py LEFT_OUTPUT_ROOT RIGHT_OUTPUT_ROOT REPORT_PATH

The two roots must contain the exact Q10 campaign outputs:

- ``fixtures/q10_model_golden_v1.json``
- ``generated/q10/model_campaign.v1.json``
- ``generated/q10/model_campaign.v1.md``

The report contains paths and semantic context only. It deliberately omits
observed values and digests. Exit status 0 means byte-identical, 1 means only
recognized model-float candidate drift, and 2 means unexpected or invalid
drift. This diagnostic never replaces the existing byte-identity gate.
"""

from __future__ import annotations

import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import CanonicalJsonError

FIXTURE_PATH: Final = "fixtures/q10_model_golden_v1.json"
CAMPAIGN_PATH: Final = "generated/q10/model_campaign.v1.json"
MARKDOWN_PATH: Final = "generated/q10/model_campaign.v1.md"
ARTIFACT_PATHS: Final = (FIXTURE_PATH, CAMPAIGN_PATH, MARKDOWN_PATH)

CANDIDATE_LEAF_CLASSES: Final = (
    "PREDICTION_VECTOR_DIGEST",
    "REPORT_METRIC_MANTISSA",
    "STUDY_OBJECTIVE_MANTISSA",
)
CANDIDATE_FIELD_PATTERNS: Final = (
    "/battery/reports/*/results/*/metrics/*/value/mantissa",
    "/battery/reports/*/results/*/predictionsSha256",
    "/battery/studies/*/trials/*/objective/mantissa",
)
_EXPECTED_CAMPAIGN_POINTERS: Final = frozenset(("/batterySha256", "/fixtureSha256"))
_INTEGER_TEXT: Final = re.compile(r"(?:0|-?[1-9][0-9]*)\Z")
_SHA256_TEXT: Final = re.compile(r"[0-9a-f]{64}\Z")
_MISSING: Final = object()

PathPart = str | int
JsonPath = tuple[PathPart, ...]


@dataclass(frozen=True, slots=True)
class LeafDifference:
    path: JsonPath
    left: object
    right: object


def _json_pointer(path: JsonPath) -> str:
    """Return one RFC 6901 JSON Pointer; the empty tuple names the document."""

    if not path:
        return ""
    escaped = (str(part).replace("~", "~0").replace("/", "~1") for part in path)
    return "/" + "/".join(escaped)


def _leaf_differences(left: object, right: object, path: JsonPath = ()) -> list[LeafDifference]:
    if type(left) is not type(right):
        return [LeafDifference(path, left, right)]
    if isinstance(left, dict) and isinstance(right, dict):
        differences: list[LeafDifference] = []
        for key in sorted(set(left) | set(right)):
            left_value = left.get(key, _MISSING)
            right_value = right.get(key, _MISSING)
            if left_value is _MISSING or right_value is _MISSING:
                differences.append(LeafDifference((*path, key), left_value, right_value))
            else:
                differences.extend(_leaf_differences(left_value, right_value, (*path, key)))
        return differences
    if isinstance(left, list) and isinstance(right, list):
        differences = []
        shared_length = min(len(left), len(right))
        for index in range(shared_length):
            differences.extend(_leaf_differences(left[index], right[index], (*path, index)))
        for index in range(shared_length, max(len(left), len(right))):
            left_value = left[index] if index < len(left) else _MISSING
            right_value = right[index] if index < len(right) else _MISSING
            differences.append(LeafDifference((*path, index), left_value, right_value))
        return differences
    if left != right:
        return [LeafDifference(path, left, right)]
    return []


def _mapping_at(root: object, path: JsonPath) -> dict[str, object] | None:
    value = _value_at(root, path)
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        return None
    return value


def _list_at(root: object, path: JsonPath) -> list[object] | None:
    value = _value_at(root, path)
    return value if isinstance(value, list) else None


def _value_at(root: object, path: JsonPath) -> object:
    value = root
    for part in path:
        if isinstance(part, int):
            if not isinstance(value, list) or not 0 <= part < len(value):
                return _MISSING
            value = value[part]
        else:
            if not isinstance(value, dict) or part not in value:
                return _MISSING
            value = value[part]
    return value


def _context(
    *,
    metric_name: str | None = None,
    model_id: str | None = None,
    study_id: str | None = None,
    target_id: str | None = None,
    trial_index: int | None = None,
) -> dict[str, object]:
    return {
        "metricName": metric_name,
        "modelId": model_id,
        "studyId": study_id,
        "targetId": target_id,
        "trialIndex": trial_index,
    }


def _difference_row(
    *,
    artifact_path: str,
    kind: str,
    pointer: str,
    context: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "artifactPath": artifact_path,
        "context": _context() if context is None else context,
        "jsonPointer": pointer,
        "kind": kind,
    }


def _report_context(
    root: object,
    report_index: int,
    result_index: int,
    metric_index: int | None,
) -> dict[str, object] | None:
    reports = _list_at(root, ("battery", "reports"))
    if reports is None or not 0 <= report_index < len(reports):
        return None
    report = _mapping_at(reports[report_index], ())
    if report is None:
        return None
    results = report.get("results")
    if not isinstance(results, list) or not 0 <= result_index < len(results):
        return None
    result = _mapping_at(results[result_index], ())
    target_id = report.get("targetId")
    model_id = None if result is None else result.get("modelId")
    if not isinstance(target_id, str) or not isinstance(model_id, str):
        return None
    metric_name: str | None = None
    if metric_index is not None:
        metrics = None if result is None else result.get("metrics")
        if not isinstance(metrics, list) or not 0 <= metric_index < len(metrics):
            return None
        metric = _mapping_at(metrics[metric_index], ())
        candidate_name = None if metric is None else metric.get("name")
        if not isinstance(candidate_name, str):
            return None
        metric_name = candidate_name
    return _context(metric_name=metric_name, model_id=model_id, target_id=target_id)


def _study_context(
    root: object,
    study_index: int,
    trial_index: int,
) -> dict[str, object] | None:
    studies = _list_at(root, ("battery", "studies"))
    if studies is None or not 0 <= study_index < len(studies):
        return None
    study = _mapping_at(studies[study_index], ())
    spec = None if study is None else study.get("spec")
    trials = None if study is None else study.get("trials")
    if not isinstance(spec, dict) or not isinstance(trials, list):
        return None
    if not 0 <= trial_index < len(trials):
        return None
    trial = _mapping_at(trials[trial_index], ())
    study_id = spec.get("studyId")
    observed_trial_index = None if trial is None else trial.get("trialIndex")
    if not isinstance(study_id, str) or isinstance(observed_trial_index, bool):
        return None
    if not isinstance(observed_trial_index, int):
        return None
    return _context(study_id=study_id, trial_index=observed_trial_index)


def _is_integer_text_pair(difference: LeafDifference) -> bool:
    return (
        isinstance(difference.left, str)
        and isinstance(difference.right, str)
        and _INTEGER_TEXT.fullmatch(difference.left) is not None
        and _INTEGER_TEXT.fullmatch(difference.right) is not None
    )


def _is_sha256_pair(difference: LeafDifference) -> bool:
    return (
        isinstance(difference.left, str)
        and isinstance(difference.right, str)
        and _SHA256_TEXT.fullmatch(difference.left) is not None
        and _SHA256_TEXT.fullmatch(difference.right) is not None
    )


def _classify_fixture_difference(
    difference: LeafDifference,
    left_fixture: dict[str, object],
    right_fixture: dict[str, object],
) -> dict[str, object] | None:
    path = difference.path
    match path:
        case (
            "battery",
            "reports",
            int() as report_index,
            "results",
            int() as result_index,
            "metrics",
            int() as metric_index,
            "value",
            "mantissa",
        ):
            if not _is_integer_text_pair(difference):
                return None
            left_context = _report_context(left_fixture, report_index, result_index, metric_index)
            right_context = _report_context(right_fixture, report_index, result_index, metric_index)
            if left_context is None or left_context != right_context:
                return None
            return _difference_row(
                artifact_path=FIXTURE_PATH,
                kind="REPORT_METRIC_MANTISSA",
                pointer=_json_pointer(path),
                context=left_context,
            )
        case (
            "battery",
            "reports",
            int() as report_index,
            "results",
            int() as result_index,
            "predictionsSha256",
        ):
            if not _is_sha256_pair(difference):
                return None
            left_context = _report_context(left_fixture, report_index, result_index, None)
            right_context = _report_context(right_fixture, report_index, result_index, None)
            if left_context is None or left_context != right_context:
                return None
            return _difference_row(
                artifact_path=FIXTURE_PATH,
                kind="PREDICTION_VECTOR_DIGEST",
                pointer=_json_pointer(path),
                context=left_context,
            )
        case (
            "battery",
            "studies",
            int() as study_index,
            "trials",
            int() as trial_index,
            "objective",
            "mantissa",
        ):
            if not _is_integer_text_pair(difference):
                return None
            left_context = _study_context(left_fixture, study_index, trial_index)
            right_context = _study_context(right_fixture, study_index, trial_index)
            if left_context is None or left_context != right_context:
                return None
            return _difference_row(
                artifact_path=FIXTURE_PATH,
                kind="STUDY_OBJECTIVE_MANTISSA",
                pointer=_json_pointer(path),
                context=left_context,
            )
    return None


def _classify_campaign_difference(
    difference: LeafDifference,
) -> dict[str, object] | None:
    pointer = _json_pointer(difference.path)
    if pointer not in _EXPECTED_CAMPAIGN_POINTERS or not _is_sha256_pair(difference):
        return None
    return _difference_row(
        artifact_path=CAMPAIGN_PATH,
        kind="DERIVED_CAMPAIGN_DIGEST",
        pointer=pointer,
    )


def _expected_campaign_projections(fixture: dict[str, object]) -> dict[str, object] | None:
    battery = fixture.get("battery")
    reports = _list_at(fixture, ("battery", "reports"))
    studies = _list_at(fixture, ("battery", "studies"))
    if not isinstance(battery, dict) or reports is None or studies is None:
        return None

    winners: dict[str, str] = {}
    losses: list[dict[str, object]] = []
    for report in reports:
        if not isinstance(report, dict):
            return None
        target_id = report.get("targetId")
        primary_metric = report.get("primaryMetric")
        winner_model_id = report.get("winnerModelId")
        results = report.get("results")
        if (
            not isinstance(target_id, str)
            or not isinstance(primary_metric, str)
            or not isinstance(winner_model_id, str)
            or not isinstance(results, list)
        ):
            return None
        winners[target_id] = winner_model_id
        winner_rows = [
            item
            for item in results
            if isinstance(item, dict) and item.get("modelId") == winner_model_id
        ]
        if len(winner_rows) != 1:
            return None
        winner_role = winner_rows[0].get("role")
        if not isinstance(winner_role, str):
            return None
        losing = sorted(
            model_id
            for item in results
            if isinstance(item, dict)
            and item.get("role") == "BOOSTED_CHALLENGER"
            and isinstance(model_id := item.get("modelId"), str)
        )
        if winner_role != "BOOSTED_CHALLENGER" and losing:
            losses.append(
                {
                    "losingChallengers": losing,
                    "primaryMetric": primary_metric,
                    "targetId": target_id,
                    "winnerModelId": winner_model_id,
                    "winnerRole": winner_role,
                }
            )

    summaries: list[dict[str, object]] = []
    for study in studies:
        if not isinstance(study, dict):
            return None
        spec = study.get("spec")
        trials = study.get("trials")
        best_trial_index = study.get("bestTrialIndex")
        if (
            not isinstance(spec, dict)
            or not isinstance(trials, list)
            or (
                best_trial_index is not None
                and (isinstance(best_trial_index, bool) or not isinstance(best_trial_index, int))
            )
        ):
            return None
        study_id = spec.get("studyId")
        requested = spec.get("nTrials")
        if (
            not isinstance(study_id, str)
            or isinstance(requested, bool)
            or not isinstance(requested, int)
        ):
            return None
        summaries.append(
            {
                "bestTrialIndex": best_trial_index,
                "completeTrials": sum(
                    1
                    for trial in trials
                    if isinstance(trial, dict) and trial.get("state") == "COMPLETE"
                ),
                "loggedTrials": len(trials),
                "requestedTrials": requested,
                "studyId": study_id,
            }
        )
    seed = battery.get("seed")
    if not isinstance(seed, str):
        return None
    return {
        "evidencePosture": "SYNTHETIC_ONLY",
        "honestChallengerLosses": losses,
        "seed": seed,
        "studySummaries": summaries,
        "winnersByTarget": winners,
    }


def _campaign_binding_differences(
    fixture_raw: bytes,
    fixture: dict[str, object],
    campaign: dict[str, object],
) -> list[dict[str, object]]:
    battery = fixture.get("battery")
    if not isinstance(battery, dict):
        return [
            _difference_row(
                artifact_path=CAMPAIGN_PATH,
                kind="INVALID_DERIVED_CAMPAIGN_BINDING",
                pointer="/batterySha256",
            )
        ]
    expected: dict[str, object] = {
        "/batterySha256": hashlib.sha256(canonical_json_bytes(battery)).hexdigest(),
        "/fixtureSha256": hashlib.sha256(fixture_raw).hexdigest(),
    }
    projections = _expected_campaign_projections(fixture)
    if projections is None:
        return [
            _difference_row(
                artifact_path=CAMPAIGN_PATH,
                kind="INVALID_DERIVED_CAMPAIGN_BINDING",
                pointer="",
            )
        ]
    expected.update({f"/{key}": value for key, value in projections.items()})
    return [
        _difference_row(
            artifact_path=CAMPAIGN_PATH,
            kind="INVALID_DERIVED_CAMPAIGN_BINDING",
            pointer=pointer,
        )
        for pointer, digest in expected.items()
        if campaign.get(pointer[1:]) != digest
    ]


def _fixture_binding_differences(
    fixture: dict[str, object],
) -> list[dict[str, object]]:
    battery = fixture.get("battery")
    if not isinstance(battery, dict) or not isinstance(battery.get("dispositions"), list):
        return [
            _difference_row(
                artifact_path=FIXTURE_PATH,
                kind="INVALID_FIXTURE_BINDING",
                pointer="/battery/dispositionsSha256",
            )
        ]
    expected = hashlib.sha256(canonical_json_bytes(battery["dispositions"])).hexdigest()
    if battery.get("dispositionsSha256") == expected:
        return []
    return [
        _difference_row(
            artifact_path=FIXTURE_PATH,
            kind="INVALID_FIXTURE_BINDING",
            pointer="/battery/dispositionsSha256",
        )
    ]


def _primary_result_row(
    fixture: dict[str, object],
    *,
    model_id: str,
    primary_metric: str,
    target_id: str,
) -> str | None:
    reports = _list_at(fixture, ("battery", "reports"))
    if reports is None:
        return None
    matching_reports = [
        item
        for item in reports
        if isinstance(item, dict)
        and item.get("targetId") == target_id
        and item.get("primaryMetric") == primary_metric
    ]
    if len(matching_reports) != 1:
        return None
    report = matching_reports[0]
    results = report.get("results")
    if not isinstance(results, list):
        return None
    matching_results = [
        item for item in results if isinstance(item, dict) and item.get("modelId") == model_id
    ]
    if len(matching_results) != 1:
        return None
    result = matching_results[0]
    role = result.get("role")
    metrics = result.get("metrics")
    winner_model_id = report.get("winnerModelId")
    if not isinstance(role, str) or not isinstance(metrics, list):
        return None
    matching_metrics = [
        item for item in metrics if isinstance(item, dict) and item.get("name") == primary_metric
    ]
    if len(matching_metrics) != 1:
        return None
    value = matching_metrics[0].get("value")
    if not isinstance(value, dict) or value.get("scale") != "1000000000000":
        return None
    mantissa_text = value.get("mantissa")
    if not isinstance(mantissa_text, str) or _INTEGER_TEXT.fullmatch(mantissa_text) is None:
        return None
    mantissa = int(mantissa_text)
    sign = "-" if mantissa < 0 else ""
    magnitude = abs(mantissa)
    decimal = f"{sign}{magnitude // 10**12}.{magnitude % 10**12:012d}"
    marker = "**yes**" if model_id == winner_model_id else "—"
    return f"| `{model_id}` | {role} | {decimal} | {marker} |\n"


def _expected_markdown(
    fixture: dict[str, object],
    campaign: dict[str, object],
) -> bytes | None:
    reports = _list_at(fixture, ("battery", "reports"))
    dispositions = _list_at(fixture, ("battery", "dispositions"))
    losses = campaign.get("honestChallengerLosses")
    summaries = campaign.get("studySummaries")
    seed = campaign.get("seed")
    battery_digest = campaign.get("batterySha256")
    fixture_digest = campaign.get("fixtureSha256")
    if (
        reports is None
        or dispositions is None
        or not isinstance(losses, list)
        or not isinstance(summaries, list)
        or not isinstance(seed, str)
        or not isinstance(battery_digest, str)
        or not isinstance(fixture_digest, str)
    ):
        return None

    lines = [
        "# Q10 model battery campaign (synthetic only)",
        "",
        f"- Seed: `{seed}`",
        f"- Battery SHA-256: `{battery_digest}`",
        f"- Golden fixture SHA-256: `{fixture_digest}`",
        (
            "- Model-output serialization: `12` significant decimal digits "
            "(`z.12g`) before fixed-point and digest publication."
        ),
        "- Evidence posture: SYNTHETIC_ONLY — planted machinery truth, never market truth;",
        "  no model here is predictive, validated or economically valuable.",
        "",
        "## Comparison reports",
        "",
    ]
    for report in reports:
        if not isinstance(report, dict):
            return None
        target_id = report.get("targetId")
        primary_metric = report.get("primaryMetric")
        results = report.get("results")
        if (
            not isinstance(target_id, str)
            or not isinstance(primary_metric, str)
            or not isinstance(results, list)
        ):
            return None
        lines.extend(
            [
                f"### `{target_id}` — primary `{primary_metric}`",
                "",
                "| Model | Role | Primary value | Winner |",
                "| --- | --- | --- | --- |",
            ]
        )
        for result in results:
            if not isinstance(result, dict) or not isinstance(result.get("modelId"), str):
                return None
            row = _primary_result_row(
                fixture,
                model_id=result["modelId"],
                primary_metric=primary_metric,
                target_id=target_id,
            )
            if row is None:
                return None
            lines.append(row.removesuffix("\n"))
        lines.append("")

    lines.extend(["## Honest challenger losses", ""])
    if losses:
        for loss in losses:
            if not isinstance(loss, dict):
                return None
            target_id = loss.get("targetId")
            winner_model_id = loss.get("winnerModelId")
            winner_role = loss.get("winnerRole")
            losing = loss.get("losingChallengers")
            if (
                not isinstance(target_id, str)
                or not isinstance(winner_model_id, str)
                or not isinstance(winner_role, str)
                or not isinstance(losing, list)
                or not all(isinstance(item, str) for item in losing)
            ):
                return None
            challengers = ", ".join(f"`{name}`" for name in losing)
            lines.append(
                f"- `{target_id}`: winner `{winner_model_id}` ({winner_role}); "
                f"losing boosted challengers: {challengers}"
            )
    else:
        lines.append("- none on this seed; the law preserves losses whenever they occur")

    lines.extend(["", "## Bounded studies (all trials logged)", ""])
    lines.append("| Study | Requested | Logged | Complete | Best trial |")
    lines.append("| --- | --- | --- | --- | --- |")
    for summary in summaries:
        if not isinstance(summary, dict):
            return None
        study_id = summary.get("studyId")
        values = (
            summary.get("requestedTrials"),
            summary.get("loggedTrials"),
            summary.get("completeTrials"),
        )
        best_trial_index = summary.get("bestTrialIndex")
        if (
            not isinstance(study_id, str)
            or any(isinstance(item, bool) or not isinstance(item, int) for item in values)
            or (
                best_trial_index is not None
                and (isinstance(best_trial_index, bool) or not isinstance(best_trial_index, int))
            )
        ):
            return None
        lines.append(
            f"| `{study_id}` | {values[0]} | {values[1]} | {values[2]} | {best_trial_index} |"
        )

    lines.extend(["", "## Section 14 dispositions", ""])
    lines.append("| Bullet | Disposition | Implemented ids |")
    lines.append("| --- | --- | --- |")
    for disposition in dispositions:
        if not isinstance(disposition, dict):
            return None
        bullet_id = disposition.get("bulletId")
        disposition_value = disposition.get("disposition")
        implemented_ids = disposition.get("implementedIds")
        if (
            not isinstance(bullet_id, str)
            or not isinstance(disposition_value, str)
            or not isinstance(implemented_ids, list)
            or not all(isinstance(item, str) for item in implemented_ids)
        ):
            return None
        lines.append(f"| {bullet_id} | {disposition_value} | {', '.join(implemented_ids) or '—'} |")
    lines.append("")
    return "\n".join(lines).encode("utf-8")


def _markdown_drift_is_derived(
    *,
    left_fixture: dict[str, object],
    right_fixture: dict[str, object],
    left_campaign: dict[str, object],
    right_campaign: dict[str, object],
    left_markdown: bytes,
    right_markdown: bytes,
) -> bool:
    return left_markdown == _expected_markdown(
        left_fixture, left_campaign
    ) and right_markdown == _expected_markdown(right_fixture, right_campaign)


def _unexpected_row(artifact_path: str, difference: LeafDifference, kind: str) -> dict[str, object]:
    return _difference_row(
        artifact_path=artifact_path,
        kind=kind,
        pointer=_json_pointer(difference.path),
    )


def _row_key(row: dict[str, object]) -> tuple[str, str, str]:
    return (
        str(row["artifactPath"]),
        str(row["jsonPointer"]),
        str(row["kind"]),
    )


def _require_artifact_identity(
    artifact: dict[str, object],
    *,
    schema: str,
) -> None:
    if (
        artifact.get("schema") != schema
        or type(artifact.get("version")) is not int
        or artifact["version"] != 1
    ):
        raise ValueError("Q10 vendor probe input identity is invalid")
    if schema == "Q10ModelGoldenFixtureV1":
        if set(artifact) != {"battery", "schema", "version"}:
            raise ValueError("Q10 vendor probe fixture shape is invalid")
        battery = artifact.get("battery")
        expected_battery_keys = {
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
        }
        if (
            not isinstance(battery, dict)
            or set(battery) != expected_battery_keys
            or battery.get("schema") != "Q10BatteryResultV1"
            or type(battery.get("version")) is not int
            or battery["version"] != 1
        ):
            raise ValueError("Q10 vendor probe battery shape is invalid")
        _require_candidate_shape(artifact)
        return

    expected_campaign_keys = {
        "batterySha256",
        "evidencePosture",
        "fixtureSha256",
        "honestChallengerLosses",
        "schema",
        "seed",
        "studySummaries",
        "version",
        "winnersByTarget",
    }
    if set(artifact) != expected_campaign_keys:
        raise ValueError("Q10 vendor probe campaign shape is invalid")
    for key in ("batterySha256", "fixtureSha256"):
        value = artifact.get(key)
        if not isinstance(value, str) or _SHA256_TEXT.fullmatch(value) is None:
            raise ValueError("Q10 vendor probe campaign digest is invalid")
    if (
        artifact.get("evidencePosture") != "SYNTHETIC_ONLY"
        or not isinstance(artifact.get("seed"), str)
        or not isinstance(artifact.get("honestChallengerLosses"), list)
        or not isinstance(artifact.get("studySummaries"), list)
        or not isinstance(artifact.get("winnersByTarget"), dict)
    ):
        raise ValueError("Q10 vendor probe campaign contract is invalid")


def _require_candidate_shape(fixture: dict[str, object]) -> None:
    reports = _list_at(fixture, ("battery", "reports"))
    studies = _list_at(fixture, ("battery", "studies"))
    if not reports or not studies:
        raise ValueError("Q10 vendor probe candidate collections are invalid")
    for report in reports:
        if not isinstance(report, dict):
            raise ValueError("Q10 vendor probe report shape is invalid")
        if not all(
            isinstance(report.get(key), str)
            for key in ("primaryMetric", "targetId", "winnerModelId")
        ):
            raise ValueError("Q10 vendor probe report identity is invalid")
        results = report.get("results")
        if not isinstance(results, list) or not results:
            raise ValueError("Q10 vendor probe results are invalid")
        for result in results:
            if not isinstance(result, dict) or not isinstance(result.get("modelId"), str):
                raise ValueError("Q10 vendor probe result identity is invalid")
            prediction_digest = result.get("predictionsSha256")
            metrics = result.get("metrics")
            if (
                not isinstance(prediction_digest, str)
                or _SHA256_TEXT.fullmatch(prediction_digest) is None
                or not isinstance(metrics, list)
                or not metrics
            ):
                raise ValueError("Q10 vendor probe result shape is invalid")
            for metric in metrics:
                if not isinstance(metric, dict) or not isinstance(metric.get("name"), str):
                    raise ValueError("Q10 vendor probe metric identity is invalid")
                _require_fixed_point(metric.get("value"))
    for study in studies:
        if not isinstance(study, dict):
            raise ValueError("Q10 vendor probe study shape is invalid")
        spec = study.get("spec")
        trials = study.get("trials")
        if (
            not isinstance(spec, dict)
            or not isinstance(spec.get("studyId"), str)
            or not isinstance(trials, list)
            or not trials
        ):
            raise ValueError("Q10 vendor probe study identity is invalid")
        for trial in trials:
            if (
                not isinstance(trial, dict)
                or isinstance(trial.get("trialIndex"), bool)
                or not isinstance(trial.get("trialIndex"), int)
            ):
                raise ValueError("Q10 vendor probe trial identity is invalid")
            objective = trial.get("objective")
            if objective is not None:
                _require_fixed_point(objective)


def _require_fixed_point(value: object) -> None:
    if not isinstance(value, dict) or value.get("scale") != "1000000000000":
        raise ValueError("Q10 vendor probe fixed-point shape is invalid")
    mantissa = value.get("mantissa")
    if not isinstance(mantissa, str) or _INTEGER_TEXT.fullmatch(mantissa) is None:
        raise ValueError("Q10 vendor probe fixed-point mantissa is invalid")


def build_probe(left_root: Path, right_root: Path) -> tuple[dict[str, object], int]:
    """Compare two Q10 output roots and build one value-free canonical report."""

    left_fixture_raw = (left_root / FIXTURE_PATH).read_bytes()
    right_fixture_raw = (right_root / FIXTURE_PATH).read_bytes()
    left_campaign_raw = (left_root / CAMPAIGN_PATH).read_bytes()
    right_campaign_raw = (right_root / CAMPAIGN_PATH).read_bytes()
    left_markdown = (left_root / MARKDOWN_PATH).read_bytes()
    right_markdown = (right_root / MARKDOWN_PATH).read_bytes()

    left_fixture = parse_canonical_object(left_fixture_raw)
    right_fixture = parse_canonical_object(right_fixture_raw)
    left_campaign = parse_canonical_object(left_campaign_raw)
    right_campaign = parse_canonical_object(right_campaign_raw)
    _require_artifact_identity(left_fixture, schema="Q10ModelGoldenFixtureV1")
    _require_artifact_identity(right_fixture, schema="Q10ModelGoldenFixtureV1")
    _require_artifact_identity(left_campaign, schema="Q10ModelCampaignV1")
    _require_artifact_identity(right_campaign, schema="Q10ModelCampaignV1")

    candidate_differences: list[dict[str, object]] = []
    unexpected_differences: list[dict[str, object]] = []
    for difference in _leaf_differences(left_fixture, right_fixture):
        classified = _classify_fixture_difference(difference, left_fixture, right_fixture)
        if classified is None:
            unexpected_differences.append(
                _unexpected_row(FIXTURE_PATH, difference, "UNEXPECTED_FIXTURE_DRIFT")
            )
        else:
            candidate_differences.append(classified)

    derived_differences: list[dict[str, object]] = []
    campaign_differences = _leaf_differences(left_campaign, right_campaign)
    for difference in campaign_differences:
        classified = _classify_campaign_difference(difference)
        if classified is None:
            unexpected_differences.append(
                _unexpected_row(CAMPAIGN_PATH, difference, "UNEXPECTED_CAMPAIGN_DRIFT")
            )
        else:
            derived_differences.append(classified)
    unexpected_differences.extend(
        _campaign_binding_differences(left_fixture_raw, left_fixture, left_campaign)
    )
    unexpected_differences.extend(
        _campaign_binding_differences(right_fixture_raw, right_fixture, right_campaign)
    )
    unexpected_differences.extend(_fixture_binding_differences(left_fixture))
    unexpected_differences.extend(_fixture_binding_differences(right_fixture))
    if left_markdown != _expected_markdown(
        left_fixture, left_campaign
    ) or right_markdown != _expected_markdown(right_fixture, right_campaign):
        unexpected_differences.append(
            _difference_row(
                artifact_path=MARKDOWN_PATH,
                kind="INVALID_MARKDOWN_BINDING",
                pointer="",
            )
        )

    fixture_candidate_drift = bool(candidate_differences)
    campaign_pointers = {
        str(row["jsonPointer"])
        for row in derived_differences
        if row["kind"] == "DERIVED_CAMPAIGN_DIGEST"
    }
    markdown_changed = left_markdown != right_markdown

    if fixture_candidate_drift:
        for missing_pointer in sorted(_EXPECTED_CAMPAIGN_POINTERS - campaign_pointers):
            unexpected_differences.append(
                _difference_row(
                    artifact_path=CAMPAIGN_PATH,
                    kind="UNREFRESHED_DERIVED_CAMPAIGN",
                    pointer=missing_pointer,
                )
            )
        if markdown_changed and _markdown_drift_is_derived(
            left_fixture=left_fixture,
            right_fixture=right_fixture,
            left_campaign=left_campaign,
            right_campaign=right_campaign,
            left_markdown=left_markdown,
            right_markdown=right_markdown,
        ):
            derived_differences.append(
                _difference_row(
                    artifact_path=MARKDOWN_PATH,
                    kind="DERIVED_MARKDOWN_DRIFT",
                    pointer="",
                )
            )
        elif markdown_changed:
            unexpected_differences.append(
                _difference_row(
                    artifact_path=MARKDOWN_PATH,
                    kind="UNEXPECTED_MARKDOWN_DRIFT",
                    pointer="",
                )
            )
        else:
            unexpected_differences.append(
                _difference_row(
                    artifact_path=MARKDOWN_PATH,
                    kind="UNREFRESHED_DERIVED_MARKDOWN",
                    pointer="",
                )
            )
    else:
        if derived_differences:
            unexpected_differences.extend(
                {
                    **row,
                    "kind": "UNBOUND_DERIVED_CAMPAIGN_DRIFT",
                }
                for row in derived_differences
            )
            derived_differences = []
        if markdown_changed:
            unexpected_differences.append(
                _difference_row(
                    artifact_path=MARKDOWN_PATH,
                    kind="UNBOUND_DERIVED_MARKDOWN_DRIFT",
                    pointer="",
                )
            )

    candidate_differences.sort(key=_row_key)
    derived_differences.sort(key=_row_key)
    unexpected_differences = list({_row_key(row): row for row in unexpected_differences}.values())
    unexpected_differences.sort(key=_row_key)

    artifact_bytes = (
        (FIXTURE_PATH, left_fixture_raw, right_fixture_raw),
        (CAMPAIGN_PATH, left_campaign_raw, right_campaign_raw),
        (MARKDOWN_PATH, left_markdown, right_markdown),
    )
    artifacts = [
        {
            "path": path,
            "state": "MATCH" if left == right else "CHANGED",
        }
        for path, left, right in artifact_bytes
    ]

    if unexpected_differences:
        status = "NON_CANDIDATE_DRIFT"
        exit_status = 2
    elif candidate_differences or derived_differences:
        status = "CANDIDATE_FLOAT_DRIFT"
        exit_status = 1
    else:
        status = "BYTE_IDENTICAL"
        exit_status = 0

    report: dict[str, object] = {
        "artifacts": artifacts,
        "candidateDifferences": candidate_differences,
        "candidateFieldPatterns": list(CANDIDATE_FIELD_PATTERNS),
        "candidateLeafClasses": list(CANDIDATE_LEAF_CLASSES),
        "derivedDifferences": derived_differences,
        "schema": "Q10VendorDiffProbeV1",
        "status": status,
        "summary": {
            "candidateDifferenceCount": len(candidate_differences),
            "derivedDifferenceCount": len(derived_differences),
            "unexpectedDifferenceCount": len(unexpected_differences),
        },
        "unexpectedDifferences": unexpected_differences,
        "version": 1,
    }
    return report, exit_status


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(
            "usage: q10_vendor_diff_probe.py LEFT_OUTPUT_ROOT RIGHT_OUTPUT_ROOT REPORT_PATH",
            file=sys.stderr,
        )
        return 2
    left_root = Path(argv[1])
    right_root = Path(argv[2])
    report_path = Path(argv[3])
    try:
        resolved_report = report_path.resolve()
        input_paths = {
            (root / artifact_path).resolve()
            for root in (left_root, right_root)
            for artifact_path in ARTIFACT_PATHS
        }
        if resolved_report in input_paths:
            raise ValueError("Q10 vendor probe report path aliases an input")
        report, exit_status = build_probe(left_root, right_root)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_bytes(canonical_json_bytes(report))
    except (CanonicalJsonError, OSError, ValueError) as error:
        print(f"q10 vendor probe failed: {type(error).__name__}", file=sys.stderr)
        return 2
    return exit_status


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
