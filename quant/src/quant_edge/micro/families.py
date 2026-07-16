from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, require_contract_id


class FamilyDisposition(StrEnum):
    ADOPT = "ADOPT"
    ADAPT = "ADAPT"
    REFERENCE_ONLY = "REFERENCE_ONLY"
    REJECT = "REJECT"
    BLOCKED_DATA = "BLOCKED_DATA"


@dataclass(frozen=True, slots=True)
class FamilyRecordV1:
    bullet_id: str
    bullet: str
    disposition: FamilyDisposition
    reason: str
    implemented_features: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.bullet_id, field="bullet_id")
        if not isinstance(self.bullet, str) or not self.bullet.strip():
            raise ContractValueError("bullet must be non-empty text")
        if not isinstance(self.disposition, FamilyDisposition):
            raise ContractValueError("disposition must be FamilyDisposition")
        if not isinstance(self.reason, str) or not self.reason.strip():
            raise ContractValueError("reason must be non-empty text")
        if not isinstance(self.implemented_features, tuple) or (
            tuple(sorted(self.implemented_features)) != self.implemented_features
        ):
            raise ContractValueError("implemented_features must be a sorted tuple")
        implemented = self.disposition in (FamilyDisposition.ADOPT, FamilyDisposition.ADAPT)
        if implemented != bool(self.implemented_features):
            raise ContractValueError("features exist exactly for ADOPT/ADAPT dispositions")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bullet": self.bullet,
            "bulletId": self.bullet_id,
            "disposition": self.disposition.value,
            "implementedFeatures": list(self.implemented_features),
            "reason": self.reason,
        }


_SNAPSHOT_LIMIT: Final = (
    "public diff-depth and snapshots cannot separate cancellations from executions "
    "without event-level L2 semantics and a faithful trade join"
)

