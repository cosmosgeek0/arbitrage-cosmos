from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, fp_ulp_distance
from quant_edge.features.registry import FeatureCardV1
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int


class StreamingMicroFeature[ItemT](Protocol):
    def update(self, item: ItemT) -> FixedPointV1 | None:
        """Consume one item and return the feature value, or None when unknown."""

    @property
    def last_update_ops(self) -> int:
        """Deterministic elementary-operation count of the last update."""


@dataclass(frozen=True, slots=True)
class MicroFeatureImplementationV1[ItemT]:
    """One §13 feature: complete card, batch reference, streaming and cost bound."""

    card: FeatureCardV1
    batch: Callable[[tuple[ItemT, ...]], FixedPointV1 | None]
    make_streaming: Callable[[], StreamingMicroFeature[ItemT]]
    declared_max_update_ops: int

    def __post_init__(self) -> None:
        if not isinstance(self.card, FeatureCardV1):
            raise ContractValueError("card must be FeatureCardV1")
        if not callable(self.batch) or not callable(self.make_streaming):
            raise ContractValueError("batch and make_streaming must be callable")
        require_strict_int(
            self.declared_max_update_ops,
            field="declared_max_update_ops",
            minimum=1,
        )


@dataclass(frozen=True, slots=True)
class MicroEquivalenceReportV1:
    """Streaming/batch agreement plus the deterministic update-cost benchmark."""

    feature_id: str
    items: int
    compared_values: int
    status_mismatches: int
    max_ulp_deviation: int
    tolerance_ulp: int
    max_update_ops: int
    declared_max_update_ops: int
    passed: bool
    streaming_vector_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.feature_id, field="feature_id")
        for name in (
            "items",
            "compared_values",
            "status_mismatches",
            "max_ulp_deviation",
            "tolerance_ulp",
            "max_update_ops",
        ):
            require_strict_int(getattr(self, name), field=name, minimum=0)
        require_strict_int(
            self.declared_max_update_ops,
            field="declared_max_update_ops",
            minimum=1,
        )
        expected = (
            self.status_mismatches == 0
            and self.max_ulp_deviation <= self.tolerance_ulp
            and self.max_update_ops <= self.declared_max_update_ops
        )
        if self.passed != expected:
            raise ContractValueError("passed must equal the measured truth")
        if not isinstance(self.streaming_vector_digest, DigestV1):
            raise ContractValueError("streaming_vector_digest must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "comparedValues": self.compared_values,
            "declaredMaxUpdateOps": self.declared_max_update_ops,
            "featureId": self.feature_id,
            "items": self.items,
            "maxUlpDeviation": self.max_ulp_deviation,
            "maxUpdateOps": self.max_update_ops,
            "passed": self.passed,
            "statusMismatches": self.status_mismatches,
            "streamingVectorSha256": self.streaming_vector_digest.hexdigest,
            "toleranceUlp": self.tolerance_ulp,
        }


def micro_vector_digest(vector: tuple[FixedPointV1 | None, ...]) -> DigestV1:
    mapping = {
        "schema": "Q07MicroVectorV1",
        "values": [None if value is None else str(value.mantissa) for value in vector],
        "version": 1,
    }
    return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


def run_micro_equivalence[ItemT](
    implementation: MicroFeatureImplementationV1[ItemT],
    items: tuple[ItemT, ...],
) -> MicroEquivalenceReportV1:
    if not isinstance(implementation, MicroFeatureImplementationV1):
        raise ContractValueError("implementation must be MicroFeatureImplementationV1")
    if not isinstance(items, tuple):
        raise ContractValueError("items must be a tuple")
    streaming = implementation.make_streaming()
    streamed: list[FixedPointV1 | None] = []
    max_ops = 0
    for item in items:
        streamed.append(streaming.update(item))
        max_ops = max(max_ops, streaming.last_update_ops)
    status_mismatches = 0
    compared = 0
    max_ulp = 0
    for index in range(len(items)):
        batch_value = implementation.batch(items[: index + 1])
        streaming_value = streamed[index]
        if (batch_value is None) != (streaming_value is None):
            status_mismatches += 1
            continue
        if batch_value is None or streaming_value is None:
            continue
        compared += 1
        max_ulp = max(max_ulp, fp_ulp_distance(batch_value, streaming_value))
    tolerance = implementation.card.equivalence_tolerance_ulp
    declared_ops = implementation.declared_max_update_ops
    return MicroEquivalenceReportV1(
        feature_id=implementation.card.feature_id,
        items=len(items),
        compared_values=compared,
        status_mismatches=status_mismatches,
        max_ulp_deviation=max_ulp,
        tolerance_ulp=tolerance,
        max_update_ops=max_ops,
        declared_max_update_ops=declared_ops,
        passed=(status_mismatches == 0 and max_ulp <= tolerance and max_ops <= declared_ops),
        streaming_vector_digest=micro_vector_digest(tuple(streamed)),
    )
