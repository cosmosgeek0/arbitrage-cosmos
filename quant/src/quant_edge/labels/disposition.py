from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import require_contract_id, require_reason_code, require_strict_int

MAX_WINDOW_ROWS: Final = 10**12


class EventDisposition(StrEnum):
    ACTED = "ACTED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    MISSED = "MISSED"
    QUIET_CONTROL = "QUIET_CONTROL"
    DATA_INVALID = "DATA_INVALID"


class DispositionSource(StrEnum):
    OPERATIONAL_RECORD = "OPERATIONAL_RECORD"
    ATLAS_CONTROL = "ATLAS_CONTROL"
    FACTORY_DEFAULT = "FACTORY_DEFAULT"
    QUALITY_LAW = "QUALITY_LAW"


_ASSERTABLE: Final = frozenset(
    {EventDisposition.ACTED, EventDisposition.REJECTED, EventDisposition.EXPIRED}
)


@dataclass(frozen=True, slots=True)
class WindowQualityFactsV1:
    """Observable window facts driving the §11.5 quality law."""

    gap_row_count: int
    duplicate_row_count: int
    completeness_known: bool

    def __post_init__(self) -> None:
        require_strict_int(
            self.gap_row_count,
            field="gap_row_count",
            minimum=0,
            maximum=MAX_WINDOW_ROWS,
        )
        require_strict_int(
            self.duplicate_row_count,
            field="duplicate_row_count",
            minimum=0,
            maximum=MAX_WINDOW_ROWS,
        )
        if not isinstance(self.completeness_known, bool):
            raise ContractValueError("completeness_known must be boolean")

    @property
    def invalid(self) -> bool:
        return self.gap_row_count > 0 or self.duplicate_row_count > 0 or not self.completeness_known

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessKnown": self.completeness_known,
            "duplicateRowCount": self.duplicate_row_count,
            "gapRowCount": self.gap_row_count,
        }


@dataclass(frozen=True, slots=True)
class DispositionRecordV1:
    record_id: str
    sample_id: str
    event_id: str
    disposition: EventDisposition
    source: DispositionSource
    quality: WindowQualityFactsV1
    reason_code: str

    def __post_init__(self) -> None:
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.event_id, field="event_id")
        if not isinstance(self.disposition, EventDisposition):
            raise ContractValueError("disposition must be EventDisposition")
        if not isinstance(self.source, DispositionSource):
            raise ContractValueError("source must be DispositionSource")
        if not isinstance(self.quality, WindowQualityFactsV1):
            raise ContractValueError("quality must be WindowQualityFactsV1")
        require_reason_code(self.reason_code, field="reason_code")
        if self.quality.invalid != (self.disposition is EventDisposition.DATA_INVALID):
            raise ContractValueError(
                "gapped or completeness-unknown evidence is DATA_INVALID, never a "
                "normal disposition, and clean evidence cannot be DATA_INVALID"
            )
        expected = derive_disposition_record_id(
            sample_id=self.sample_id,
            event_id=self.event_id,
            disposition=self.disposition,
            source=self.source,
            quality=self.quality,
            reason_code=self.reason_code,
        )
        if self.record_id != expected:
            raise ContractValueError("record_id disagrees with the derived identity")

    def as_mapping(self) -> dict[str, object]:
        return {
            "disposition": self.disposition.value,
            "eventId": self.event_id,
            "quality": self.quality.as_mapping(),
            "reasonCode": self.reason_code,
            "recordId": self.record_id,
            "sampleId": self.sample_id,
            "schema": "Q05DispositionRecordV1",
            "source": self.source.value,
            "version": 1,
        }


def derive_disposition_record_id(
    *,
    sample_id: str,
    event_id: str,
    disposition: EventDisposition,
    source: DispositionSource,
    quality: WindowQualityFactsV1,
    reason_code: str,
) -> str:
    identity = {
        "disposition": disposition.value,
        "eventId": event_id,
        "quality": quality.as_mapping(),
        "reasonCode": reason_code,
        "sampleId": sample_id,
        "schema": "Q05DispositionRecordV1",
        "source": source.value,
        "version": 1,
    }
    return f"q05disposition:{hashlib.sha256(canonical_json_bytes(identity)).hexdigest()}"


def derive_disposition(
    *,
    sample_id: str,
    event_id: str,
    quality: WindowQualityFactsV1,
    is_control_window: bool,
    asserted: EventDisposition | None = None,
) -> DispositionRecordV1:
    """Apply the §11.5 law: quality first, operational assertion next, then defaults.

    A candidate window with no operational record is MISSED by definition v1: nothing
    acted on or rejected it while it was live. EXPIRED, ACTED and REJECTED can only be
    asserted by an operational record; the factory never invents them.
    """

    if not isinstance(quality, WindowQualityFactsV1):
        raise ContractValueError("quality must be WindowQualityFactsV1")
    if not isinstance(is_control_window, bool):
        raise ContractValueError("is_control_window must be boolean")
    if asserted is not None and asserted not in _ASSERTABLE:
        raise ContractValueError("only ACTED, REJECTED or EXPIRED can be operationally asserted")
    if asserted is not None and is_control_window:
        raise ContractValueError("control windows cannot carry operational assertions")
    if quality.invalid:
        disposition = EventDisposition.DATA_INVALID
        source = DispositionSource.QUALITY_LAW
        reason = "GAPPED_OR_UNKNOWN_EVIDENCE"
    elif asserted is not None:
        disposition = asserted
        source = DispositionSource.OPERATIONAL_RECORD
        reason = "OPERATIONAL_ASSERTION"
    elif is_control_window:
        disposition = EventDisposition.QUIET_CONTROL
        source = DispositionSource.ATLAS_CONTROL
        reason = "MATCHED_NON_EVENT_CONTROL"
    else:
        disposition = EventDisposition.MISSED
        source = DispositionSource.FACTORY_DEFAULT
        reason = "NO_OPERATIONAL_RECORD_IN_EVENT_LIFETIME"
    return DispositionRecordV1(
        record_id=derive_disposition_record_id(
            sample_id=sample_id,
            event_id=event_id,
            disposition=disposition,
            source=source,
            quality=quality,
            reason_code=reason,
        ),
        sample_id=sample_id,
        event_id=event_id,
        disposition=disposition,
        source=source,
        quality=quality,
        reason_code=reason,
    )
