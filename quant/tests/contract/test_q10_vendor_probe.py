from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path
from typing import cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object

QUANT_ROOT = Path(__file__).resolve().parents[2]
PROBE_SCRIPT = QUANT_ROOT / "scripts" / "q10_vendor_diff_probe.py"
FIXTURE_PATH = Path("fixtures/q10_model_golden_v1.json")
CAMPAIGN_PATH = Path("generated/q10/model_campaign.v1.json")
MARKDOWN_PATH = Path("generated/q10/model_campaign.v1.md")


def _fixture(
    *,
    metric_mantissa: str,
    objective_mantissa: str,
    prediction_digest: str,
    winner_model_id: str = "model:v1",
) -> dict[str, object]:
    return {
        "battery": {
            "dataset": {},
            "dispositions": [],
            "dispositionsSha256": hashlib.sha256(canonical_json_bytes([])).hexdigest(),
            "frameworks": {},
            "reports": [
                {
                    "primaryMetric": "loss",
                    "results": [
                        {
                            "metrics": [
                                {
                                    "derivation": "EXACT",
                                    "direction": "LOWER_IS_BETTER",
                                    "name": "loss",
                                    "value": {
                                        "mantissa": metric_mantissa,
                                        "scale": "1000000000000",
                                    },
                                }
                            ],
                            "modelId": "model:v1",
                            "params": [],
                            "predictionsSha256": prediction_digest,
                            "role": "CONTROL",
                            "targetId": "target:v1",
                        }
                    ],
                    "targetId": "target:v1",
                    "targetKind": "REGRESSION",
                    "winnerModelId": winner_model_id,
                }
            ],
            "schema": "Q10BatteryResultV1",
            "seed": "1",
            "split": {},
            "studies": [
                {
                    "bestTrialIndex": 0,
                    "paramSpace": [],
                    "spec": {
                        "direction": "LOWER_IS_BETTER",
                        "nTrials": 1,
                        "objectiveMetric": "loss",
                        "samplerSeed": "1",
                        "studyId": "study:v1",
                    },
                    "trials": [
                        {
                            "failureReason": None,
                            "objective": {
                                "mantissa": objective_mantissa,
                                "scale": "1000000000000",
                            },
                            "params": [],
                            "state": "COMPLETE",
                            "trialIndex": 0,
                        }
                    ],
                }
            ],
            "version": 1,
        },
        "schema": "Q10ModelGoldenFixtureV1",
        "version": 1,
    }


def _campaign(
    fixture: dict[str, object],
    *,
    evidence_posture: str = "SYNTHETIC_ONLY",
) -> dict[str, object]:
    fixture_bytes = canonical_json_bytes(fixture)
    battery = fixture["battery"]
    assert isinstance(battery, dict)
    return {
        "batterySha256": hashlib.sha256(canonical_json_bytes(battery)).hexdigest(),
        "evidencePosture": evidence_posture,
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "honestChallengerLosses": [],
        "schema": "Q10ModelCampaignV1",
        "seed": "1",
        "studySummaries": [
            {
                "bestTrialIndex": 0,
                "completeTrials": 1,
                "loggedTrials": 1,
                "requestedTrials": 1,
                "studyId": "study:v1",
            }
        ],
        "version": 1,
        "winnersByTarget": {"target:v1": "model:v1"},
    }


