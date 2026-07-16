"""Deterministic Q05 label-factory campaign and golden-fixture builder.

Usage: ``python scripts/q05_label_campaign.py OUTPUT_ROOT``

Writes, byte-deterministically and without any network, environment or ambient-time
access:

- ``OUTPUT_ROOT/fixtures/q05_label_golden_v1.json``
- ``OUTPUT_ROOT/generated/q05/label_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q05/label_campaign.v1.md``

Everything here is SYNTHETIC fixture evidence exercising the §11 machinery; nothing is
observed market data and no edge, probability or economic claim is made.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.canonical import canonical_json_bytes
from quant_edge.labels.basis import (
    BasisConstruction,
    BasisCostAssumptionV1,
    BasisDefinitionV1,
    BorrowAssumptionV1,
    BorrowKnownness,
    FundingEventV1,
    compute_basis_label,
)
from quant_edge.labels.controls import (
    ControlMatchSpecV1,
    WindowFactsV1,
    match_controls,
)
from quant_edge.labels.disposition import (
    EventDisposition,
    WindowQualityFactsV1,
    derive_disposition,
)
from quant_edge.labels.identity import (
    SampleIdentityV1,
    VersionSetV1,
    make_sample_identity,
)
from quant_edge.labels.manifest import (
    GroupWindowV1,
    ManifestMemberV1,
    assign_evaluation_groups,
    build_label_manifest,
    make_manifest_member,
    outcome_reference,
)
from quant_edge.labels.outcomes import (
    BarrierSpecV1,
    CostScenarioV1,
    OutcomeDefinitionV1,
    SampleOutcomesV1,
    compute_sample_outcomes,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import (
    EvidenceSeriesV1,
    GapIntervalV1,
    PricePointV1,
    SeriesKind,
)
from quant_edge.labels.stages import (
    StageDefinitionV1,
    StageEvidenceV1,
    generate_stage,
)
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1
from quant_edge.randomness import DeterministicRandom

CAMPAIGN_SEED = 20260712
SEEDED_SAMPLES = 24
BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
DAY_NS = 86_400_000_000_000
AVAILABLE_AT_MS = 1_772_010_000_000


def _scaled(coefficient: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT")


def _point(offset_s: int, coefficient: int, ordinal: int) -> PricePointV1:
    return PricePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        price=_scaled(coefficient),
    )


def _series(
    series_id: str,
    points: tuple[PricePointV1, ...],
    *,
    end_s: int = 7_200,
    gaps: tuple[GapIntervalV1, ...] = (),
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id=series_id,
        symbol="BNBUSDT",
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        price_points=points,
        quote_points=(),
        known_gaps=gaps,
    )


def _instrument() -> PointInTimeInstrumentV1:
    return PointInTimeInstrumentV1(
        venue="binance",
        product="spot",
        symbol="BNBUSDT",
        base_asset_id="UNKNOWN_BASE",
        quote_asset_id="UNKNOWN_QUOTE",
        instrument_version="archive-v1",
        observed_at_ns=BASE_NS,
        missing_identity_fields=("base_asset_id", "quote_asset_id"),
    )


def _versions() -> VersionSetV1:
    return VersionSetV1(
        dataset_version="ds-v1",
        feature_version="feat-v1",
        label_definition_version="label-v1",
        cost_assumption_version="cost-v1",
        execution_assumption_version="exec-v1",
    )


def _sample(event_id: str, cohort_id: str) -> SampleIdentityV1:
    return make_sample_identity(
        event_id=event_id,
        cohort_id=cohort_id,
        instrument=_instrument(),
        feature_lookback_start_ns=BASE_NS - 60 * SECOND_NS,
        feature_cutoff_ns=BASE_NS,
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + 3_600 * SECOND_NS,
        source_completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        source_completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        versions=_versions(),
    )


def _definition() -> OutcomeDefinitionV1:
    return OutcomeDefinitionV1(
        definition_version="outcome-v1",
        max_reference_staleness_ns=60 * SECOND_NS,
    )


def _barriers() -> BarrierSpecV1:
    return BarrierSpecV1(
        spec_version="barrier-v1",
        up_ratio=make_ratio(1, 200),
        down_ratio=make_ratio(-1, 200),
    )


def _scenarios() -> tuple[CostScenarioV1, ...]:
    return (
        CostScenarioV1(
            scenario_version="cost-a",
            total_cost_ratio=make_ratio(1, 1_000),
            submission_latency_ns=2 * SECOND_NS,
        ),
    )


def _stage_definition() -> StageDefinitionV1:
    return StageDefinitionV1(
        definition_version="stage-v1",
        dormant_max_count=1,
        ignition_ratio=make_ratio(3, 1),
        continuation_floor_ratio=make_ratio(2, 1),
        fade_ceiling_ratio=make_ratio(1, 2),
    )


def _match_spec() -> ControlMatchSpecV1:
    return ControlMatchSpecV1(
        match_version="match-v1",
        liquidity_bucket_edges=(10, 100, 1_000),
        volatility_bucket_edges=(make_ratio(1, 200), make_ratio(1, 20)),
        time_of_day_bucket_ns=DAY_NS // 24,
        funding_cycle_ns=DAY_NS // 3,
        max_controls=4,
    )


def _window_facts(window_id: str, days_back: int) -> WindowFactsV1:
    start = BASE_NS - (90_000 + days_back * 86_400) * SECOND_NS
    return WindowFactsV1(
        window_id=window_id,
        symbol="BNBUSDT",
        window_start_ns=start,
        window_end_ns=start + 600 * SECOND_NS,
        row_count=120,
        value_range_ratio=make_ratio(1, 100),
        regime_id="regime-a",
        completeness_known=True,
        gap_row_count=0,
    )


def _compute(sample: SampleIdentityV1, series: EvidenceSeriesV1) -> SampleOutcomesV1:
    return compute_sample_outcomes(
        sample,
        series,
        definition=_definition(),
        barriers=_barriers(),
        cost_scenarios=_scenarios(),
    )


def _member(
    sample: SampleIdentityV1,
    series: EvidenceSeriesV1,
    *,
    quality: WindowQualityFactsV1,
    is_control: bool,
    asserted: EventDisposition | None,
    window_buckets: tuple[int, ...],
) -> tuple[ManifestMemberV1, SampleOutcomesV1]:
    outcomes = _compute(sample, series)
    disposition = derive_disposition(
        sample_id=sample.sample_id,
        event_id=sample.event_id,
        quality=quality,
        is_control_window=is_control,
        asserted=asserted,
    )
    stage = generate_stage(
        StageEvidenceV1(
            baseline_bucket_counts=(2, 2, 2),
            window_bucket_counts=window_buckets,
            net_return_sign=1,
            window_complete=True,
            disorder_observed=False,
        ),
        _stage_definition(),
    )
    controls = match_controls(
        sample,
        _window_facts("candidate-1", 0),
        tuple(_window_facts(f"pool-{index}", index + 1) for index in range(3)),
        _match_spec(),
    )
    member = make_manifest_member(
        outcomes=outcomes,
        disposition=disposition,
        stage=stage,
        control_window_ids=controls.selected_window_ids,
    )
    return member, outcomes


def build_golden() -> tuple[dict[str, object], dict[str, object]]:
    clean = WindowQualityFactsV1(
        gap_row_count=0,
        duplicate_row_count=0,
        completeness_known=True,
    )
    gapped_quality = WindowQualityFactsV1(
        gap_row_count=3,
        duplicate_row_count=0,
        completeness_known=True,
    )
    acted_points = (
        _point(-10, 10_000, 1),
        _point(1, 10_100, 2),
        _point(30, 9_900, 3),
        _point(3_600, 10_200, 4),
    )
    quiet_points = (_point(-10, 10_000, 1), _point(600, 10_001, 2))
    gapped_points = (_point(-10, 10_000, 1), _point(3_600, 10_050, 2))
    gap = GapIntervalV1(
        start_ns=BASE_NS + 100 * SECOND_NS,
        end_ns=BASE_NS + 200 * SECOND_NS,
    )

    acted_member, acted_outcomes = _member(
        _sample("event-acted", "cohort-acted"),
        _series("series-acted", acted_points),
        quality=clean,
        is_control=False,
        asserted=EventDisposition.ACTED,
        window_buckets=(8, 12, 6),
    )
    quiet_member, quiet_outcomes = _member(
        _sample("event-quiet", "cohort-quiet"),
        _series("series-quiet", quiet_points),
        quality=clean,
        is_control=True,
        asserted=None,
        window_buckets=(2, 2, 2),
    )
    invalid_member, invalid_outcomes = _member(
        _sample("event-gapped", "cohort-gapped"),
        _series("series-gapped", gapped_points, gaps=(gap,)),
        quality=gapped_quality,
        is_control=False,
        asserted=None,
        window_buckets=(2, 2, 8),
    )
    manifest = build_label_manifest(
        versions=_versions(),
        match_version="match-v1",
        members=(acted_member, quiet_member, invalid_member),
    )
    groups = assign_evaluation_groups(
        (
            GroupWindowV1(
                window_id="w-1",
                symbol="BNBUSDT",
                start_ns=BASE_NS,
                end_ns=BASE_NS + 600 * SECOND_NS,
            ),
            GroupWindowV1(
                window_id="w-2",
                symbol="BNBUSDT",
                start_ns=BASE_NS + 610 * SECOND_NS,
                end_ns=BASE_NS + 1_200 * SECOND_NS,
            ),
        ),
        adjacency_gap_ns=60 * SECOND_NS,
    )
    basis_label = compute_basis_label(
        construction=BasisConstruction.NORMAL,
        spot_series=_series(
            "series-basis-spot",
            (
                _point(-5, 10_000, 1),
                _point(60, 10_000, 2),
                _point(870, 10_000, 3),
            ),
        ),
        perp_series=_series(
            "series-basis-perp",
            (
                _point(-3, 10_400, 1),
                _point(120, 10_150, 2),
                _point(900, 10_020, 3),
            ),
        ),
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + 3_600 * SECOND_NS,
        definition=BasisDefinitionV1(
            definition_version="basis-v1",
            max_reference_staleness_ns=60 * SECOND_NS,
            partial_convergence_fraction=make_ratio(1, 2),
            full_convergence_fraction=make_ratio(1, 10),
        ),
        costs=BasisCostAssumptionV1(
            assumption_version="fees-v1",
            per_leg_fee=make_ratio(1, 1_000),
            entry_slippage=make_ratio(1, 2_000),
            exit_slippage=make_ratio(1, 2_000),
            recovery_cost=make_ratio(1, 1_000),
        ),
        borrow=BorrowAssumptionV1(
            assumption_version="borrow-v1",
            knownness=BorrowKnownness.UNKNOWN,
            hourly_rate=None,
        ),
        funding_schedule=(
            FundingEventV1(time_ns=BASE_NS + 300 * SECOND_NS, rate=make_ratio(1, 10_000)),
        ),
    )
    reference = outcome_reference(acted_outcomes, available_at_ms=AVAILABLE_AT_MS)
    fixture = {
        "basisLabel": basis_label.as_mapping(),
        "evaluationGroups": dict(sorted(groups.items())),
        "manifest": manifest.as_mapping(),
        "manifestSha256": manifest.content_digest.hexdigest,
        "objectiveOutcomeReference": reference.as_mapping(),
        "outcomes": [
            {
                "outcomeId": outcomes.outcome_id,
                "outcomeSha256": outcomes.content_sha256,
                "sampleId": outcomes.sample.sample_id,
            }
            for outcomes in (acted_outcomes, quiet_outcomes, invalid_outcomes)
        ],
        "schema": "Q05LabelGoldenFixtureV1",
        "version": 1,
    }
    summary = {
        "dispositionCounts": manifest.as_mapping()["dispositionCounts"],
        "manifestSha256": manifest.content_digest.hexdigest,
        "members": len(manifest.members),
        "stageCounts": manifest.as_mapping()["stageCounts"],
    }
    return fixture, summary


def build_seeded_summary() -> dict[str, object]:
    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    status_counts: dict[str, int] = {}
    digests: list[str] = []
    for index in range(SEEDED_SAMPLES):
        points = []
        offset = -30
        price = 5_000 + int(rng.next_u64() % 10_000)
        for ordinal in range(1 + int(rng.next_u64() % 20)):
            offset += 1 + int(rng.next_u64() % 30)
            move = int(rng.next_u64() % 200) - 100
            price = max(price + move, 100)
            points.append(_point(offset, price, ordinal + 1))
        end_s = 60 + int(rng.next_u64() % 7_000)
        if points[-1].event_time_ns > BASE_NS + end_s * SECOND_NS:
            end_s = 7_200
        sample = _sample("event-seeded", f"cohort-seeded-{index:02d}")
        outcomes = _compute(
            sample,
            _series(f"series-seeded-{index:02d}", tuple(points), end_s=end_s),
        )
        replay = _compute(
            sample,
            _series(f"series-seeded-{index:02d}", tuple(points), end_s=end_s),
        )
        if outcomes.canonical_bytes() != replay.canonical_bytes():
            raise ValueError("seeded outcome computation is not byte-deterministic")
        digests.append(outcomes.content_sha256)
        for outcome in outcomes.horizons:
            key = outcome.status.value
            status_counts[key] = status_counts.get(key, 0) + 1
    aggregate = hashlib.sha256("\n".join(digests).encode("ascii")).hexdigest()
    return {
        "aggregateOutcomeSha256": aggregate,
        "horizonStatusCounts": dict(sorted(status_counts.items())),
        "samples": SEEDED_SAMPLES,
        "seed": str(CAMPAIGN_SEED),
    }


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    fixture, golden_summary = build_golden()
    seeded_summary = build_seeded_summary()
    fixture_bytes = canonical_json_bytes(fixture)
    campaign = {
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "golden": golden_summary,
        "schema": "Q05LabelCampaignV1",
        "seeded": seeded_summary,
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign)
    status_counts = seeded_summary["horizonStatusCounts"]
    rendered_statuses = (
        ", ".join(f"{key}={value}" for key, value in status_counts.items())
        if isinstance(status_counts, dict) and status_counts
        else "none"
    )
    lines = [
        "# Q05 label campaign (synthetic fixture evidence only)",
        "",
        "Deterministic proof for the §11 label/outcome/control factory. Nothing here is",
        "observed market data; statuses below are honest fixture statuses and include",
        "explicit censoring and DATA_INVALID truth. No edge or probability is claimed.",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Golden fixture SHA-256: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
        f"- Golden manifest SHA-256: `{golden_summary['manifestSha256']}`",
        f"- Golden members: {golden_summary['members']}"
        f" (dispositions: {golden_summary['dispositionCounts']})",
        f"- Seeded samples: {seeded_summary['samples']}",
        f"- Seeded horizon statuses: {rendered_statuses}",
        f"- Seeded aggregate outcome SHA-256: `{seeded_summary['aggregateOutcomeSha256']}`",
        "",
    ]
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: q05_label_campaign.py OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    fixture_path = output_root / "fixtures" / "q05_label_golden_v1.json"
    campaign_path = output_root / "generated" / "q05" / "label_campaign.v1.json"
    markdown_path = output_root / "generated" / "q05" / "label_campaign.v1.md"
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    campaign_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_bytes(fixture_bytes)
    campaign_path.write_bytes(campaign_bytes)
    markdown_path.write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
