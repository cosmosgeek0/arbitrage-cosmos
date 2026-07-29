from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from itertools import combinations
from math import ceil
from typing import Final, NoReturn

SCHEMA_V1: Final = "cosmos.dq3.statistical-coordinates.v1"

_SEED_DOMAIN: Final = b"cosmos-dq3-derived-seed-v1\0"
_OBSERVATION_DOMAIN: Final = b"cosmos-dq3-observation-grid-v1\0"
_WHITE_REPLICATE_DOMAIN: Final = b"cosmos-dq3-white-replicate-v1\0"
_WHITE_PLAN_DOMAIN: Final = b"cosmos-dq3-white-plan-v1\0"
_PBO_BLOCK_DOMAIN: Final = b"cosmos-dq3-pbo-block-v1\0"
_PBO_SPLIT_DOMAIN: Final = b"cosmos-dq3-pbo-split-v1\0"
_PBO_PLAN_DOMAIN: Final = b"cosmos-dq3-pbo-plan-v1\0"
_RECEIPT_DOMAIN: Final = b"cosmos-dq3-coordinate-receipt-v1\0"

_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@+\-/]{0,127}$")
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
_UINT128_HEX_PATTERN: Final = re.compile(r"^[0-9a-f]{32}$")
_UINT128_MAX: Final = (1 << 128) - 1
_UINT256_MODULUS: Final = 1 << 256
_MAX_TRIALS: Final = 256
_MAX_OBSERVATIONS: Final = 100_000
_MAX_REPLICATES: Final = 65_536
_MAX_WHITE_START_CELLS: Final = 4_194_304
_MAX_REJECTION_DRAWS: Final = 1_024
_MAX_PBO_BLOCKS: Final = 16
_HOLDOUT_POLICY: Final = "SINGLE_CHAMPION_AFTER_DEVELOPMENT_GATE"
_WHITE_PURPOSE: Final = "WHITE_MAX_T_SHARED_COORDINATES"