SECTION_13_1_DISPOSITIONS: Final[tuple[FamilyRecordV1, ...]] = (
    FamilyRecordV1(
        bullet_id="13.1-01-l1-ofi",
        bullet="L1 order-flow imbalance from limit additions, cancellations, executions",
        disposition=FamilyDisposition.ADOPT,
        reason="Cont-style L1 transition law is fully supported by bookTicker-shaped L1",
        implemented_features=("ofi_l1:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-02-multilevel-ofi",
        bullet="multi-level OFI across depth bands",
        disposition=FamilyDisposition.ADAPT,
        reason="snapshot-differenced band flow, not event-level flow; " + _SNAPSHOT_LIMIT,
        implemented_features=("band_flow:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-03-queue-imbalance",
        bullet="queue imbalance by level and cumulative bands",
        disposition=FamilyDisposition.ADOPT,
        reason="L1 and cumulative band imbalances are exactly computable from ladders",
        implemented_features=("cumulative_band_imbalance:v1", "l1_queue_imbalance:v1"),
    ),
    FamilyRecordV1(
        bullet_id="13.1-04-microprice",
        bullet="depth-weighted microprice and displacement from mid",
        disposition=FamilyDisposition.ADOPT,
        reason="exact rational microprice displacement from L1 sizes",
        implemented_features=("microprice_displacement:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-05-signed-trade-imbalance",
        bullet="signed trade/aggressor imbalance using exchange maker flags",
        disposition=FamilyDisposition.ADOPT,
        reason="aggTrades maker flags give exact aggressor sides",
        implemented_features=("signed_trade_imbalance:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-06-arrival",
        bullet="trade-arrival rate, acceleration, burstiness, inter-arrival, entropy",
        disposition=FamilyDisposition.ADAPT,
        reason="arrival rate and the inter-arrival index of dispersion implemented; "
        "acceleration/entropy variants deferred pending binning definitions that "
        "survive review",
        implemented_features=("trade_dispersion:v1", "trade_intensity:v1"),
    ),
    FamilyRecordV1(
        bullet_id="13.1-07-size-distribution",
        bullet="trade-size distribution shifts, tail mass, clustering, concentration",
        disposition=FamilyDisposition.ADAPT,
        reason="concentration (HHI) implemented; distribution-shift and tail metrics "
        "deferred pending reference-window definitions",
        implemented_features=("size_concentration_hhi:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-08-book-shape",
        bullet="book slope, convexity and imbalance",
        disposition=FamilyDisposition.ADAPT,
        reason="exact OLS slope imbalance implemented; convexity deferred pending a "
        "curvature definition that is stable on five-level bands",
        implemented_features=("book_slope_imbalance:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-09-depth-dynamics",
        bullet="depth depletion, replenishment, resiliency and migration",
        disposition=FamilyDisposition.ADAPT,
        reason="depletion/replenishment/resiliency implemented on snapshot cadence; "
        "level-migration tracking deferred",
        implemented_features=("depth_resiliency:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-10-cancel-add-intensity",
        bullet="cancellation/addition intensity where reconstructable from L2",
        disposition=FamilyDisposition.BLOCKED_DATA,
        reason=_SNAPSHOT_LIMIT,
        implemented_features=(),
    ),
    FamilyRecordV1(
        bullet_id="13.1-11-wall-persistence",
        bullet="repeated level interaction and wall persistence",
        disposition=FamilyDisposition.REFERENCE_ONLY,
        reason="level-lifetime tracking across snapshots is definable but unvalidated; "
        "deferred until a persistence definition earns adoption",
        implemented_features=(),
    ),
    FamilyRecordV1(
        bullet_id="13.1-12-effective-spread-vwap",
        bullet="effective spread and intended-size executable VWAP",
        disposition=FamilyDisposition.ADOPT,
        reason="both are exactly computable from joined trades and ladders",
        implemented_features=("effective_spread:v1", "vwap_spread_at_size:v1"),
    ),
    FamilyRecordV1(
        bullet_id="13.1-13-price-response",
        bullet="price response per unit signed flow",
        disposition=FamilyDisposition.ADOPT,
        reason="exact OLS mid-response slope over joined trades",
        implemented_features=("kyle_slope:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-14-impact-illiquidity",
        bullet="local impact/Kyle-style slope and Amihud-style illiquidity",
        disposition=FamilyDisposition.ADOPT,
        reason="Kyle-style slope and per-volume absolute return are supported",
        implemented_features=("amihud_illiquidity:v1", "kyle_slope:v1"),
    ),
    FamilyRecordV1(
        bullet_id="13.1-15-absorption",
        bullet="absorption proxies: aggressive flow with limited adverse response",
        disposition=FamilyDisposition.ADAPT,
        reason="versioned parameterized proxy; replenishment linkage is indirect on "
        "snapshot cadence",
        implemented_features=("absorption_ratio:v1",),
    ),
    FamilyRecordV1(
        bullet_id="13.1-16-failed-moves",
        bullet="failed breakout/breakdown and failed response features",
        disposition=FamilyDisposition.REFERENCE_ONLY,
        reason="requires event/label joins with the Q05 factory; deferred to the "
        "phase that wires features to labeled events",
        implemented_features=(),
    ),
    FamilyRecordV1(
        bullet_id="13.1-17-adverse-selection",
        bullet="adverse-selection and opportunity-decay proxies",
        disposition=FamilyDisposition.REFERENCE_ONLY,
        reason="opportunity decay exists as a Q05 outcome; a pre-cutoff feature "
        "version needs a definition that provably avoids label leakage",
        implemented_features=(),
    ),
)


def disposition_table_digest() -> DigestV1:
    mapping = {
        "records": [record.as_mapping() for record in SECTION_13_1_DISPOSITIONS],
        "schema": "Q07FamilyDispositionsV1",
        "version": 1,
    }
    return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


def spoof_pattern_semantics() -> str:
    """The only lawful wording for spoof-like evidence from public data."""

    return (
        "possible_spoof_like_pattern: public L2/L1 evidence can describe patterns "
        "consistent with spoofing but can never attribute individual intent; any such "
        "feature must carry this limitation verbatim"
    )
