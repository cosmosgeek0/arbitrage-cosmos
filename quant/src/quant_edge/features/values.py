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


class FeatureValueStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"
    DATA_INVALID = "DATA_INVALID"


_STATUS_SEVERITY: Final[dict[FeatureValueStatus, int]] = {
    FeatureValueStatus.AVAILABLE: 0,
    FeatureValueStatus.STALE: 1,
    FeatureValueStatus.UNKNOWN: 2,
    FeatureValueStatus.DATA_INVALID: 3,
}

_QUALITY_TO_STATUS: Final[dict[QualityState, FeatureValueStatus]] = {
    QualityState.COMPLETE: FeatureValueStatus.AVAILABLE,
    QualityState.PARTIAL: FeatureValueStatus.UNKNOWN,
    QualityState.GAPPED: FeatureValueStatus.DATA_INVALID,
    QualityState.STALE: FeatureValueStatus.STALE,
    QualityState.RECONSTRUCTING: FeatureValueStatus.UNKNOWN,
    QualityState.SAMPLED: FeatureValueStatus.UNKNOWN,
    QualityState.UNAVAILABLE: FeatureValueStatus.UNKNOWN,
    QualityState.SYNTHETIC: FeatureValueStatus.AVAILABLE,
    QualityState.UNKNOWN: FeatureValueStatus.UNKNOWN,
}


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


@dataclass(frozen=True, slots=True)
class FeatureValueV1:
    """One feature observation with explicit freshness/quality truth.

    A value exists exactly when the status is ``AVAILABLE``; missing input is never
    zero, stale is never fresh, and propagation can only worsen a status.
    """

    feature_id: str
    as_of_ns: int
    input_last_event_ns: int
    status: FeatureValueStatus
    value: FixedPointV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.feature_id, field="feature_id")
        as_of = _require_ns(self.as_of_ns, field="as_of_ns")
        last_input = _require_ns(self.input_last_event_ns, field="input_last_event_ns")
        if last_input > as_of:
            raise ContractValueError("a feature cannot observe input newer than as-of")
        if not isinstance(self.status, FeatureValueStatus):
            raise ContractValueError("status must be FeatureValueStatus")
        if (self.value is not None) != (self.status is FeatureValueStatus.AVAILABLE):
            raise ContractValueError("a value exists exactly when the status is AVAILABLE")
        if self.value is not None and not isinstance(self.value, FixedPointV1):
            raise ContractValueError("value must be FixedPointV1 or None")

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfNs": str(self.as_of_ns),
            "featureId": self.feature_id,
            "inputLastEventNs": str(self.input_last_event_ns),
            "status": self.status.value,
            "value": None if self.value is None else self.value.as_mapping(),
        }


def status_from_quality(quality: QualityState) -> FeatureValueStatus:
    if not isinstance(quality, QualityState):
        raise ContractValueError("quality must be QualityState")
    return _QUALITY_TO_STATUS[quality]


def worst_status(statuses: tuple[FeatureValueStatus, ...]) -> FeatureValueStatus:
    if not isinstance(statuses, tuple) or not statuses:
        raise ContractValueError("statuses must be a non-empty tuple")
    worst = FeatureValueStatus.AVAILABLE
    for status in statuses:
        if not isinstance(status, FeatureValueStatus):
            raise ContractValueError("statuses must contain FeatureValueStatus")
        if _STATUS_SEVERITY[status] > _STATUS_SEVERITY[worst]:
            worst = status
    return worst


def derive_feature_value(
    *,
    feature_id: str,
    as_of_ns: int,
    input_last_event_ns: int,
    freshness_bound_ns: int,
    input_quality: QualityState,
    computed: FixedPointV1 | None,
) -> FeatureValueV1:
    """Apply the freshness/quality propagation law to one computed value.

    The result status is the worst of the input quality mapping, the freshness check
    and the computation outcome (a ``None`` computation is ``UNKNOWN``); the value
    survives only when everything is ``AVAILABLE``.
    """

    require_strict_int(freshness_bound_ns, field="freshness_bound_ns", minimum=1)
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    last_input = _require_ns(input_last_event_ns, field="input_last_event_ns")
    statuses = [status_from_quality(input_quality)]
    if as_of - last_input > freshness_bound_ns:
        statuses.append(FeatureValueStatus.STALE)
    if computed is None:
        statuses.append(FeatureValueStatus.UNKNOWN)
    status = worst_status(tuple(statuses))
    return FeatureValueV1(
        feature_id=feature_id,
        as_of_ns=as_of,
        input_last_event_ns=last_input,
        status=status,
        value=computed if status is FeatureValueStatus.AVAILABLE else None,
    )
