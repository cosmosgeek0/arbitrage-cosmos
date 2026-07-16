from __future__ import annotations

import hashlib
from dataclasses import dataclass

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.domains import BarSeriesV1
from quant_edge.features.fixedpoint import FixedPointV1, fp_ulp_distance
from quant_edge.features.primitives import FeatureImplementationV1
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int


@dataclass(frozen=True, slots=True)
class EquivalenceReportV1:
    """Streaming/batch agreement truth for one feature over one bar series.

    Disagreement beyond the card's declared tolerance, or any status mismatch, means
    the feature is not production-ready; the report never softens that.
    """

    feature_id: str
    bars: int
    compared_values: int
    status_mismatches: int
    max_ulp_deviation: int
    tolerance_ulp: int
    passed: bool
    streaming_vector_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.feature_id, field="feature_id")
        require_strict_int(self.bars, field="bars", minimum=0)
        require_strict_int(self.compared_values, field="compared_values", minimum=0)
        require_strict_int(self.status_mismatches, field="status_mismatches", minimum=0)
        require_strict_int(self.max_ulp_deviation, field="max_ulp_deviation", minimum=0)
        require_strict_int(self.tolerance_ulp, field="tolerance_ulp", minimum=0)
        expected = self.status_mismatches == 0 and (self.max_ulp_deviation <= self.tolerance_ulp)
        if self.passed != expected:
            raise ContractValueError("passed must equal the measured equivalence truth")
        if not isinstance(self.streaming_vector_digest, DigestV1):
            raise ContractValueError("streaming_vector_digest must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bars": self.bars,
            "comparedValues": self.compared_values,
            "featureId": self.feature_id,
            "maxUlpDeviation": self.max_ulp_deviation,
            "passed": self.passed,
            "statusMismatches": self.status_mismatches,
            "streamingVectorSha256": self.streaming_vector_digest.hexdigest,
            "toleranceUlp": self.tolerance_ulp,
        }


def streaming_vector(
    implementation: FeatureImplementationV1,
    bar_series: BarSeriesV1,
) -> tuple[FixedPointV1 | None, ...]:
    if not isinstance(implementation, FeatureImplementationV1):
        raise ContractValueError("implementation must be FeatureImplementationV1")
    if not isinstance(bar_series, BarSeriesV1):
        raise ContractValueError("bar_series must be BarSeriesV1")
    streaming = implementation.make_streaming()
    return tuple(streaming.update(bar) for bar in bar_series.bars)


def vector_digest(vector: tuple[FixedPointV1 | None, ...]) -> DigestV1:
    mapping = {
        "schema": "Q06FeatureVectorV1",
        "values": [None if value is None else str(value.mantissa) for value in vector],
        "version": 1,
    }
    return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


def run_equivalence(
    implementation: FeatureImplementationV1,
    bar_series: BarSeriesV1,
) -> EquivalenceReportV1:
    """Compare the streaming implementation to the batch reference bar-for-bar."""

    streamed = streaming_vector(implementation, bar_series)
    bars = bar_series.bars
    status_mismatches = 0
    compared = 0
    max_ulp = 0
    for index in range(len(bars)):
        batch_value = implementation.batch(bars[: index + 1])
        streaming_value = streamed[index]
        if (batch_value is None) != (streaming_value is None):
            status_mismatches += 1
            continue
        if batch_value is None or streaming_value is None:
            continue
        compared += 1
        deviation = fp_ulp_distance(batch_value, streaming_value)
        max_ulp = max(max_ulp, deviation)
    tolerance = implementation.card.equivalence_tolerance_ulp
    return EquivalenceReportV1(
        feature_id=implementation.card.feature_id,
        bars=len(bars),
        compared_values=compared,
        status_mismatches=status_mismatches,
        max_ulp_deviation=max_ulp,
        tolerance_ulp=tolerance,
        passed=status_mismatches == 0 and max_ulp <= tolerance,
        streaming_vector_digest=vector_digest(streamed),
    )
