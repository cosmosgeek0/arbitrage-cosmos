from __future__ import annotations

from research.dq3 import (
    SCHEMA_V1,
    ResearchPhase,
    TrialAttemptV1,
    TrialSeriesCoordinatesV1,
    TrialStatus,
    build_pbo_coordinates_v1,
    build_white_max_t_coordinates_v1,
    derive_seed_v1,
    expand_white_replicate_v1,
    pbo_trial_coordinates_v1,
    validate_statistical_coordinates_v1,
    white_trial_coordinates_v1,
)

FAMILY_ID = "family-a"
MASTER_SEED = 20_260_730
OBSERVATION_IDS = (
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-04",
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
    "2026-01-08",
)


def known_answer_projection_v1() -> dict[str, object]:
    attempts = (
        TrialAttemptV1("trial-alpha", TrialStatus.COMPLETED),
        TrialAttemptV1("trial-beta", TrialStatus.COMPLETED),
        TrialAttemptV1("trial-gamma", TrialStatus.FAILED),
    )
    series = (
        TrialSeriesCoordinatesV1(
            "trial-alpha",
            ResearchPhase.DEVELOPMENT,
            OBSERVATION_IDS,
        ),
        TrialSeriesCoordinatesV1(
            "trial-beta",
            ResearchPhase.DEVELOPMENT,
            OBSERVATION_IDS,
        ),
        TrialSeriesCoordinatesV1(
            "trial-gamma",
            ResearchPhase.DEVELOPMENT,
            OBSERVATION_IDS,
        ),
    )
    white_plan = build_white_max_t_coordinates_v1(
        family_id=FAMILY_ID,
        master_seed=MASTER_SEED,
        observation_ids=OBSERVATION_IDS,
        block_length=2,
        replicate_count=4,
    )
    pbo_plan = build_pbo_coordinates_v1(
        family_id=FAMILY_ID,
        observation_ids=OBSERVATION_IDS,
        block_count=4,
    )
    receipt = validate_statistical_coordinates_v1(
        schema=SCHEMA_V1,
        family_id=FAMILY_ID,
        phase=ResearchPhase.DEVELOPMENT,
        master_seed=MASTER_SEED,
        attempts=attempts,
        multiplicity_trial_ids=("trial-alpha", "trial-beta", "trial-gamma"),
        raw_pvalue_trial_ids=("trial-alpha", "trial-beta"),
        series=series,
        white_block_length=2,
        white_replicate_count=4,
        white_plan=white_plan,
        white_trial_coordinates=(
            white_trial_coordinates_v1("trial-alpha", plan=white_plan),
            white_trial_coordinates_v1("trial-beta", plan=white_plan),
            white_trial_coordinates_v1("trial-gamma", plan=white_plan),
        ),
        pbo_block_count=4,
        pbo_plan=pbo_plan,
        pbo_trial_coordinates=(
            pbo_trial_coordinates_v1("trial-alpha", plan=pbo_plan),
            pbo_trial_coordinates_v1("trial-beta", plan=pbo_plan),
            pbo_trial_coordinates_v1("trial-gamma", plan=pbo_plan),
        ),
        holdout_opened=False,
        holdout_feedback_count=0,
    )
    seed_kat = derive_seed_v1(
        MASTER_SEED,
        family_id=FAMILY_ID,
        phase=ResearchPhase.DEVELOPMENT,
        purpose="WHITE_MAX_T",
    )
    return {
        "fixture": {
            "familyId": FAMILY_ID,
            "masterSeed": str(MASTER_SEED),
            "observationIds": list(OBSERVATION_IDS),
        },
        "pbo": {
            "blockCoordinateDigests": list(pbo_plan.block_coordinate_digests),
            "coordinateDigest": pbo_plan.coordinate_digest,
            "splitCoordinateDigests": list(pbo_plan.split_coordinate_digests),
            "splits": [
                {
                    "inSampleBlocks": list(in_sample),
                    "outOfSampleBlocks": list(out_of_sample),
                }
                for in_sample, out_of_sample in pbo_plan.splits
            ],
        },
        "receipt": receipt.as_dict(),
        "schema": "cosmos.dq3.known-answer.v1",
        "seedKat": {
            "derivedSeedHex": f"{seed_kat:032x}",
            "purpose": "WHITE_MAX_T",
        },
        "white": {
            "coordinateDigest": white_plan.coordinate_digest,
            "derivedSeedHex": f"{white_plan.derived_seed:032x}",
            "firstReplicateBlockStarts": list(white_plan.replicate_block_starts[0]),
            "firstReplicateIndices": list(expand_white_replicate_v1(white_plan, 0)),
            "replicateCoordinateDigests": list(white_plan.replicate_coordinate_digests),
        },
    }