class CoordinateContractError(ValueError):
    """A stable, fail-closed DQ-3 contract failure."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


class ResearchPhase(StrEnum):
    DEVELOPMENT = "DEVELOPMENT"
    HOLDOUT = "HOLDOUT"


class TrialStatus(StrEnum):
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    ABANDONED = "ABANDONED"


class PboTiePolicy(StrEnum):
    FAIL_CLOSED = "FAIL_CLOSED"


@dataclass(frozen=True, slots=True)
class TrialAttemptV1:
    trial_id: str
    status: TrialStatus


@dataclass(frozen=True, slots=True)
class TrialSeriesCoordinatesV1:
    trial_id: str
    phase: ResearchPhase
    observation_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WhiteTrialCoordinatesV1:
    trial_id: str
    phase: ResearchPhase
    replicate_coordinate_digests: tuple[str, ...]
    shared_coordinate_digest: str


@dataclass(frozen=True, slots=True)
class PboTrialCoordinatesV1:
    trial_id: str
    phase: ResearchPhase
    block_coordinate_digests: tuple[str, ...]
    split_coordinate_digests: tuple[str, ...]
    shared_coordinate_digest: str


@dataclass(frozen=True, slots=True)
class WhiteMaxTCoordinatesV1:
    family_id: str
    observation_grid_digest: str
    sample_count: int
    block_length: int
    replicate_count: int
    derived_seed: int
    replicate_block_starts: tuple[tuple[int, ...], ...]
    replicate_coordinate_digests: tuple[str, ...]
    coordinate_digest: str


@dataclass(frozen=True, slots=True)
class PboCoordinatesV1:
    family_id: str
    observation_grid_digest: str
    sample_count: int
    block_count: int
    block_ranges: tuple[tuple[int, int], ...]
    block_coordinate_digests: tuple[str, ...]
    splits: tuple[tuple[tuple[int, ...], tuple[int, ...]], ...]
    split_coordinate_digests: tuple[str, ...]
    tie_policy: PboTiePolicy
    coordinate_digest: str


@dataclass(frozen=True, slots=True)
class CoordinateReceiptV1:
    schema: str
    family_id: str
    phase: ResearchPhase
    trial_statuses: tuple[tuple[str, str], ...]
    attempted_trial_ids: tuple[str, ...]
    completed_trial_ids: tuple[str, ...]
    noncompleted_trial_ids: tuple[str, ...]
    multiplicity_trial_ids: tuple[str, ...]
    raw_pvalue_trial_ids: tuple[str, ...]
    effective_pvalue_trial_ids: tuple[str, ...]
    noncompleted_effective_pvalue: str
    observation_grid_digest: str
    white_coordinate_digest: str
    white_derived_seed_hex: str
    pbo_coordinate_digest: str
    pbo_evaluation_status: str
    pbo_split_count: int
    pbo_tie_policy: PboTiePolicy
    holdout_policy: str
    holdout_opened: bool
    holdout_feedback_count: int
    authority: str
    receipt_digest: str

    def as_dict(self) -> dict[str, object]:
        return {
            "attemptedTrialIds": list(self.attempted_trial_ids),
            "authority": self.authority,
            "completedTrialIds": list(self.completed_trial_ids),
            "effectivePvalueTrialIds": list(self.effective_pvalue_trial_ids),
            "familyId": self.family_id,
            "holdoutFeedbackCount": self.holdout_feedback_count,
            "holdoutOpened": self.holdout_opened,
            "holdoutPolicy": self.holdout_policy,
            "multiplicityTrialIds": list(self.multiplicity_trial_ids),
            "noncompletedEffectivePvalue": self.noncompleted_effective_pvalue,
            "noncompletedTrialIds": list(self.noncompleted_trial_ids),
            "observationGridDigest": self.observation_grid_digest,
            "pboCoordinateDigest": self.pbo_coordinate_digest,
            "pboEvaluationStatus": self.pbo_evaluation_status,
            "pboSplitCount": self.pbo_split_count,
            "pboTiePolicy": self.pbo_tie_policy.value,
            "phase": self.phase.value,
            "rawPvalueTrialIds": list(self.raw_pvalue_trial_ids),
            "receiptDigest": self.receipt_digest,
            "schema": self.schema,
            "trialStatuses": [
                {"status": status, "trialId": trial_id} for trial_id, status in self.trial_statuses
            ],
            "whiteCoordinateDigest": self.white_coordinate_digest,
            "whiteDerivedSeedHex": self.white_derived_seed_hex,
        }

    def canonical_bytes(self) -> bytes:
        return _canonical_json_bytes(self.as_dict())


def _fail(code: str, detail: str) -> NoReturn:
    raise CoordinateContractError(code, detail)


def _canonical_json_bytes(value: object) -> bytes:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise CoordinateContractError(
            "CANONICAL_JSON_INVALID", "value is outside the frozen JSON domain"
        ) from error
    return f"{encoded}\n".encode("utf-8", errors="strict")


def _digest(domain: bytes, value: object) -> str:
    return hashlib.sha256(domain + _canonical_json_bytes(value)).hexdigest()


def _require_id(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _ID_PATTERN.fullmatch(value) is None:
        _fail("ID_INVALID", f"{field} must match the frozen ASCII identifier contract")
    return value


def _require_sha256(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        _fail("DIGEST_INVALID", f"{field} must be lowercase SHA-256 hex")
    return value


def _require_int(value: object, *, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail("INTEGER_INVALID", f"{field} must be a strict integer")
    if not minimum <= value <= maximum:
        _fail("INTEGER_OUT_OF_RANGE", f"{field} must be in [{minimum}, {maximum}]")
    return value


def _require_phase(value: object, *, field: str) -> ResearchPhase:
    if not isinstance(value, ResearchPhase):
        _fail("PHASE_INVALID", f"{field} must be a ResearchPhase value")
    return value


def _require_tuple(value: object, *, field: str) -> tuple[object, ...]:
    if not isinstance(value, tuple):
        _fail("TUPLE_REQUIRED", f"{field} must be an immutable tuple")
    return value


def _canonical_ids(
    values: object,
    *,
    field: str,
    minimum: int,
    maximum: int,
) -> tuple[str, ...]:
    raw_values = _require_tuple(values, field=field)
    if not minimum <= len(raw_values) <= maximum:
        _fail(
            "CARDINALITY_INVALID",
            f"{field} cardinality must be in [{minimum}, {maximum}]",
        )
    checked = tuple(
        _require_id(value, field=f"{field}[{index}]") for index, value in enumerate(raw_values)
    )
    if len(set(checked)) != len(checked):
        _fail("DUPLICATE_ID", f"{field} contains a duplicate identifier")
    return tuple(sorted(checked))


def _observation_ids(values: object, *, field: str) -> tuple[str, ...]:
    raw_values = _require_tuple(values, field=field)
    if not 4 <= len(raw_values) <= _MAX_OBSERVATIONS:
        _fail(
            "CARDINALITY_INVALID",
            f"{field} cardinality must be in [4, {_MAX_OBSERVATIONS}]",
        )
    checked = tuple(
        _require_id(value, field=f"{field}[{index}]") for index, value in enumerate(raw_values)
    )
    if len(set(checked)) != len(checked):
        _fail("DUPLICATE_ID", f"{field} contains a duplicate identifier")
    return checked


def _observation_grid_digest(observation_ids: tuple[str, ...]) -> str:
    return _digest(
        _OBSERVATION_DOMAIN,
        {"observationIds": list(observation_ids), "version": 1},
    )


def derive_seed_v1(
    master_seed: int,
    *,
    family_id: str,
    phase: ResearchPhase,
    purpose: str,
    trial_id: str | None = None,
) -> int:
    """Derive a semantic, order-independent unsigned 128-bit seed."""

    checked_master_seed = _require_int(
        master_seed,
        field="master_seed",
        minimum=0,
        maximum=_UINT128_MAX,
    )
    checked_family_id = _require_id(family_id, field="family_id")
    checked_phase = _require_phase(phase, field="phase")
    checked_purpose = _require_id(purpose, field="purpose")
    checked_trial_id = None if trial_id is None else _require_id(trial_id, field="trial_id")
    payload = {
        "familyId": checked_family_id,
        "masterSeed": str(checked_master_seed),
        "phase": checked_phase.value,
        "purpose": checked_purpose,
        "trialId": checked_trial_id,
        "version": 1,
    }
    digest = hashlib.sha256(_SEED_DOMAIN + _canonical_json_bytes(payload)).digest()
    return int.from_bytes(digest[:16], byteorder="big", signed=False)


def _uniform_index(
    *,
    derived_seed: int,
    sample_count: int,
    replicate_index: int,
    block_index: int,
) -> int:
    acceptance_limit = _UINT256_MODULUS - (_UINT256_MODULUS % sample_count)
    for rejection in range(_MAX_REJECTION_DRAWS):
        payload = {
            "blockIndex": block_index,
            "derivedSeedHex": f"{derived_seed:032x}",
            "rejection": rejection,
            "replicateIndex": replicate_index,
            "sampleCount": sample_count,
            "version": 1,
        }
        candidate = int.from_bytes(
            hashlib.sha256(
                b"cosmos-dq3-white-index-v1\0" + _canonical_json_bytes(payload)
            ).digest(),
            byteorder="big",
            signed=False,
        )
        if candidate < acceptance_limit:
            return candidate % sample_count
    _fail(
        "WHITE_REJECTION_SAMPLER_EXHAUSTED",
        "bounded SHA-256 rejection sampler did not produce a coordinate",
    )


def _white_replicate_digest(
    *,
    family_id: str,
    observation_grid_digest: str,
    sample_count: int,
    block_length: int,
    replicate_index: int,
    block_starts: tuple[int, ...],
) -> str:
    return _digest(
        _WHITE_REPLICATE_DOMAIN,
        {
            "blockLength": block_length,
            "blockStarts": list(block_starts),
            "familyId": family_id,
            "observationGridDigest": observation_grid_digest,
            "replicateIndex": replicate_index,
            "sampleCount": sample_count,
            "version": 1,
        },
    )


def _white_plan_digest(
    *,
    family_id: str,
    observation_grid_digest: str,
    sample_count: int,
    block_length: int,
    replicate_count: int,
    derived_seed: int,
    replicate_coordinate_digests: tuple[str, ...],
) -> str:
    return _digest(
        _WHITE_PLAN_DOMAIN,
        {
            "algorithm": "SHA256_REJECTION_CIRCULAR_BLOCK_V1",
            "blockLength": block_length,
            "derivedSeedHex": f"{derived_seed:032x}",
            "familyId": family_id,
            "observationGridDigest": observation_grid_digest,
            "replicateCoordinateDigests": list(replicate_coordinate_digests),
            "replicateCount": replicate_count,
            "sampleCount": sample_count,
            "version": 1,
        },
    )


def _validated_white_plan(plan: object) -> WhiteMaxTCoordinatesV1:
    if type(plan) is not WhiteMaxTCoordinatesV1:
        _fail("WHITE_PLAN_INVALID", "plan must be an exact WhiteMaxTCoordinatesV1")
    checked = plan
    family_id = _require_id(checked.family_id, field="plan.family_id")
    observation_digest = _require_sha256(
        checked.observation_grid_digest,
        field="plan.observation_grid_digest",
    )
    _require_sha256(checked.coordinate_digest, field="plan.coordinate_digest")

    if (
        type(checked.sample_count) is not int
        or not 4 <= checked.sample_count <= _MAX_OBSERVATIONS
        or type(checked.block_length) is not int
        or not 1 <= checked.block_length <= checked.sample_count
        or type(checked.replicate_count) is not int
        or not 1 <= checked.replicate_count <= _MAX_REPLICATES
        or type(checked.derived_seed) is not int
        or not 0 <= checked.derived_seed <= _UINT128_MAX
    ):
        _fail("WHITE_PLAN_GEOMETRY_INVALID", "plan scalar geometry is outside the v1 domain")

    blocks_per_replicate = ceil(checked.sample_count / checked.block_length)
    if blocks_per_replicate * checked.replicate_count > _MAX_WHITE_START_CELLS:
        _fail("WHITE_PLAN_GEOMETRY_INVALID", "plan exceeds the v1 coordinate capacity")
    if (
        type(checked.replicate_block_starts) is not tuple
        or len(checked.replicate_block_starts) != checked.replicate_count
        or type(checked.replicate_coordinate_digests) is not tuple
        or len(checked.replicate_coordinate_digests) != checked.replicate_count
    ):
        _fail("WHITE_PLAN_GEOMETRY_INVALID", "replicate rows must match replicate_count")

    recomputed_digests: list[str] = []
    for replicate_index, starts in enumerate(checked.replicate_block_starts):
        if type(starts) is not tuple or len(starts) != blocks_per_replicate:
            _fail(
                "WHITE_PLAN_GEOMETRY_INVALID",
                "each replicate must contain the exact circular-block start count",
            )
        for start in starts:
            if type(start) is not int or not 0 <= start < checked.sample_count:
                _fail(
                    "WHITE_PLAN_GEOMETRY_INVALID",
                    "every block start must be a strict in-range integer",
                )
        supplied_digest = _require_sha256(
            checked.replicate_coordinate_digests[replicate_index],
            field=f"plan.replicate_coordinate_digests[{replicate_index}]",
        )
        recomputed_digest = _white_replicate_digest(
            family_id=family_id,
            observation_grid_digest=observation_digest,
            sample_count=checked.sample_count,
            block_length=checked.block_length,
            replicate_index=replicate_index,
            block_starts=starts,
        )
        if supplied_digest != recomputed_digest:
            _fail(
                "WHITE_REPLICATE_DIGEST_MISMATCH",
                "replicate block starts do not match their frozen digest",
            )
        expected_starts = tuple(
            _uniform_index(
                derived_seed=checked.derived_seed,
                sample_count=checked.sample_count,
                replicate_index=replicate_index,
                block_index=block_index,
            )
            for block_index in range(blocks_per_replicate)
        )
        if starts != expected_starts:
            _fail(
                "WHITE_SEED_COORDINATE_MISMATCH",
                "replicate starts do not match the declared derived seed",
            )
        recomputed_digests.append(recomputed_digest)

    expected_plan_digest = _white_plan_digest(
        family_id=family_id,
        observation_grid_digest=observation_digest,
        sample_count=checked.sample_count,
        block_length=checked.block_length,
        replicate_count=checked.replicate_count,
        derived_seed=checked.derived_seed,
        replicate_coordinate_digests=tuple(recomputed_digests),
    )
    if checked.coordinate_digest != expected_plan_digest:
        _fail(
            "WHITE_PLAN_DIGEST_MISMATCH",
            "White plan fields do not match the frozen coordinate digest",
        )
    return checked


def build_white_max_t_coordinates_v1(
    *,
    family_id: str,
    master_seed: int,
    observation_ids: tuple[str, ...],
    block_length: int,
    replicate_count: int,
) -> WhiteMaxTCoordinatesV1:
    """Build one shared circular fixed-block plan for every completed trial."""

    checked_family_id = _require_id(family_id, field="family_id")
    checked_observations = _observation_ids(
        observation_ids,
        field="observation_ids",
    )
    sample_count = len(checked_observations)
    checked_block_length = _require_int(
        block_length,
        field="block_length",
        minimum=1,
        maximum=sample_count,
    )
    checked_replicate_count = _require_int(
        replicate_count,
        field="replicate_count",
        minimum=1,
        maximum=_MAX_REPLICATES,
    )
    blocks_per_replicate = ceil(sample_count / checked_block_length)
    if blocks_per_replicate * checked_replicate_count > _MAX_WHITE_START_CELLS:
        _fail(
            "WHITE_COORDINATE_CAPACITY_EXCEEDED",
            "replicate block-start grid exceeds the frozen capacity",
        )
    checked_master_seed = _require_int(
        master_seed,
        field="master_seed",
        minimum=0,
        maximum=_UINT128_MAX,
    )
    derived_seed = derive_seed_v1(
        checked_master_seed,
        family_id=checked_family_id,
        phase=ResearchPhase.DEVELOPMENT,
        purpose=_WHITE_PURPOSE,
        trial_id=None,
    )
    observation_digest = _observation_grid_digest(checked_observations)

    starts: list[tuple[int, ...]] = []
    replicate_digests: list[str] = []
    for replicate_index in range(checked_replicate_count):
        replicate_starts = tuple(
            _uniform_index(
                derived_seed=derived_seed,
                sample_count=sample_count,
                replicate_index=replicate_index,
                block_index=block_index,
            )
            for block_index in range(blocks_per_replicate)
        )
        starts.append(replicate_starts)
        replicate_digests.append(
            _white_replicate_digest(
                family_id=checked_family_id,
                observation_grid_digest=observation_digest,
                sample_count=sample_count,
                block_length=checked_block_length,
                replicate_index=replicate_index,
                block_starts=replicate_starts,
            )
        )

    coordinate_digest = _white_plan_digest(
        family_id=checked_family_id,
        observation_grid_digest=observation_digest,
        sample_count=sample_count,
        block_length=checked_block_length,
        replicate_count=checked_replicate_count,
        derived_seed=derived_seed,
        replicate_coordinate_digests=tuple(replicate_digests),
    )
    return WhiteMaxTCoordinatesV1(
        family_id=checked_family_id,
        observation_grid_digest=observation_digest,
        sample_count=sample_count,
        block_length=checked_block_length,
        replicate_count=checked_replicate_count,
        derived_seed=derived_seed,
        replicate_block_starts=tuple(starts),
        replicate_coordinate_digests=tuple(replicate_digests),
        coordinate_digest=coordinate_digest,
    )


def expand_white_replicate_v1(
    plan: object,
    replicate_index: int,
) -> tuple[int, ...]:
    """Expand one shared circular-block coordinate into sample indices."""

    checked_plan = _validated_white_plan(plan)
    checked_index = _require_int(
        replicate_index,
        field="replicate_index",
        minimum=0,
        maximum=checked_plan.replicate_count - 1,
    )
    starts = checked_plan.replicate_block_starts[checked_index]
    expanded: list[int] = []
    for start in starts:
        for offset in range(checked_plan.block_length):
            if len(expanded) == checked_plan.sample_count:
                return tuple(expanded)
            expanded.append((start + offset) % checked_plan.sample_count)
    if len(expanded) != checked_plan.sample_count:
        _fail("WHITE_PLAN_INVALID", "block starts do not cover the sample count")
    return tuple(expanded)


def white_trial_coordinates_v1(
    trial_id: str,
    *,
    plan: object,
) -> WhiteTrialCoordinatesV1:
    checked_plan = _validated_white_plan(plan)
    return WhiteTrialCoordinatesV1(
        trial_id=_require_id(trial_id, field="trial_id"),
        phase=ResearchPhase.DEVELOPMENT,
        replicate_coordinate_digests=checked_plan.replicate_coordinate_digests,
        shared_coordinate_digest=checked_plan.coordinate_digest,
    )


def build_pbo_coordinates_v1(
    *,
    family_id: str,
    observation_ids: tuple[str, ...],
    block_count: int,
    tie_policy: object = PboTiePolicy.FAIL_CLOSED,
) -> PboCoordinatesV1:
    """Build the complete CSCV development block grid and all complements."""

    checked_family_id = _require_id(family_id, field="family_id")
    checked_observations = _observation_ids(
        observation_ids,
        field="observation_ids",
    )
    sample_count = len(checked_observations)
    checked_block_count = _require_int(
        block_count,
        field="block_count",
        minimum=4,
        maximum=_MAX_PBO_BLOCKS,
    )
    if checked_block_count % 2 != 0:
        _fail("PBO_BLOCK_COUNT_INVALID", "block_count must be even")
    if sample_count % checked_block_count != 0:
        _fail(
            "PBO_BLOCK_GRID_INVALID",
            "observation count must divide into equal nonempty blocks",
        )
    if not isinstance(tie_policy, PboTiePolicy) or tie_policy is not PboTiePolicy.FAIL_CLOSED:
        _fail("PBO_TIE_POLICY_INVALID", "only FAIL_CLOSED is accepted")

    block_size = sample_count // checked_block_count
    observation_digest = _observation_grid_digest(checked_observations)
    block_ranges: list[tuple[int, int]] = []
    block_digests: list[str] = []
    for block_index in range(checked_block_count):
        start = block_index * block_size
        stop = start + block_size
        block_ranges.append((start, stop))
        block_digests.append(
            _digest(
                _PBO_BLOCK_DOMAIN,
                {
                    "blockIndex": block_index,
                    "familyId": checked_family_id,
                    "observationGridDigest": observation_digest,
                    "observationIds": list(checked_observations[start:stop]),
                    "start": start,
                    "stop": stop,
                    "version": 1,
                },
            )
        )

    all_blocks = tuple(range(checked_block_count))
    splits: list[tuple[tuple[int, ...], tuple[int, ...]]] = []
    split_digests: list[str] = []
    for split_index, in_sample in enumerate(combinations(all_blocks, checked_block_count // 2)):
        in_sample_set = set(in_sample)
        out_of_sample = tuple(
            block_index for block_index in all_blocks if block_index not in in_sample_set
        )
        splits.append((in_sample, out_of_sample))
        split_digests.append(
            _digest(
                _PBO_SPLIT_DOMAIN,
                {
                    "blockCoordinateDigests": block_digests,
                    "familyId": checked_family_id,
                    "inSampleBlocks": list(in_sample),
                    "outOfSampleBlocks": list(out_of_sample),
                    "splitIndex": split_index,
                    "version": 1,
                },
            )
        )

    coordinate_digest = _digest(
        _PBO_PLAN_DOMAIN,
        {
            "blockCoordinateDigests": block_digests,
            "blockCount": checked_block_count,
            "familyId": checked_family_id,
            "observationGridDigest": observation_digest,
            "sampleCount": sample_count,
            "splitCoordinateDigests": split_digests,
            "tiePolicy": tie_policy.value,
            "version": 1,
        },
    )
    return PboCoordinatesV1(
        family_id=checked_family_id,
        observation_grid_digest=observation_digest,
        sample_count=sample_count,
        block_count=checked_block_count,
        block_ranges=tuple(block_ranges),
        block_coordinate_digests=tuple(block_digests),
        splits=tuple(splits),
        split_coordinate_digests=tuple(split_digests),
        tie_policy=tie_policy,
        coordinate_digest=coordinate_digest,
    )


def pbo_trial_coordinates_v1(
    trial_id: str,
    *,
    plan: object,
) -> PboTrialCoordinatesV1:
    if not isinstance(plan, PboCoordinatesV1):
        _fail("PBO_PLAN_INVALID", "plan must be PboCoordinatesV1")
    return PboTrialCoordinatesV1(
        trial_id=_require_id(trial_id, field="trial_id"),
        phase=ResearchPhase.DEVELOPMENT,
        block_coordinate_digests=plan.block_coordinate_digests,
        split_coordinate_digests=plan.split_coordinate_digests,
        shared_coordinate_digest=plan.coordinate_digest,
    )


def _receipt_ids(
    values: object,
    *,
    field: str,
    minimum: int,
) -> tuple[str, ...]:
    raw_values = _require_tuple(values, field=field)
    canonical = _canonical_ids(
        raw_values,
        field=field,
        minimum=minimum,
        maximum=_MAX_TRIALS,
    )
    if raw_values != canonical:
        _fail("RECEIPT_INVALID", f"{field} must be in canonical order")
    return canonical


def _validated_pbo_receipt_trial_ids(
    receipt: object,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    if type(receipt) is not CoordinateReceiptV1:
        _fail("PBO_RECEIPT_INVALID", "receipt must be an exact CoordinateReceiptV1")
    checked = receipt

    if checked.schema != SCHEMA_V1:
        _fail("RECEIPT_INVALID", "receipt schema is not v1")
    _require_id(checked.family_id, field="receipt.family_id")
    if checked.phase is not ResearchPhase.DEVELOPMENT:
        _fail("RECEIPT_INVALID", "receipt phase must be DEVELOPMENT")
    if (
        checked.holdout_policy != _HOLDOUT_POLICY
        or checked.holdout_opened is not False
        or type(checked.holdout_feedback_count) is not int
        or checked.holdout_feedback_count != 0
        or checked.authority != "NONE"
    ):
        _fail("RECEIPT_INVALID", "receipt violates the unopened development boundary")
    if (
        checked.pbo_tie_policy is not PboTiePolicy.FAIL_CLOSED
        or checked.noncompleted_effective_pvalue != "1"
    ):
        _fail("RECEIPT_INVALID", "receipt violates the frozen PBO or multiplicity policy")

    attempted_ids = _receipt_ids(
        checked.attempted_trial_ids,
        field="receipt.attempted_trial_ids",
        minimum=2,
    )
    completed_ids = _receipt_ids(
        checked.completed_trial_ids,
        field="receipt.completed_trial_ids",
        minimum=2,
    )
    noncompleted_ids = _receipt_ids(
        checked.noncompleted_trial_ids,
        field="receipt.noncompleted_trial_ids",
        minimum=0,
    )
    multiplicity_ids = _receipt_ids(
        checked.multiplicity_trial_ids,
        field="receipt.multiplicity_trial_ids",
        minimum=2,
    )
    raw_pvalue_ids = _receipt_ids(
        checked.raw_pvalue_trial_ids,
        field="receipt.raw_pvalue_trial_ids",
        minimum=2,
    )
    effective_pvalue_ids = _receipt_ids(
        checked.effective_pvalue_trial_ids,
        field="receipt.effective_pvalue_trial_ids",
        minimum=2,
    )
    if (
        multiplicity_ids != attempted_ids
        or effective_pvalue_ids != attempted_ids
        or raw_pvalue_ids != completed_ids
        or tuple(sorted((*completed_ids, *noncompleted_ids))) != attempted_ids
        or set(completed_ids).intersection(noncompleted_ids)
    ):
        _fail("RECEIPT_FAMILY_MISMATCH", "receipt trial identities are inconsistent")

    raw_statuses = _require_tuple(checked.trial_statuses, field="receipt.trial_statuses")
    if len(raw_statuses) != len(attempted_ids):
        _fail("RECEIPT_FAMILY_MISMATCH", "receipt status count does not match attempts")
    statuses: list[tuple[str, TrialStatus]] = []
    for index, entry in enumerate(raw_statuses):
        if type(entry) is not tuple or len(entry) != 2:
            _fail("RECEIPT_INVALID", f"receipt.trial_statuses[{index}] is malformed")
        trial_id = _require_id(entry[0], field=f"receipt.trial_statuses[{index}].trial_id")
        status_value = entry[1]
        if type(status_value) is not str:
            _fail("RECEIPT_INVALID", f"{trial_id} status must be a v1 string")
        try:
            status = TrialStatus(status_value)
        except ValueError as error:
            raise CoordinateContractError(
                "RECEIPT_INVALID", f"{trial_id} status is outside the v1 domain"
            ) from error
        statuses.append((trial_id, status))
    if tuple(trial_id for trial_id, _ in statuses) != attempted_ids:
        _fail("RECEIPT_FAMILY_MISMATCH", "receipt statuses must use canonical attempts")
    status_completed = tuple(
        trial_id for trial_id, status in statuses if status is TrialStatus.COMPLETED
    )
    status_noncompleted = tuple(
        trial_id for trial_id, status in statuses if status is not TrialStatus.COMPLETED
    )
    if status_completed != completed_ids or status_noncompleted != noncompleted_ids:
        _fail("RECEIPT_FAMILY_MISMATCH", "receipt statuses disagree with trial partitions")

    _require_sha256(
        checked.observation_grid_digest,
        field="receipt.observation_grid_digest",
    )
    _require_sha256(
        checked.white_coordinate_digest,
        field="receipt.white_coordinate_digest",
    )
    _require_sha256(
        checked.pbo_coordinate_digest,
        field="receipt.pbo_coordinate_digest",
    )
    _require_sha256(checked.receipt_digest, field="receipt.receipt_digest")
    if (
        type(checked.white_derived_seed_hex) is not str
        or _UINT128_HEX_PATTERN.fullmatch(checked.white_derived_seed_hex) is None
    ):
        _fail("RECEIPT_INVALID", "receipt White seed must be lowercase uint128 hex")
    _require_int(
        checked.pbo_split_count,
        field="receipt.pbo_split_count",
        minimum=1,
        maximum=12_870,
    )

    expected_pbo_status = (
        "UNMEASURED_INCOMPLETE_TRIAL_FAMILY" if noncompleted_ids else "COORDINATES_VALIDATED"
    )
    if checked.pbo_evaluation_status != expected_pbo_status:
        _fail("RECEIPT_INVALID", "receipt PBO status disagrees with trial completion")

    receipt_payload = checked.as_dict()
    receipt_payload.pop("receiptDigest")
    if _digest(_RECEIPT_DOMAIN, receipt_payload) != checked.receipt_digest:
        _fail("RECEIPT_DIGEST_MISMATCH", "receipt fields do not match the frozen digest")
    return attempted_ids, noncompleted_ids


def validate_pbo_rank_row_v1(
    scores: Mapping[str, object],
    *,
    receipt: object,
) -> tuple[str, ...]:
    """Validate one receipt-bound OOS rank row; invalid rows are unmeasured."""

    if type(scores) is not dict:
        _fail("PBO_SCORE_ROW_INVALID", "scores must be an ordinary dict")
    expected, noncompleted = _validated_pbo_receipt_trial_ids(receipt)
    if noncompleted:
        _fail(
            "PBO_UNMEASURED_INCOMPLETE_TRIAL_FAMILY",
            "PBO ranking requires every attempted trial to be completed",
        )
    actual = _canonical_ids(
        tuple(scores),
        field="scores.keys",
        minimum=2,
        maximum=_MAX_TRIALS,
    )
    if actual != expected:
        _fail("PBO_SCORE_FAMILY_MISMATCH", "score identities must equal the trial family")
    checked: list[tuple[str, Decimal]] = []
    for trial_id in expected:
        score = scores[trial_id]
        if not isinstance(score, Decimal) or not score.is_finite():
            _fail("PBO_SCORE_INVALID", f"{trial_id} score must be a finite Decimal")
        checked.append((trial_id, score))
    if len({score for _, score in checked}) != len(checked):
        _fail("PBO_SCORE_TIE", "ties are fail-closed under the frozen policy")
    ranked = sorted(checked, key=lambda item: item[1], reverse=True)
    return tuple(trial_id for trial_id, _ in ranked)


def _attempt_contract(
    attempts: object,
) -> tuple[tuple[TrialAttemptV1, ...], tuple[str, ...], tuple[str, ...]]:
    raw_attempts = _require_tuple(attempts, field="attempts")
    if not 2 <= len(raw_attempts) <= _MAX_TRIALS:
        _fail(
            "ATTEMPT_CARDINALITY_INVALID",
            f"attempt count must be in [2, {_MAX_TRIALS}]",
        )
    checked: list[TrialAttemptV1] = []
    seen: set[str] = set()
    for index, attempt in enumerate(raw_attempts):
        if not isinstance(attempt, TrialAttemptV1):
            _fail("ATTEMPT_INVALID", f"attempts[{index}] must be TrialAttemptV1")
        trial_id = _require_id(attempt.trial_id, field=f"attempts[{index}].trial_id")
        if not isinstance(attempt.status, TrialStatus):
            _fail("TRIAL_STATUS_INVALID", f"{trial_id} has an invalid status")
        if trial_id in seen:
            _fail("DUPLICATE_TRIAL", f"duplicate attempt {trial_id}")
        seen.add(trial_id)
        checked.append(attempt)
    canonical = tuple(sorted(checked, key=lambda attempt: attempt.trial_id))
    completed = tuple(
        attempt.trial_id for attempt in canonical if attempt.status is TrialStatus.COMPLETED
    )
    if len(completed) < 2:
        _fail("COMPLETED_TRIALS_INSUFFICIENT", "at least two completed trials are required")
    noncompleted = tuple(
        attempt.trial_id for attempt in canonical if attempt.status is not TrialStatus.COMPLETED
    )
    return canonical, completed, noncompleted


def _series_contract(
    series: object,
    *,
    coordinate_trial_ids: tuple[str, ...],
) -> tuple[tuple[TrialSeriesCoordinatesV1, ...], tuple[str, ...]]:
    raw_series = _require_tuple(series, field="series")
    by_id: dict[str, TrialSeriesCoordinatesV1] = {}
    for index, item in enumerate(raw_series):
        if not isinstance(item, TrialSeriesCoordinatesV1):
            _fail("SERIES_INVALID", f"series[{index}] must be TrialSeriesCoordinatesV1")
        trial_id = _require_id(item.trial_id, field=f"series[{index}].trial_id")
        phase = _require_phase(item.phase, field=f"series[{index}].phase")
        if phase is not ResearchPhase.DEVELOPMENT:
            _fail("HOLDOUT_COORDINATE_FORBIDDEN", "holdout series cannot enter DQ-3")
        if trial_id in by_id:
            _fail("DUPLICATE_TRIAL", f"duplicate series {trial_id}")
        _observation_ids(item.observation_ids, field=f"series[{index}].observation_ids")
        by_id[trial_id] = item
    if tuple(sorted(by_id)) != coordinate_trial_ids:
        _fail(
            "SERIES_FAMILY_MISMATCH",
            "series identities must equal every attempted trial identity",
        )
    canonical = tuple(by_id[trial_id] for trial_id in coordinate_trial_ids)
    shared = canonical[0].observation_ids
    for item in canonical[1:]:
        if item.observation_ids != shared:
            _fail(
                "ASYNCHRONOUS_OBSERVATION_GRID",
                "every completed trial must use the same ordered development grid",
            )
    return canonical, shared


def _white_witness_contract(
    witnesses: object,
    *,
    coordinate_trial_ids: tuple[str, ...],
    expected_plan: WhiteMaxTCoordinatesV1,
) -> None:
    raw_witnesses = _require_tuple(witnesses, field="white_trial_coordinates")
    by_id: dict[str, WhiteTrialCoordinatesV1] = {}
    for index, witness in enumerate(raw_witnesses):
        if not isinstance(witness, WhiteTrialCoordinatesV1):
            _fail(
                "WHITE_WITNESS_INVALID",
                f"white_trial_coordinates[{index}] must be WhiteTrialCoordinatesV1",
            )
        trial_id = _require_id(
            witness.trial_id,
            field=f"white_trial_coordinates[{index}].trial_id",
        )
        phase = _require_phase(
            witness.phase,
            field=f"white_trial_coordinates[{index}].phase",
        )
        if phase is not ResearchPhase.DEVELOPMENT:
            _fail("HOLDOUT_COORDINATE_FORBIDDEN", "holdout White coordinates are forbidden")
        if trial_id in by_id:
            _fail("DUPLICATE_TRIAL", f"duplicate White witness {trial_id}")
        digests = _require_tuple(
            witness.replicate_coordinate_digests,
            field=f"white_trial_coordinates[{index}].replicate_coordinate_digests",
        )
        checked_digests = tuple(
            _require_sha256(
                digest,
                field=(
                    f"white_trial_coordinates[{index}].replicate_coordinate_digests[{digest_index}]"
                ),
            )
            for digest_index, digest in enumerate(digests)
        )
        _require_sha256(
            witness.shared_coordinate_digest,
            field=f"white_trial_coordinates[{index}].shared_coordinate_digest",
        )
        if checked_digests != expected_plan.replicate_coordinate_digests:
            _fail(
                "WHITE_MAX_T_PAIRING_MISMATCH",
                f"{trial_id} does not preserve the shared replicate order",
            )
        if witness.shared_coordinate_digest != expected_plan.coordinate_digest:
            _fail(
                "WHITE_MAX_T_PLAN_MISMATCH",
                f"{trial_id} does not bind the shared White plan",
            )
        by_id[trial_id] = witness
    if tuple(sorted(by_id)) != coordinate_trial_ids:
        _fail(
            "WHITE_FAMILY_MISMATCH",
            "White witnesses must equal every attempted trial identity",
        )


def _pbo_witness_contract(
    witnesses: object,
    *,
    coordinate_trial_ids: tuple[str, ...],
    expected_plan: PboCoordinatesV1,
) -> None:
    raw_witnesses = _require_tuple(witnesses, field="pbo_trial_coordinates")
    by_id: dict[str, PboTrialCoordinatesV1] = {}
    for index, witness in enumerate(raw_witnesses):
        if not isinstance(witness, PboTrialCoordinatesV1):
            _fail(
                "PBO_WITNESS_INVALID",
                f"pbo_trial_coordinates[{index}] must be PboTrialCoordinatesV1",
            )
        trial_id = _require_id(
            witness.trial_id,
            field=f"pbo_trial_coordinates[{index}].trial_id",
        )
        phase = _require_phase(
            witness.phase,
            field=f"pbo_trial_coordinates[{index}].phase",
        )
        if phase is not ResearchPhase.DEVELOPMENT:
            _fail("HOLDOUT_COORDINATE_FORBIDDEN", "holdout PBO coordinates are forbidden")
        if trial_id in by_id:
            _fail("DUPLICATE_TRIAL", f"duplicate PBO witness {trial_id}")
        block_digests = _require_tuple(
            witness.block_coordinate_digests,
            field=f"pbo_trial_coordinates[{index}].block_coordinate_digests",
        )
        checked_blocks = tuple(
            _require_sha256(
                digest,
                field=(f"pbo_trial_coordinates[{index}].block_coordinate_digests[{digest_index}]"),
            )
            for digest_index, digest in enumerate(block_digests)
        )
        split_digests = _require_tuple(
            witness.split_coordinate_digests,
            field=f"pbo_trial_coordinates[{index}].split_coordinate_digests",
        )
        checked_splits = tuple(
            _require_sha256(
                digest,
                field=(f"pbo_trial_coordinates[{index}].split_coordinate_digests[{digest_index}]"),
            )
            for digest_index, digest in enumerate(split_digests)
        )
        _require_sha256(
            witness.shared_coordinate_digest,
            field=f"pbo_trial_coordinates[{index}].shared_coordinate_digest",
        )
        if checked_blocks != expected_plan.block_coordinate_digests:
            _fail(
                "PBO_BLOCK_GRID_MISMATCH",
                f"{trial_id} does not preserve the shared ordered block grid",
            )
        if checked_splits != expected_plan.split_coordinate_digests:
            _fail(
                "PBO_SPLIT_GRID_MISMATCH",
                f"{trial_id} does not preserve every CSCV split and complement",
            )
        if witness.shared_coordinate_digest != expected_plan.coordinate_digest:
            _fail(
                "PBO_PLAN_MISMATCH",
                f"{trial_id} does not bind the shared PBO plan",
            )
        by_id[trial_id] = witness
    if tuple(sorted(by_id)) != coordinate_trial_ids:
        _fail(
            "PBO_FAMILY_MISMATCH",
            "PBO witnesses must equal every attempted trial identity",
        )


def validate_statistical_coordinates_v1(
    *,
    schema: str,
    family_id: str,
    phase: ResearchPhase,
    master_seed: int,
    attempts: tuple[TrialAttemptV1, ...],
    multiplicity_trial_ids: tuple[str, ...],
    raw_pvalue_trial_ids: tuple[str, ...],
    series: tuple[TrialSeriesCoordinatesV1, ...],
    white_block_length: int,
    white_replicate_count: int,
    white_plan: object,
    white_trial_coordinates: tuple[WhiteTrialCoordinatesV1, ...],
    pbo_block_count: int,
    pbo_plan: object,
    pbo_trial_coordinates: tuple[PboTrialCoordinatesV1, ...],
    holdout_opened: object,
    holdout_feedback_count: int,
) -> CoordinateReceiptV1:
    """Validate and seal one development-only statistical coordinate family."""

    if not isinstance(schema, str) or schema != SCHEMA_V1:
        _fail("SCHEMA_INVALID", f"schema must equal {SCHEMA_V1}")
    checked_family_id = _require_id(family_id, field="family_id")
    checked_phase = _require_phase(phase, field="phase")
    if checked_phase is not ResearchPhase.DEVELOPMENT:
        _fail("HOLDOUT_COORDINATE_FORBIDDEN", "DQ-3 validates development only")
    if not isinstance(holdout_opened, bool):
        _fail("HOLDOUT_STATE_INVALID", "holdout_opened must be a strict boolean")
    if holdout_opened:
        _fail("HOLDOUT_ALREADY_OPEN", "DQ-3 must run before any holdout open")
    checked_feedback_count = _require_int(
        holdout_feedback_count,
        field="holdout_feedback_count",
        minimum=0,
        maximum=0,
    )

    canonical_attempts, completed_ids, noncompleted_ids = _attempt_contract(attempts)
    attempted_ids = tuple(attempt.trial_id for attempt in canonical_attempts)
    multiplicity_ids = _canonical_ids(
        multiplicity_trial_ids,
        field="multiplicity_trial_ids",
        minimum=2,
        maximum=_MAX_TRIALS,
    )
    if multiplicity_ids != attempted_ids:
        _fail(
            "MULTIPLICITY_FAMILY_MISMATCH",
            "multiplicity must contain every attempted trial exactly once",
        )
    raw_pvalue_ids = _canonical_ids(
        raw_pvalue_trial_ids,
        field="raw_pvalue_trial_ids",
        minimum=2,
        maximum=_MAX_TRIALS,
    )
    if raw_pvalue_ids != completed_ids:
        _fail(
            "RAW_PVALUE_FAMILY_MISMATCH",
            "raw p-values must exist for completed trials only",
        )

    _, shared_observations = _series_contract(
        series,
        coordinate_trial_ids=attempted_ids,
    )
    expected_white_plan = build_white_max_t_coordinates_v1(
        family_id=checked_family_id,
        master_seed=master_seed,
        observation_ids=shared_observations,
        block_length=white_block_length,
        replicate_count=white_replicate_count,
    )
    if not isinstance(white_plan, WhiteMaxTCoordinatesV1) or white_plan != expected_white_plan:
        _fail(
            "WHITE_PLAN_MISMATCH",
            "White plan must byte-semantically equal the deterministic shared plan",
        )
    _white_witness_contract(
        white_trial_coordinates,
        coordinate_trial_ids=attempted_ids,
        expected_plan=expected_white_plan,
    )

    expected_pbo_plan = build_pbo_coordinates_v1(
        family_id=checked_family_id,
        observation_ids=shared_observations,
        block_count=pbo_block_count,
        tie_policy=PboTiePolicy.FAIL_CLOSED,
    )
    if not isinstance(pbo_plan, PboCoordinatesV1) or pbo_plan != expected_pbo_plan:
        _fail(
            "PBO_PLAN_MISMATCH",
            "PBO plan must byte-semantically equal the complete shared CSCV plan",
        )
    _pbo_witness_contract(
        pbo_trial_coordinates,
        coordinate_trial_ids=attempted_ids,
        expected_plan=expected_pbo_plan,
    )
    pbo_evaluation_status = (
        "UNMEASURED_INCOMPLETE_TRIAL_FAMILY" if noncompleted_ids else "COORDINATES_VALIDATED"
    )

    receipt_payload: dict[str, object] = {
        "attemptedTrialIds": list(attempted_ids),
        "authority": "NONE",
        "completedTrialIds": list(completed_ids),
        "effectivePvalueTrialIds": list(attempted_ids),
        "familyId": checked_family_id,
        "holdoutFeedbackCount": checked_feedback_count,
        "holdoutOpened": False,
        "holdoutPolicy": _HOLDOUT_POLICY,
        "multiplicityTrialIds": list(multiplicity_ids),
        "noncompletedEffectivePvalue": "1",
        "noncompletedTrialIds": list(noncompleted_ids),
        "observationGridDigest": expected_white_plan.observation_grid_digest,
        "pboCoordinateDigest": expected_pbo_plan.coordinate_digest,
        "pboEvaluationStatus": pbo_evaluation_status,
        "pboSplitCount": len(expected_pbo_plan.splits),
        "pboTiePolicy": expected_pbo_plan.tie_policy.value,
        "phase": checked_phase.value,
        "rawPvalueTrialIds": list(raw_pvalue_ids),
        "schema": SCHEMA_V1,
        "trialStatuses": [
            {"status": attempt.status.value, "trialId": attempt.trial_id}
            for attempt in canonical_attempts
        ],
        "whiteCoordinateDigest": expected_white_plan.coordinate_digest,
        "whiteDerivedSeedHex": f"{expected_white_plan.derived_seed:032x}",
    }
    receipt_digest = _digest(_RECEIPT_DOMAIN, receipt_payload)
    return CoordinateReceiptV1(
        schema=SCHEMA_V1,
        family_id=checked_family_id,
        phase=checked_phase,
        trial_statuses=tuple(
            (attempt.trial_id, attempt.status.value) for attempt in canonical_attempts
        ),
        attempted_trial_ids=attempted_ids,
        completed_trial_ids=completed_ids,
        noncompleted_trial_ids=noncompleted_ids,
        multiplicity_trial_ids=multiplicity_ids,
        raw_pvalue_trial_ids=raw_pvalue_ids,
        effective_pvalue_trial_ids=attempted_ids,
        noncompleted_effective_pvalue="1",
        observation_grid_digest=expected_white_plan.observation_grid_digest,
        white_coordinate_digest=expected_white_plan.coordinate_digest,
        white_derived_seed_hex=f"{expected_white_plan.derived_seed:032x}",
        pbo_coordinate_digest=expected_pbo_plan.coordinate_digest,
        pbo_evaluation_status=pbo_evaluation_status,
        pbo_split_count=len(expected_pbo_plan.splits),
        pbo_tie_policy=expected_pbo_plan.tie_policy,
        holdout_policy=_HOLDOUT_POLICY,
        holdout_opened=False,
        holdout_feedback_count=checked_feedback_count,
        authority="NONE",
        receipt_digest=receipt_digest,
    )
