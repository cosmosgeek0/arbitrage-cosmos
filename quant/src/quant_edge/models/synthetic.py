"""Deterministic synthetic battery datasets with declared planted structure.

Everything here is integer-valued machinery truth generated from the lane's
``DeterministicRandom``: planted monotone linear signal, a planted sign-XOR
nonlinearity no linear model can represent, a heteroscedasticity driver, pure
noise and liquidity/activity proxies. Posture is ``SYNTHETIC`` only. Planted
structure proves the battery machinery; it is never market truth and supports
no edge claim.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    require_contract_id,
    require_strict_int,
)
from quant_edge.models.contracts import TargetKind
from quant_edge.models.split import InternalChronologicalSplitV1
from quant_edge.randomness import DeterministicRandom

QUANTILE_LEVELS: Final = ("0.25", "0.5", "0.75")
RANK_GROUP_SIZE: Final = 16
RANK_MAX_GRADE: Final = 3
RANK_RELEVANT_GRADE: Final = 2
MAX_LABEL_MAGNITUDE: Final = 10**9

BATTERY_DATASET_ID: Final = "battery_synthetic:v1"
TARGET_BINARY_ID: Final = "transition_binary:v1"
TARGET_REGRESSION_ID: Final = "net_edge_regression:v1"
TARGET_QUANTILE_ID: Final = "net_edge_quantiles:v1"
TARGET_RANK_ID: Final = "attention_rank:v1"


class FeatureRole(StrEnum):
    PLANTED_MONOTONE_SIGNAL = "PLANTED_MONOTONE_SIGNAL"
    PLANTED_NONLINEAR_SIGNAL = "PLANTED_NONLINEAR_SIGNAL"
    HETEROSCEDASTICITY_DRIVER = "HETEROSCEDASTICITY_DRIVER"
    NOISE = "NOISE"
    LIQUIDITY_PROXY = "LIQUIDITY_PROXY"
    ACTIVITY_PROXY = "ACTIVITY_PROXY"


_ZERO_DIRECTION_ROLES: Final = frozenset(
    {
        FeatureRole.PLANTED_NONLINEAR_SIGNAL,
        FeatureRole.HETEROSCEDASTICITY_DRIVER,
        FeatureRole.NOISE,
    }
)


@dataclass(frozen=True, slots=True)
class SyntheticFeatureSpecV1:
    feature_id: str
    role: FeatureRole
    monotone_direction: int

    def __post_init__(self) -> None:
        require_contract_id(self.feature_id, field="feature_id")
        if not isinstance(self.role, FeatureRole):
            raise ContractValueError("role must be FeatureRole")
        require_strict_int(
            self.monotone_direction, field="monotone_direction", minimum=-1, maximum=1
        )
        if self.role is FeatureRole.PLANTED_MONOTONE_SIGNAL and self.monotone_direction == 0:
            raise ContractValueError("planted monotone signal must declare a direction")
        if self.role in _ZERO_DIRECTION_ROLES and self.monotone_direction != 0:
            raise ContractValueError(f"{self.role.value} features must not declare a direction")

    def as_mapping(self) -> dict[str, object]:
        return {
            "featureId": self.feature_id,
            "monotoneDirection": self.monotone_direction,
            "role": self.role.value,
        }


@dataclass(frozen=True, slots=True)
class SyntheticTargetV1:
    target_id: str
    kind: TargetKind
    labels: tuple[int, ...]
    group_size: int | None

    def __post_init__(self) -> None:
        require_contract_id(self.target_id, field="target_id")
        if not isinstance(self.kind, TargetKind):
            raise ContractValueError("kind must be TargetKind")
        if not isinstance(self.labels, tuple) or not self.labels:
            raise ContractValueError("labels must be a non-empty tuple")
        for index, label in enumerate(self.labels):
            require_strict_int(
                label,
                field=f"labels[{index}]",
                minimum=-MAX_LABEL_MAGNITUDE,
                maximum=MAX_LABEL_MAGNITUDE,
            )
        if self.kind is TargetKind.BINARY and any(label not in (0, 1) for label in self.labels):
            raise ContractValueError("binary labels must be 0 or 1")
        if self.kind is TargetKind.RANK:
            if self.group_size is None:
                raise ContractValueError("rank targets must declare a group size")
            require_strict_int(self.group_size, field="group_size", minimum=2, maximum=1_024)
            if len(self.labels) % self.group_size != 0:
                raise ContractValueError("rank labels must fill whole groups")
            if any(not 0 <= label <= RANK_MAX_GRADE for label in self.labels):
                raise ContractValueError("rank grades must lie in the declared grade range")
        elif self.group_size is not None:
            raise ContractValueError("group_size exists only for rank targets")

    def require_group_size(self) -> int:
        if self.group_size is None:
            raise ContractValueError(f"{self.target_id} does not declare a group size")
        return self.group_size

    def as_mapping(self) -> dict[str, object]:
        return {
            "groupSize": self.group_size,
            "kind": self.kind.value,
            "labels": [str(label) for label in self.labels],
            "targetId": self.target_id,
        }


@dataclass(frozen=True, slots=True)
class SyntheticDatasetV1:
    dataset_id: str
    posture: EvidencePosture
    features: tuple[SyntheticFeatureSpecV1, ...]
    rows: tuple[tuple[int, ...], ...]
    targets: tuple[SyntheticTargetV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.dataset_id, field="dataset_id")
        if self.posture is not EvidencePosture.SYNTHETIC:
            raise ContractValueError("battery datasets are SYNTHETIC only")
        if not isinstance(self.features, tuple) or not self.features:
            raise ContractValueError("features must be a non-empty tuple")
        feature_ids = [spec.feature_id for spec in self.features]
        if len(set(feature_ids)) != len(feature_ids):
            raise ContractValueError("feature ids must be unique")
        if not isinstance(self.rows, tuple) or len(self.rows) < 4:
            raise ContractValueError("rows must hold at least four chronological rows")
        width = len(self.features)
        for index, row in enumerate(self.rows):
            if not isinstance(row, tuple) or len(row) != width:
                raise ContractValueError(f"rows[{index}] must match the feature width")
            for column, value in enumerate(row):
                require_strict_int(
                    value,
                    field=f"rows[{index}][{column}]",
                    minimum=-MAX_LABEL_MAGNITUDE,
                    maximum=MAX_LABEL_MAGNITUDE,
                )
        if not isinstance(self.targets, tuple) or not self.targets:
            raise ContractValueError("targets must be a non-empty tuple")
        target_ids = [target.target_id for target in self.targets]
        if len(set(target_ids)) != len(target_ids):
            raise ContractValueError("target ids must be unique")
        for target in self.targets:
            if len(target.labels) != len(self.rows):
                raise ContractValueError(f"{target.target_id} labels must cover every row")

    def target(self, target_id: str) -> SyntheticTargetV1:
        for candidate in self.targets:
            if candidate.target_id == target_id:
                return candidate
        raise ContractValueError(f"unknown target {target_id}")

    def feature_index(self, feature_id: str) -> int:
        for index, spec in enumerate(self.features):
            if spec.feature_id == feature_id:
                return index
        raise ContractValueError(f"unknown feature {feature_id}")

    def as_mapping(self) -> dict[str, object]:
        return {
            "datasetId": self.dataset_id,
            "features": [spec.as_mapping() for spec in self.features],
            "posture": self.posture.value,
            "rows": [[str(value) for value in row] for row in self.rows],
            "targets": [target.as_mapping() for target in self.targets],
        }

    @property
    def content_digest(self) -> DigestV1:
        payload = canonical_json_bytes(self.as_mapping())
        return DigestV1(hexdigest=hashlib.sha256(payload).hexdigest())

    def summary_mapping(self) -> dict[str, object]:
        return {
            "contentSha256": self.content_digest.hexdigest,
            "datasetId": self.dataset_id,
            "features": [spec.as_mapping() for spec in self.features],
            "posture": self.posture.value,
            "rowCount": len(self.rows),
            "targetIds": [target.target_id for target in self.targets],
        }


BATTERY_FEATURE_SPECS: Final[tuple[SyntheticFeatureSpecV1, ...]] = (
    SyntheticFeatureSpecV1("lin_primary", FeatureRole.PLANTED_MONOTONE_SIGNAL, 1),
    SyntheticFeatureSpecV1("lin_secondary", FeatureRole.PLANTED_MONOTONE_SIGNAL, 1),
    SyntheticFeatureSpecV1("xor_left", FeatureRole.PLANTED_NONLINEAR_SIGNAL, 0),
    SyntheticFeatureSpecV1("xor_right", FeatureRole.PLANTED_NONLINEAR_SIGNAL, 0),
    SyntheticFeatureSpecV1("hetero_driver", FeatureRole.HETEROSCEDASTICITY_DRIVER, 0),
    SyntheticFeatureSpecV1("noise_a", FeatureRole.NOISE, 0),
    SyntheticFeatureSpecV1("noise_b", FeatureRole.NOISE, 0),
    SyntheticFeatureSpecV1("noise_c", FeatureRole.NOISE, 0),
    SyntheticFeatureSpecV1("liquidity_proxy", FeatureRole.LIQUIDITY_PROXY, 0),
    SyntheticFeatureSpecV1("activity_proxy", FeatureRole.ACTIVITY_PROXY, 1),
)

BATTERY_ROWS: Final = 640


def battery_split() -> InternalChronologicalSplitV1:
    """The single declared battery split: 400 / 16 embargo / 96 / 128."""

    return InternalChronologicalSplitV1(
        train_rows=400, embargo_rows=16, valid_rows=96, test_rows=128
    )


def _uniform(rng: DeterministicRandom, low: int, high: int) -> int:
    """Deterministic integer in [low, high]; modulo bias is accepted machinery."""

    return low + int(rng.next_u64() % (high - low + 1))


def _binary_latent(row: tuple[int, ...], eps: int) -> int:
    xor_active = (row[2] > 0) != (row[3] > 0)
    xor_term = 100 if xor_active else -100
    return 40 * row[0] + 20 * row[1] + 55 * xor_term + eps


def _regression_label(row: tuple[int, ...], shock: int) -> int:
    return 25 * row[0] + 10 * row[1] + shock * (5 + abs(row[4]))


def _rank_latent(row: tuple[int, ...], eps: int) -> int:
    return 6 * row[9] + 45 * row[0] + eps


def _rank_grade(latent: int) -> int:
    if latent > 4_800:
        return 3
    if latent > 3_600:
        return 2
    if latent > 2_400:
        return 1
    return 0


def require_learnable_binary(labels: tuple[int, ...], split: InternalChronologicalSplitV1) -> None:
    """Fail closed unless both classes appear in train, valid and test slices."""

    split.require_exact_cover(len(labels))
    for name, indices in (
        ("train", split.train_indices),
        ("valid", split.valid_indices),
        ("test", split.test_indices),
    ):
        values = {labels[index] for index in indices}
        if values != {0, 1}:
            raise ContractValueError(f"binary target must show both classes in the {name} slice")


def build_battery_dataset(seed: int) -> SyntheticDatasetV1:
    """Build the deterministic 640-row battery dataset for one seed."""

    rng = DeterministicRandom.from_seed(seed)
    rows: list[tuple[int, ...]] = []
    binary_labels: list[int] = []
    regression_labels: list[int] = []
    rank_labels: list[int] = []
    for _ in range(BATTERY_ROWS):
        core = tuple(_uniform(rng, -100, 100) for _ in range(8))
        liquidity = _uniform(rng, 1, 1_000)
        activity = _uniform(rng, 1, 1_000)
        row = (*core, liquidity, activity)
        eps_binary = _uniform(rng, -3_000, 3_000)
        shock = _uniform(rng, -100, 100)
        eps_rank = _uniform(rng, -1_500, 1_500)
        rows.append(row)
        binary_labels.append(1 if _binary_latent(row, eps_binary) > 0 else 0)
        regression_labels.append(_regression_label(row, shock))
        rank_labels.append(_rank_grade(_rank_latent(row, eps_rank)))

    regression = tuple(regression_labels)
    dataset = SyntheticDatasetV1(
        dataset_id=BATTERY_DATASET_ID,
        posture=EvidencePosture.SYNTHETIC,
        features=BATTERY_FEATURE_SPECS,
        rows=tuple(rows),
        targets=(
            SyntheticTargetV1(TARGET_BINARY_ID, TargetKind.BINARY, tuple(binary_labels), None),
            SyntheticTargetV1(TARGET_REGRESSION_ID, TargetKind.REGRESSION, regression, None),
            SyntheticTargetV1(TARGET_QUANTILE_ID, TargetKind.QUANTILE, regression, None),
            SyntheticTargetV1(TARGET_RANK_ID, TargetKind.RANK, tuple(rank_labels), RANK_GROUP_SIZE),
        ),
    )
    require_learnable_binary(dataset.target(TARGET_BINARY_ID).labels, battery_split())
    return dataset