def _markdown(fixture: dict[str, object], campaign: dict[str, object]) -> bytes:
    battery = fixture["battery"]
    assert isinstance(battery, dict)
    reports = battery["reports"]
    assert isinstance(reports, list)
    report = cast(dict[str, object], reports[0])
    results = cast(list[object], report["results"])
    result = cast(dict[str, object], results[0])
    metrics = cast(list[object], result["metrics"])
    metric = cast(dict[str, object], metrics[0])
    value = cast(dict[str, object], metric["value"])
    mantissa = int(cast(str, value["mantissa"]))
    magnitude = abs(mantissa)
    decimal = f"{'-' if mantissa < 0 else ''}{magnitude // 10**12}.{magnitude % 10**12:012d}"
    winner = "**yes**" if report["winnerModelId"] == result["modelId"] else "—"
    summaries = cast(list[object], campaign["studySummaries"])
    summary = cast(dict[str, object], summaries[0])
    lines = [
        "# Q10 model battery campaign (synthetic only)",
        "",
        "- Seed: `1`",
        f"- Battery SHA-256: `{campaign['batterySha256']}`",
        f"- Golden fixture SHA-256: `{campaign['fixtureSha256']}`",
        (
            "- Model-output serialization: `12` significant decimal digits "
            "(`z.12g`) before fixed-point and digest publication."
        ),
        "- Evidence posture: SYNTHETIC_ONLY — planted machinery truth, never market truth;",
        "  no model here is predictive, validated or economically valuable.",
        "",
        "## Comparison reports",
        "",
        "### `target:v1` — primary `loss`",
        "",
        "| Model | Role | Primary value | Winner |",
        "| --- | --- | --- | --- |",
        f"| `model:v1` | CONTROL | {decimal} | {winner} |",
        "",
        "## Honest challenger losses",
        "",
        "- none on this seed; the law preserves losses whenever they occur",
        "",
        "## Bounded studies (all trials logged)",
        "",
        "| Study | Requested | Logged | Complete | Best trial |",
        "| --- | --- | --- | --- | --- |",
        (
            f"| `{summary['studyId']}` | {summary['requestedTrials']} "
            f"| {summary['loggedTrials']} | {summary['completeTrials']} "
            f"| {summary['bestTrialIndex']} |"
        ),
        "",
        "## Section 14 dispositions",
        "",
        "| Bullet | Disposition | Implemented ids |",
        "| --- | --- | --- |",
        "",
    ]
    return "\n".join(lines).encode()


def _write_root(
    root: Path,
    *,
    fixture: dict[str, object],
    campaign: dict[str, object],
    markdown: bytes,
) -> None:
    fixture_path = root / FIXTURE_PATH
    campaign_path = root / CAMPAIGN_PATH
    markdown_path = root / MARKDOWN_PATH
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    campaign_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_bytes(canonical_json_bytes(fixture))
    campaign_path.write_bytes(canonical_json_bytes(campaign))
    markdown_path.write_bytes(markdown)


def _run_probe(left: Path, right: Path, report: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(PROBE_SCRIPT), str(left), str(right), str(report)],
        cwd=QUANT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )


def _rows(report: dict[str, object], key: str) -> list[dict[str, object]]:
    value = report[key]
    assert isinstance(value, list)
    assert all(isinstance(item, dict) for item in value)
    return cast(list[dict[str, object]], value)


