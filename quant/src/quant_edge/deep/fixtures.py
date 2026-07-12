"""Deterministic Q13 fixtures: metadata and Q14 falsification inputs only."""

from __future__ import annotations

import hashlib
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.deep.contracts import DeepSequenceWindowV1
from quant_edge.deep.sufficiency import EXACT_EVIDENCE_GAP, DeepDataSufficiencyEvidenceV1
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState
from quant_edge.validation import SampleSetV1

FIXTURE_BASE_NS: Final = 1_700_000_000_000_000_000
FIXTURE_STEP_NS: Final = 60_000_000_000
FIXTURE_LABEL_HORIZON_NS: Final = 30_000_000_000
FIXTURE_COUNT: Final = 32
FIXTURE_SEED: Final = 20260713
FROZEN_EVALUATED_AT_NS: Final = 1_783_939_200_000_000_000

_EVIDENCE_DIGESTS: Final = (
    (
        "event-atlas-v1",
        DigestV1("f8d59dea19be7a4f633f73deaccc3910b086c5a50fa03c07a1b4147ba297b21c"),
    ),
    (
        "q05-label-campaign-v1",
        DigestV1("9a5e5dcc7f7f6425c43e4e82c4ed51217284f39d361c0f0e45e7220226780c7e"),
    ),
    (
        "q14-validation-campaign-v1",
        DigestV1("a0522034a97c2676d4af31c7b22c10412ebb06a115df4de72f307081b23d9f87"),
    ),
    (
        "source-coverage-v1",
        DigestV1("f2f23bbb394e6547222bfde5ed4bc8ed9551a771ad5bfe18c4c239ca70429104"),
    ),
)


def frozen_q13_sufficiency_evidence(
    *,
    evaluated_at_ns: int = FROZEN_EVALUATED_AT_NS,
) -> DeepDataSufficiencyEvidenceV1:
    """The actual-tree Q13 facts, with the evaluation clock supplied explicitly."""

    return DeepDataSufficiencyEvidenceV1(
        evaluated_at_ns=evaluated_at_ns,
        complete_historical_l2=False,
        independent_events_regimes=False,
        stable_point_in_time_labels=False,
        realistic_cost_actionability=False,
        measured_compute_budget=None,
        untouched_chronological_holdout=False,
        same_cohort_simple_baseline=False,
        reason_codes=(
            "COMPLETE_L2_UNAVAILABLE",
            "COST_TRUTH_UNAVAILABLE",
            "FORWARD_HIGH_FIDELITY_BLOCKED",
            "INDEPENDENT_REGIMES_UNAVAILABLE",
            "REAL_LABELS_UNAVAILABLE",
            "SAME_COHORT_BASELINE_UNAVAILABLE",
            "TRAINING_BUDGET_UNPROVEN",
            "UNTOUCHED_HOLDOUT_UNAVAILABLE",
        ),
        evidence_digests=_EVIDENCE_DIGESTS,
        evidence_gap=EXACT_EVIDENCE_GAP,
    )


def _payload_digest(sample_id: str) -> DigestV1:
    payload = f"q13:{FIXTURE_SEED}:{sample_id}".encode()
    return DigestV1(hexdigest=hashlib.sha256(payload).hexdigest())


def synthetic_sequence_windows(*, count: int = FIXTURE_COUNT) -> tuple[DeepSequenceWindowV1, ...]:
    """Synthetic causal windows; values are not model inputs or market evidence."""

    if not 1 <= count <= FIXTURE_COUNT:
        raise ValueError(f"count must be inside 1..{FIXTURE_COUNT}")
    windows: list[DeepSequenceWindowV1] = []
    for index in range(count):
        sample_id = f"sample-{index:03d}"
        cutoff = FIXTURE_BASE_NS + index * FIXTURE_STEP_NS
        windows.append(
            DeepSequenceWindowV1(
                sequence_id=f"sequence-{index:03d}",
                sample_id=sample_id,
                symbol="SYNTHUSDT",
                group_id=f"event-{index // 2:03d}",
                sequence_start_ns=cutoff - 3_000_000_000,
                cutoff_ns=cutoff,
                label_end_ns=cutoff + FIXTURE_LABEL_HORIZON_NS,
                frame_asof_ns=(
                    cutoff - 2_000_000_000,
                    cutoff - 1_000_000_000,
                    cutoff,
                ),
                feature_ids=("l1-imbalance-v1", "trade-intensity-v1"),
                level_count=1,
                gap_count=0,
                quality=QualityState.SYNTHETIC,
                posture=EvidencePosture.SYNTHETIC,
                payload_digest=_payload_digest(sample_id),
                binary_outcome=index % 3 == 0,
                gross_edge_ratio=None,
                base_cost_ratio=None,
            )
        )
    return tuple(windows)


def synthetic_q14_sample_set(*, count: int = FIXTURE_COUNT) -> SampleSetV1:
    """Project causal fixture metadata into the accepted Q14 sample contract."""

    windows = synthetic_sequence_windows(count=count)
    return SampleSetV1(
        dataset_id=f"q13-synthetic-lineage-probe-{count}",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(window.as_validation_sample() for window in windows),
    )


def interface_fixture_mapping() -> dict[str, object]:
    windows = synthetic_sequence_windows()
    sample_set = synthetic_q14_sample_set()
    return {
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSeed": str(FIXTURE_SEED),
        "q14SampleSetSha256": sample_set.digest().hexdigest,
        "schema": "Q13DeepInterfaceFixtureV1",
        "sequenceCount": len(windows),
        "sequenceDigests": [window.digest().hexdigest for window in windows],
        "version": 1,
    }


def interface_fixture_digest() -> DigestV1:
    return DigestV1(
        hexdigest=hashlib.sha256(canonical_json_bytes(interface_fixture_mapping())).hexdigest()
    )
