"""Deterministic Q10 model-battery campaign and golden-fixture builder.

Usage: ``python scripts/q10_model_campaign.py OUTPUT_ROOT``

Writes, byte-deterministically and without any network or environment access:

- ``OUTPUT_ROOT/fixtures/q10_model_golden_v1.json``
- ``OUTPUT_ROOT/generated/q10/model_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q10/model_campaign.v1.md``

Host wall-time measurements are printed to stdout as environment-specific
evidence; they never enter the artifacts and are never asserted by any test.

Everything here is SYNTHETIC fixture evidence proving the §14.1-§14.3 battery
machinery: every bounded Optuna trial is logged, calibrated linear baselines
and honest controls run beside the selected XGBoost challengers, and honest
challenger losses are preserved verbatim in the frozen comparison reports. No
model is claimed to be predictive, validated or economically valuable.
"""

from __future__ import annotations

import hashlib
import sys
import time
from pathlib import Path

from quant_edge.canonical import canonical_json_bytes
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE
from quant_edge.models.battery import BATTERY_SEED, BatteryResultV1, run_battery
from quant_edge.models.contracts import ModelRole


def _decimal(mantissa: int) -> str:
    sign = "-" if mantissa < 0 else ""
    magnitude = abs(mantissa)
    return f"{sign}{magnitude // FIXED_POINT_SCALE}.{magnitude % FIXED_POINT_SCALE:012d}"


def _honest_challenger_losses(
    result: BatteryResultV1,
) -> list[tuple[str, str, str, str, tuple[str, ...]]]:
    """(target_id, primary_metric, winner_id, winner_role, losing challenger ids)."""

    losses: list[tuple[str, str, str, str, tuple[str, ...]]] = []
    for report in result.reports:
        winner = next(item for item in report.results if item.model_id == report.winner_model_id)
        if winner.role is ModelRole.BOOSTED_CHALLENGER:
            continue
        losing_challengers = tuple(
            sorted(
                item.model_id
                for item in report.results
                if item.role is ModelRole.BOOSTED_CHALLENGER
            )
        )
        if losing_challengers:
            losses.append(
                (
                    report.target_id,
                    report.primary_metric,
                    report.winner_model_id,
                    winner.role.value,
                    losing_challengers,
                )
            )
    return losses


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    result = run_battery(BATTERY_SEED)

    fixture = {
        "battery": result.as_mapping(),
        "schema": "Q10ModelGoldenFixtureV1",
        "version": 1,
    }
    fixture_bytes = canonical_json_bytes(fixture)

    study_summaries = [
        {
            "bestTrialIndex": study.best_trial_index,
            "completeTrials": len(study.complete_trials()),
            "loggedTrials": len(study.trials),
            "requestedTrials": study.spec.n_trials,
            "studyId": study.spec.study_id,
        }
        for study in result.studies
    ]
    campaign = {
        "batterySha256": result.content_digest.hexdigest,
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "honestChallengerLosses": [
            {
                "losingChallengers": list(losing),
                "primaryMetric": primary,
                "targetId": target_id,
                "winnerModelId": winner_id,
                "winnerRole": winner_role,
            }
            for target_id, primary, winner_id, winner_role, losing in _honest_challenger_losses(
                result
            )
        ],
        "schema": "Q10ModelCampaignV1",
        "seed": str(BATTERY_SEED),
        "studySummaries": study_summaries,
        "version": 1,
        "winnersByTarget": {report.target_id: report.winner_model_id for report in result.reports},
    }
    campaign_bytes = canonical_json_bytes(campaign)

    lines = [
        "# Q10 model battery campaign (synthetic only)",
        "",
        f"- Seed: `{BATTERY_SEED}`",
        f"- Battery SHA-256: `{result.content_digest.hexdigest}`",
        f"- Golden fixture SHA-256: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
        "- Evidence posture: SYNTHETIC_ONLY — planted machinery truth, never market truth;",
        "  no model here is predictive, validated or economically valuable.",
        "",
        "## Comparison reports",
        "",
    ]
    for report in result.reports:
        lines.append(f"### `{report.target_id}` — primary `{report.primary_metric}`")
        lines.append("")
        lines.append("| Model | Role | Primary value | Winner |")
        lines.append("| --- | --- | --- | --- |")
        for item in report.results:
            marker = "**yes**" if item.model_id == report.winner_model_id else "—"
            value = _decimal(item.metric(report.primary_metric).value.mantissa)
            lines.append(f"| `{item.model_id}` | {item.role.value} | {value} | {marker} |")
        lines.append("")
    lines.extend(["## Honest challenger losses", ""])
    losses = _honest_challenger_losses(result)
    if losses:
        for target_id, _, winner_id, winner_role, losing in losses:
            challengers = ", ".join(f"`{name}`" for name in losing)
            lines.append(
                f"- `{target_id}`: winner `{winner_id}` ({winner_role}); "
                f"losing boosted challengers: {challengers}"
            )
    else:
        lines.append("- none on this seed; the law preserves losses whenever they occur")
    lines.extend(["", "## Bounded studies (all trials logged)", ""])
    lines.append("| Study | Requested | Logged | Complete | Best trial |")
    lines.append("| --- | --- | --- | --- | --- |")
    for study in result.studies:
        lines.append(
            f"| `{study.spec.study_id}` | {study.spec.n_trials} | {len(study.trials)} "
            f"| {len(study.complete_trials())} | {study.best_trial_index} |"
        )
    lines.extend(["", "## Section 14 dispositions", ""])
    lines.append("| Bullet | Disposition | Implemented ids |")
    lines.append("| --- | --- | --- |")
    lines.extend(
        f"| {record.bullet_id} | {record.disposition.value} | "
        f"{', '.join(record.implemented_ids) or '—'} |"
        for record in result.dispositions
    )
    lines.append("")
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: q10_model_campaign.py OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    started = time.perf_counter_ns()
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    elapsed = time.perf_counter_ns() - started
    fixture_path = output_root / "fixtures" / "q10_model_golden_v1.json"
    campaign_path = output_root / "generated" / "q10" / "model_campaign.v1.json"
    markdown_path = output_root / "generated" / "q10" / "model_campaign.v1.md"
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    campaign_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_bytes(fixture_bytes)
    campaign_path.write_bytes(campaign_bytes)
    markdown_path.write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    print("# environment-specific wall-time evidence (non-deterministic, informational)")
    print(f"wall-ns full-battery-artifact-build {elapsed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
