"""Deterministic Q06 feature-registry campaign and golden-fixture builder.

Usage: ``python scripts/q06_feature_campaign.py OUTPUT_ROOT``

Writes, byte-deterministically and without any network, environment or ambient-time
access:

- ``OUTPUT_ROOT/fixtures/q06_feature_golden_v1.json``
- ``OUTPUT_ROOT/generated/q06/feature_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q06/feature_campaign.v1.md``

Everything here is SYNTHETIC fixture evidence proving the §12 machinery; no feature is
claimed to be predictive, validated or economically valuable.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from quant_edge.canonical import canonical_json_bytes
from quant_edge.features.domains import (
    FeaturePointV1,
    FeatureSeriesV1,
    WallTimeBarSpecV1,
    build_bars,
)
from quant_edge.features.harness import run_equivalence, streaming_vector, vector_digest
from quant_edge.features.primitives import v1_features
from quant_edge.features.registry import FeatureRegistryV1, render_registry_markdown
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1
from quant_edge.randomness import DeterministicRandom

CAMPAIGN_SEED = 20260712
SEEDED_SERIES = 12
BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _golden_series() -> FeatureSeriesV1:
    points = []
    price = 10_000
    for index in range(60):
        price = price + ((index * 37) % 11 - 5) * 7
        points.append(
            FeaturePointV1(
                event_time_ns=BASE_NS + index * 2 * SECOND_NS,
                ordinal=index + 1,
                value=ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT"),
                volume=ExactScaledValueV1(coefficient=5, scale=0, unit_id="BNB"),
            )
        )
    return FeatureSeriesV1(
        series_id="series-golden",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 130 * SECOND_NS,
        points=tuple(points),
    )


def _seeded_series(rng: DeterministicRandom, index: int) -> FeatureSeriesV1:
    points = []
    price = 5_000 + int(rng.next_u64() % 10_000)
    offset = 0
    for ordinal in range(2 + int(rng.next_u64() % 60)):
        offset += 1 + int(rng.next_u64() % 8)
        price = max(price + int(rng.next_u64() % 181) - 90, 100)
        points.append(
            FeaturePointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=ordinal + 1,
                value=ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT"),
                volume=ExactScaledValueV1(
                    coefficient=int(rng.next_u64() % 50),
                    scale=0,
                    unit_id="BNB",
                ),
            )
        )
    return FeatureSeriesV1(
        series_id=f"series-seeded-{index:02d}",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + (offset + 5) * SECOND_NS,
        points=tuple(points),
    )


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    implementations = v1_features()
    registry = FeatureRegistryV1(
        registry_version="q06-features-v1",
        cards=tuple(sorted((impl.card for impl in implementations), key=lambda c: c.feature_id)),
    )
    golden_bars = build_bars(
        _golden_series(),
        WallTimeBarSpecV1(wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS),
    )
    golden_reports = []
    golden_vectors = {}
    for implementation in implementations:
        report = run_equivalence(implementation, golden_bars)
        if not report.passed:
            raise ValueError(f"golden equivalence failed for {report.feature_id}")
        golden_reports.append(report.as_mapping())
        golden_vectors[implementation.card.feature_id] = vector_digest(
            streaming_vector(implementation, golden_bars)
        ).hexdigest

    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    seeded_summaries = []
    max_ulp_by_feature: dict[str, int] = {}
    for index in range(SEEDED_SERIES):
        series = _seeded_series(rng, index)
        bars = build_bars(
            series,
            WallTimeBarSpecV1(wall_width_ns=5 * SECOND_NS, anchor_ns=BASE_NS),
        )
        for implementation in implementations:
            report = run_equivalence(implementation, bars)
            if not report.passed:
                raise ValueError(
                    f"seeded equivalence failed for {report.feature_id} on {series.series_id}"
                )
            feature_id = implementation.card.feature_id
            max_ulp_by_feature[feature_id] = max(
                max_ulp_by_feature.get(feature_id, 0),
                report.max_ulp_deviation,
            )
        seeded_summaries.append(
            {"bars": len(bars.bars), "points": len(series.points), "seriesId": series.series_id}
        )

    fixture = {
        "goldenReports": golden_reports,
        "goldenVectorSha256": dict(sorted(golden_vectors.items())),
        "registry": registry.as_mapping(),
        "registrySha256": registry.content_digest.hexdigest,
        "schema": "Q06FeatureGoldenFixtureV1",
        "version": 1,
    }
    fixture_bytes = canonical_json_bytes(fixture)
    campaign = {
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "maxUlpByFeature": dict(sorted(max_ulp_by_feature.items())),
        "schema": "Q06FeatureCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "seededSeries": seeded_summaries,
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign)
    markdown = render_registry_markdown(registry)
    lines = [
        markdown,
        "## Campaign evidence (synthetic only)",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Golden fixture SHA-256: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
        f"- Seeded series: {SEEDED_SERIES}, all equivalence reports passed",
        "- Max ulp deviation by feature: "
        + ", ".join(f"`{k}`={v}" for k, v in sorted(max_ulp_by_feature.items())),
        "",
    ]
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: q06_feature_campaign.py OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    fixture_path = output_root / "fixtures" / "q06_feature_golden_v1.json"
    campaign_path = output_root / "generated" / "q06" / "feature_campaign.v1.json"
    markdown_path = output_root / "generated" / "q06" / "feature_campaign.v1.md"
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
