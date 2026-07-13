from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.deep import DeepFoldLineageV1, synthetic_sequence_windows
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState


def _digest(character: str = "a") -> DigestV1:
    return DigestV1(character * 64)


def _lineage() -> DeepFoldLineageV1:
    return DeepFoldLineageV1(
        fold_id="fold-1",
        candidate_id="future-candidate-v1",
        validation_sample_id="validation-1",
        validation_group_id="validation-group-1",
        validation_cutoff_ns=1_700_000_100_000_000_000,
        training_sample_ids=("training-1", "training-2"),
        training_group_ids=("training-group-1", "training-group-2"),
        max_training_label_end_ns=1_700_000_000_000_000_000,
        embargo_ns=10_000_000_000,
        training_set_digest=_digest("1"),
        split_plan_digest=_digest("2"),
        feature_registry_digest=_digest("3"),
        label_manifest_digest=_digest("4"),
    )


def test_sequence_fixture_is_bounded_causal_synthetic_and_q14_compatible() -> None:
    windows = synthetic_sequence_windows(count=2)
    first = windows[0]
    assert first.max_feature_asof_ns == first.cutoff_ns
    assert first.quality is QualityState.SYNTHETIC
    assert first.posture is EvidencePosture.SYNTHETIC
    assert first.gross_edge_ratio is None
    assert first.base_cost_ratio is None
    assert first.as_validation_sample().base_cost_ratio is None
    assert first.as_mapping()["schema"] == "Q13DeepSequenceWindowV1"
    assert first.digest() == first.digest()
    assert windows[0].digest() != windows[1].digest()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"sequence_start_ns": 1_700_000_100_000_000_000}, "time law"),
        ({"frame_asof_ns": ()}, "bounded non-empty"),
        ({"frame_asof_ns": (1_699_999_996_000_000_000,)}, "inside the pre-cutoff"),
        (
            {"frame_asof_ns": (1_699_999_999_000_000_000,) * 2},
            "strictly increasing",
        ),
        ({"feature_ids": ()}, "must contain"),
        ({"feature_ids": ("z", "a")}, "sorted and unique"),
        ({"level_count": 0}, "must be positive"),
        ({"level_count": "bad"}, "must be an integer"),
        ({"gap_count": -1}, "outside"),
        ({"quality": "bad"}, "quality must"),
        ({"posture": "bad"}, "posture must"),
        ({"quality": QualityState.PARTIAL}, "synthetic evidence"),
        (
            {
                "quality": QualityState.COMPLETE,
                "posture": EvidencePosture.REPLAY,
                "level_count": None,
            },
            "COMPLETE requires",
        ),
        ({"payload_digest": "bad"}, "payload_digest"),
        ({"binary_outcome": 1}, "boolean or None"),
        ({"gross_edge_ratio": "bad"}, "gross_edge_ratio"),
        ({"base_cost_ratio": "bad"}, "base_cost_ratio"),
    ],
)
def test_sequence_contract_rejects_bad_temporal_quality_or_unknown_semantics(
    changes: dict[str, object], message: str
) -> None:
    with pytest.raises(ContractValueError, match=message):
        replace(synthetic_sequence_windows(count=1)[0], **changes)  # type: ignore[arg-type]


def test_complete_replay_metadata_requires_known_levels_and_zero_gaps() -> None:
    base = synthetic_sequence_windows(count=1)[0]
    complete = replace(
        base,
        posture=EvidencePosture.REPLAY,
        quality=QualityState.COMPLETE,
        level_count=10,
        gap_count=0,
    )
    assert complete.quality is QualityState.COMPLETE


def test_fold_lineage_binds_out_of_fold_and_embargo_truth() -> None:
    lineage = _lineage()
    mapping = lineage.as_mapping()
    assert mapping["validationSampleId"] == "validation-1"
    assert mapping["trainingSampleIds"] == ["training-1", "training-2"]
    assert lineage.digest() == lineage.digest()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"training_sample_ids": ()}, "must contain"),
        ({"training_sample_ids": ("training-2", "training-1")}, "sorted and unique"),
        ({"training_group_ids": ("training-group-1",) * 2}, "sorted and unique"),
        ({"training_sample_ids": ("validation-1",)}, "validation sample"),
        ({"training_group_ids": ("validation-group-1",)}, "validation group"),
        (
            {"max_training_label_end_ns": 1_700_000_095_000_000_000},
            "labels plus embargo",
        ),
        ({"embargo_ns": -1}, "outside"),
        ({"training_set_digest": "bad"}, "training_set_digest"),
        ({"split_plan_digest": "bad"}, "split_plan_digest"),
        ({"feature_registry_digest": "bad"}, "feature_registry_digest"),
        ({"label_manifest_digest": "bad"}, "label_manifest_digest"),
    ],
)
def test_fold_lineage_rejects_overlap_or_unbound_digests(
    changes: dict[str, object], message: str
) -> None:
    with pytest.raises(ContractValueError, match=message):
        replace(_lineage(), **changes)  # type: ignore[arg-type]
