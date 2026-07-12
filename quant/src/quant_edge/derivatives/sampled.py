from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    QualityState,
    require_contract_id,
    require_strict_int,
)

# Sampled and partial sources can never prove completeness, so their values carry a
# vocabulary that is structurally unable to claim COMPLETE/AVAILABLE truth. Under the
# frozen Q06 value law both map to UNKNOWN for strict consumers; Q08 preserves the
# evidence with its sampling label instead of erasing it.
SAMPLED_QUALITIES: Final = frozenset(
    {QualityState.SAMPLED, QualityState.PARTIAL, QualityState.UNKNOWN}
)


class SampledValueStatus(StrEnum):
    AVAILABLE_SAMPLED = "AVAILABLE_SAMPLED"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def require_sampled_quality(value: object, *, field: str) -> QualityState:
    if not isinstance(value, QualityState) or value not in SAMPLED_QUALITIES:
        raise ContractValueError(
            f"{field} must be SAMPLED, PARTIAL or UNKNOWN; sampled sources cannot "
            "claim completeness"
        )
    return value


@dataclass(frozen=True, slots=True)
class SampledFeatureValueV1:
    """One feature value from a sampled/partial source.

    A value exists exactly when the status is AVAILABLE_SAMPLED, and even then it is
    an observed lower-bound style fact under the declared sampling quality — never a
    claim of complete market truth.
    """

    feature_id: str
    as_of_ns: int
    input_last_event_ns: int
    sampling: QualityState
    status: SampledValueStatus
    value: FixedPointV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.feature_id, field="feature_id")
        as_of = _require_ns(self.as_of_ns, field="as_of_ns")
        last_input = _require_ns(self.input_last_event_ns, field="input_last_event_ns")
        if last_input > as_of:
            raise ContractValueError("a feature cannot observe input newer than as-of")
        require_sampled_quality(self.sampling, field="sampling")
        if not isinstance(self.status, SampledValueStatus):
            raise ContractValueError("status must be SampledValueStatus")
        if (self.value is not None) != (self.status is SampledValueStatus.AVAILABLE_SAMPLED):
            raise ContractValueError("a value exists exactly when the status is AVAILABLE_SAMPLED")
        if self.value is not None and not isinstance(self.value, FixedPointV1):
            raise ContractValueError("value must be FixedPointV1 or None")
        if self.sampling is QualityState.UNKNOWN and self.value is not None:
            raise ContractValueError("unknown sampling quality cannot carry a value")

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfNs": str(self.as_of_ns),
            "featureId": self.feature_id,
            "inputLastEventNs": str(self.input_last_event_ns),
            "sampling": self.sampling.value,
            "status": self.status.value,
            "value": None if self.value is None else self.value.as_mapping(),
        }


def derive_sampled_value(
    *,
    feature_id: str,
    as_of_ns: int,
    input_last_event_ns: int,
    freshness_bound_ns: int,
    sampling: QualityState,
    computed: FixedPointV1 | None,
) -> SampledFeatureValueV1:
    """Freshness/quality law for sampled sources; degradation only, never upgrade."""

    require_strict_int(freshness_bound_ns, field="freshness_bound_ns", minimum=1)
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    last_input = _require_ns(input_last_event_ns, field="input_last_event_ns")
    quality = require_sampled_quality(sampling, field="sampling")
    if quality is QualityState.UNKNOWN or computed is None:
        status = SampledValueStatus.UNKNOWN
    elif as_of - last_input > freshness_bound_ns:
        status = SampledValueStatus.STALE
    else:
        status = SampledValueStatus.AVAILABLE_SAMPLED
    return SampledFeatureValueV1(
        feature_id=feature_id,
        as_of_ns=as_of,
        input_last_event_ns=last_input,
        sampling=quality,
        status=status,
        value=computed if status is SampledValueStatus.AVAILABLE_SAMPLED else None,
    )
