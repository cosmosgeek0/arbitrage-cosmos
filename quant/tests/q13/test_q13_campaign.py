from __future__ import annotations

import hashlib

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.deep import (
    DeepGateStatus,
    build_q13_campaign,
    generated_artifacts,
    interface_fixture_digest,
    interface_fixture_mapping,
    render_campaign_markdown,
    synthetic_q14_sample_set,
    synthetic_sequence_windows,
)


def test_campaign_records_only_failed_gate_and_falsification_evidence() -> None:
    campaign = build_q13_campaign()
    mapping = campaign.as_mapping()
    assert campaign.sufficiency.status is DeepGateStatus.FAIL_DATA_INSUFFICIENT
    assert campaign.temporal_leak_verdict == "REJECTED_TEMPORAL_LEAK"
    assert campaign.forged_lineage_verdict == "REJECTED_IMPLAUSIBLE_SKILL"
    assert campaign.unknown_cost_abstain_count == campaign.synthetic_sample_count == 32
    assert mapping["claims"] == {
        "actionability": "UNAVAILABLE",
        "benchmark": "NOT_RUN",
        "calibration": "UNAVAILABLE",
        "edge": "UNAVAILABLE",
        "modelTraining": "NOT_PERMITTED",
        "probability": "UNAVAILABLE",
    }
    assert mapping["evidencePosture"] == "SYNTHETIC_INTERFACE_PROOF_ONLY"
    assert campaign.digest() == campaign.digest()


def test_fixture_projection_is_deterministic_and_unknown_costs_remain_none() -> None:
    mapping = interface_fixture_mapping()
    assert mapping == interface_fixture_mapping()
    assert mapping["evidencePosture"] == "SYNTHETIC_ONLY"
    assert mapping["sequenceCount"] == 32
    assert interface_fixture_digest() == interface_fixture_digest()
    samples = synthetic_q14_sample_set(count=2)
    assert all(sample.gross_edge_ratio is None for sample in samples.samples)
    assert all(sample.base_cost_ratio is None for sample in samples.samples)


@pytest.mark.parametrize("count", [0, 33])
def test_fixture_count_is_bounded(count: int) -> None:
    with pytest.raises(ValueError, match="inside"):
        synthetic_sequence_windows(count=count)


def test_generated_artifacts_are_canonical_and_self_consistent() -> None:
    artifacts = generated_artifacts()
    assert tuple(sorted(artifacts)) == tuple(sorted(generated_artifacts()))
    assert set(artifacts) == {
        "data_sufficiency.v1.json",
        "interface_fixture.v1.json",
        "q13_campaign.v1.json",
        "q13_campaign.v1.md",
        "reference_catalog.v1.json",
    }
    for name, raw in artifacts.items():
        if name.endswith(".json"):
            assert canonical_json_bytes(parse_canonical_object(raw)) == raw
        else:
            assert raw == render_campaign_markdown(build_q13_campaign()).encode()
    digest = hashlib.sha256(artifacts["q13_campaign.v1.json"]).hexdigest()
    assert len(digest) == 64