def test_identical_three_file_mints_exit_zero(tmp_path: Path) -> None:
    fixture = _fixture(
        metric_mantissa="1234567890123",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    campaign = _campaign(fixture)
    markdown = _markdown(fixture, campaign)
    left = tmp_path / "left"
    right = tmp_path / "right"
    _write_root(left, fixture=fixture, campaign=campaign, markdown=markdown)
    _write_root(right, fixture=fixture, campaign=campaign, markdown=markdown)

    report_path = tmp_path / "report.json"
    result = _run_probe(left, right, report_path)

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""
    report = parse_canonical_object(report_path.read_bytes())
    assert report["status"] == "BYTE_IDENTICAL"
    assert report["candidateLeafClasses"] == [
        "PREDICTION_VECTOR_DIGEST",
        "REPORT_METRIC_MANTISSA",
        "STUDY_OBJECTIVE_MANTISSA",
    ]
    assert report["candidateFieldPatterns"] == [
        "/battery/reports/*/results/*/metrics/*/value/mantissa",
        "/battery/reports/*/results/*/predictionsSha256",
        "/battery/studies/*/trials/*/objective/mantissa",
    ]
    assert _rows(report, "candidateDifferences") == []
    assert _rows(report, "derivedDifferences") == []
    assert _rows(report, "unexpectedDifferences") == []
    artifacts = _rows(report, "artifacts")
    assert [row["path"] for row in artifacts] == [
        FIXTURE_PATH.as_posix(),
        CAMPAIGN_PATH.as_posix(),
        MARKDOWN_PATH.as_posix(),
    ]
    assert {row["state"] for row in artifacts} == {"MATCH"}


def test_candidate_drift_is_semantic_ordered_value_free_and_deterministic(
    tmp_path: Path,
) -> None:
    left = tmp_path / "left"
    right = tmp_path / "right"
    left_metric = "9111111111111"
    right_metric = "9222222222222"
    left_objective = "9333333333333"
    right_objective = "9444444444444"
    left_prediction = "a" * 64
    right_prediction = "f" * 64
    left_fixture = _fixture(
        metric_mantissa=left_metric,
        objective_mantissa=left_objective,
        prediction_digest=left_prediction,
    )
    right_fixture = _fixture(
        metric_mantissa=right_metric,
        objective_mantissa=right_objective,
        prediction_digest=right_prediction,
    )
    left_campaign = _campaign(left_fixture)
    right_campaign = _campaign(right_fixture)
    _write_root(
        left,
        fixture=left_fixture,
        campaign=left_campaign,
        markdown=_markdown(left_fixture, left_campaign),
    )
    _write_root(
        right,
        fixture=right_fixture,
        campaign=right_campaign,
        markdown=_markdown(right_fixture, right_campaign),
    )

    first_report = tmp_path / "first.json"
    second_report = tmp_path / "second.json"
    first = _run_probe(left, right, first_report)
    second = _run_probe(left, right, second_report)

    assert first.returncode == second.returncode == 1
    assert first_report.read_bytes() == second_report.read_bytes()
    raw_report = first_report.read_bytes()
    for forbidden in (
        left_metric,
        right_metric,
        left_objective,
        right_objective,
        left_prediction,
        right_prediction,
        cast(str, left_campaign["batterySha256"]),
        cast(str, left_campaign["fixtureSha256"]),
        cast(str, right_campaign["batterySha256"]),
        cast(str, right_campaign["fixtureSha256"]),
    ):
        assert forbidden.encode() not in raw_report

    report = parse_canonical_object(raw_report)
    assert report["status"] == "CANDIDATE_FLOAT_DRIFT"
    candidate = _rows(report, "candidateDifferences")
    assert [(row["jsonPointer"], row["kind"]) for row in candidate] == [
        (
            "/battery/reports/0/results/0/metrics/0/value/mantissa",
            "REPORT_METRIC_MANTISSA",
        ),
        (
            "/battery/reports/0/results/0/predictionsSha256",
            "PREDICTION_VECTOR_DIGEST",
        ),
        (
            "/battery/studies/0/trials/0/objective/mantissa",
            "STUDY_OBJECTIVE_MANTISSA",
        ),
    ]
    report_context = cast(dict[str, object], candidate[0]["context"])
    assert report_context == {
        "metricName": "loss",
        "modelId": "model:v1",
        "studyId": None,
        "targetId": "target:v1",
        "trialIndex": None,
    }
    study_context = cast(dict[str, object], candidate[2]["context"])
    assert study_context == {
        "metricName": None,
        "modelId": None,
        "studyId": "study:v1",
        "targetId": None,
        "trialIndex": 0,
    }
    derived = _rows(report, "derivedDifferences")
    assert [(row["artifactPath"], row["jsonPointer"], row["kind"]) for row in derived] == [
        (
            CAMPAIGN_PATH.as_posix(),
            "/batterySha256",
            "DERIVED_CAMPAIGN_DIGEST",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/fixtureSha256",
            "DERIVED_CAMPAIGN_DIGEST",
        ),
        (
            MARKDOWN_PATH.as_posix(),
            "",
            "DERIVED_MARKDOWN_DRIFT",
        ),
    ]
    assert _rows(report, "unexpectedDifferences") == []


def test_unexpected_fixture_or_campaign_drift_exits_two(tmp_path: Path) -> None:
    left = tmp_path / "left"
    right = tmp_path / "right"
    base_fixture = _fixture(
        metric_mantissa="1234567890123",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    changed_fixture = _fixture(
        metric_mantissa="1234567890123",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    changed_battery = cast(dict[str, object], changed_fixture["battery"])
    changed_reports = cast(list[object], changed_battery["reports"])
    changed_report = cast(dict[str, object], changed_reports[0])
    changed_report["targetKind"] = "BINARY"
    _write_root(
        left,
        fixture=base_fixture,
        campaign=_campaign(base_fixture),
        markdown=_markdown(base_fixture, _campaign(base_fixture)),
    )
    changed_campaign = _campaign(changed_fixture)
    changed_summaries = cast(list[object], changed_campaign["studySummaries"])
    changed_summary = cast(dict[str, object], changed_summaries[0])
    changed_summary["completeTrials"] = 0
    _write_root(
        right,
        fixture=changed_fixture,
        campaign=changed_campaign,
        markdown=_markdown(changed_fixture, changed_campaign),
    )

    report_path = tmp_path / "report.json"
    result = _run_probe(left, right, report_path)

    assert result.returncode == 2
    report = parse_canonical_object(report_path.read_bytes())
    assert report["status"] == "NON_CANDIDATE_DRIFT"
    unexpected = _rows(report, "unexpectedDifferences")
    assert [(row["artifactPath"], row["jsonPointer"], row["kind"]) for row in unexpected] == [
        (
            FIXTURE_PATH.as_posix(),
            "/battery/reports/0/targetKind",
            "UNEXPECTED_FIXTURE_DRIFT",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/batterySha256",
            "UNBOUND_DERIVED_CAMPAIGN_DRIFT",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/fixtureSha256",
            "UNBOUND_DERIVED_CAMPAIGN_DRIFT",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/studySummaries",
            "INVALID_DERIVED_CAMPAIGN_BINDING",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/studySummaries/0/completeTrials",
            "UNEXPECTED_CAMPAIGN_DRIFT",
        ),
        (
            MARKDOWN_PATH.as_posix(),
            "",
            "UNBOUND_DERIVED_MARKDOWN_DRIFT",
        ),
    ]
    assert _rows(report, "candidateDifferences") == []
    assert _rows(report, "derivedDifferences") == []


def test_arbitrary_markdown_change_is_not_candidate_drift(tmp_path: Path) -> None:
    left_fixture = _fixture(
        metric_mantissa="1234567890123",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    right_fixture = _fixture(
        metric_mantissa="1234567890124",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    left_campaign = _campaign(left_fixture)
    right_campaign = _campaign(right_fixture)
    left = tmp_path / "left"
    right = tmp_path / "right"
    _write_root(
        left,
        fixture=left_fixture,
        campaign=left_campaign,
        markdown=_markdown(left_fixture, left_campaign),
    )
    hostile_markdown = _markdown(right_fixture, right_campaign).replace(
        b"# Q10 model battery campaign (synthetic only)\n", b"# unrelated\n"
    )
    _write_root(
        right,
        fixture=right_fixture,
        campaign=right_campaign,
        markdown=hostile_markdown,
    )

    report_path = tmp_path / "report.json"
    result = _run_probe(left, right, report_path)

    assert result.returncode == 2
    report = parse_canonical_object(report_path.read_bytes())
    assert report["status"] == "NON_CANDIDATE_DRIFT"
    assert [
        (row["artifactPath"], row["jsonPointer"], row["kind"])
        for row in _rows(report, "unexpectedDifferences")
    ] == [
        (MARKDOWN_PATH.as_posix(), "", "INVALID_MARKDOWN_BINDING"),
        (MARKDOWN_PATH.as_posix(), "", "UNEXPECTED_MARKDOWN_DRIFT"),
    ]
    assert b"unrelated" not in report_path.read_bytes()


def test_invalid_identity_and_negative_zero_fail_closed(tmp_path: Path) -> None:
    for name, mutation in (
        ("boolean-version", ("version", True)),
        ("negative-zero", ("mantissa", "-0")),
    ):
        left = tmp_path / name / "left"
        right = tmp_path / name / "right"
        fixture = _fixture(
            metric_mantissa="1234567890123",
            objective_mantissa="2345678901234",
            prediction_digest="a" * 64,
        )
        if mutation[0] == "version":
            fixture["version"] = mutation[1]
        else:
            battery = cast(dict[str, object], fixture["battery"])
            reports = cast(list[object], battery["reports"])
            report = cast(dict[str, object], reports[0])
            results = cast(list[object], report["results"])
            result_item = cast(dict[str, object], results[0])
            metrics = cast(list[object], result_item["metrics"])
            metric = cast(dict[str, object], metrics[0])
            value = cast(dict[str, object], metric["value"])
            value["mantissa"] = mutation[1]
        campaign = _campaign(fixture)
        markdown = b"# invalid input is never classified\n"
        _write_root(left, fixture=fixture, campaign=campaign, markdown=markdown)
        _write_root(right, fixture=fixture, campaign=campaign, markdown=markdown)

        report_path = tmp_path / name / "report.json"
        result = _run_probe(left, right, report_path)

        assert result.returncode == 2
        assert not report_path.exists()
        assert result.stdout == ""
        assert result.stderr == "q10 vendor probe failed: ValueError\n"


def test_report_path_cannot_alias_an_input(tmp_path: Path) -> None:
    fixture = _fixture(
        metric_mantissa="1234567890123",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    campaign = _campaign(fixture)
    markdown = _markdown(fixture, campaign)
    left = tmp_path / "left"
    right = tmp_path / "right"
    _write_root(left, fixture=fixture, campaign=campaign, markdown=markdown)
    _write_root(right, fixture=fixture, campaign=campaign, markdown=markdown)
    aliased_report = left / FIXTURE_PATH
    original = aliased_report.read_bytes()

    result = _run_probe(left, right, aliased_report)

    assert result.returncode == 2
    assert aliased_report.read_bytes() == original
    assert result.stdout == ""
    assert result.stderr == "q10 vendor probe failed: ValueError\n"


def test_unbound_or_unrefreshed_derived_artifacts_exit_two(tmp_path: Path) -> None:
    left = tmp_path / "left"
    right = tmp_path / "right"
    base_fixture = _fixture(
        metric_mantissa="1234567890123",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    changed_fixture = _fixture(
        metric_mantissa="1234567890124",
        objective_mantissa="2345678901234",
        prediction_digest="a" * 64,
    )
    unchanged_campaign = _campaign(base_fixture)
    unchanged_markdown = _markdown(base_fixture, unchanged_campaign)
    _write_root(
        left,
        fixture=base_fixture,
        campaign=unchanged_campaign,
        markdown=unchanged_markdown,
    )
    _write_root(
        right,
        fixture=changed_fixture,
        campaign=unchanged_campaign,
        markdown=unchanged_markdown,
    )

    report_path = tmp_path / "report.json"
    result = _run_probe(left, right, report_path)

    assert result.returncode == 2
    report = parse_canonical_object(report_path.read_bytes())
    assert report["status"] == "NON_CANDIDATE_DRIFT"
    unexpected = _rows(report, "unexpectedDifferences")
    assert [(row["artifactPath"], row["jsonPointer"], row["kind"]) for row in unexpected] == [
        (
            CAMPAIGN_PATH.as_posix(),
            "/batterySha256",
            "INVALID_DERIVED_CAMPAIGN_BINDING",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/batterySha256",
            "UNREFRESHED_DERIVED_CAMPAIGN",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/fixtureSha256",
            "INVALID_DERIVED_CAMPAIGN_BINDING",
        ),
        (
            CAMPAIGN_PATH.as_posix(),
            "/fixtureSha256",
            "UNREFRESHED_DERIVED_CAMPAIGN",
        ),
        (
            MARKDOWN_PATH.as_posix(),
            "",
            "INVALID_MARKDOWN_BINDING",
        ),
        (
            MARKDOWN_PATH.as_posix(),
            "",
            "UNREFRESHED_DERIVED_MARKDOWN",
        ),
    ]
