from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    QualityState,
    ReferenceMarketEvidenceRowV1,
    require_strict_int,
)
from quant_edge.primitives import require_id, require_utc_millis

MAX_ATLAS_ROWS = 200_000
MAX_ATLAS_RULES = 32
MAX_ATLAS_RECORDS_PER_CLASS = 4_096
MAX_LOOKBACK_WINDOWS = 64
MAX_WINDOW_NS = 86_400_000_000_000
MAX_COUNT = (1 << 63) - 1


class EventAtlasTier(StrEnum):
    HISTORICAL_COARSE = "HISTORICAL_COARSE"
    FORWARD_HIGH_FIDELITY = "FORWARD_HIGH_FIDELITY"


class TierEvidencePosture(StrEnum):
    REAL_CHECKSUM_VERIFIED_ARCHIVE = "REAL_CHECKSUM_VERIFIED_ARCHIVE"
    SYNTHETIC_CONTRACT_ONLY = "SYNTHETIC_CONTRACT_ONLY"


class RealCoverageStatus(StrEnum):
    OBSERVED = "OBSERVED"
    MISSING = "MISSING"


class DeliveryStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    BLOCKED = "BLOCKED"


class DiscoveryMetric(StrEnum):
    TRADE_COUNT = "TRADE_COUNT"
    PRICE_RANGE = "PRICE_RANGE"


class DiscoveryBasis(StrEnum):
    ABSOLUTE = "ABSOLUTE"
    PREVIOUS_WINDOW_MEAN = "PREVIOUS_WINDOW_MEAN"
    PREVIOUS_WINDOW_MAX = "PREVIOUS_WINDOW_MAX"


class InventoryClass(StrEnum):
    CANDIDATE = "CANDIDATE"
    CONTROL = "CONTROL"


class EvidenceAvailability(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"


class InstrumentIdentityPosture(StrEnum):
    OBSERVED_ROW_FIELDS_ONLY = "OBSERVED_ROW_FIELDS_ONLY"


class EconomicsPosture(StrEnum):
    UNAVAILABLE = "UNAVAILABLE"


def _count(value: object, *, field: str, maximum: int = MAX_COUNT) -> int:
    return require_strict_int(value, field=field, minimum=0, maximum=maximum)


def _is_canonical_date(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return False
    return parsed.isoformat() == value


def _sorted_ids(values: tuple[str, ...], *, field: str, maximum: int) -> tuple[str, ...]:
    if not isinstance(values, tuple) or len(values) > maximum:
        raise ContractValueError(f"{field} must be a bounded immutable tuple")
    checked = tuple(require_id(value, field=f"{field}[]") for value in values)
    if checked != tuple(sorted(set(checked))):
        raise ContractValueError(f"{field} must be sorted and unique")
    return checked


def _optional_digest(value: DigestV1 | None, *, field: str) -> DigestV1 | None:
    if value is not None and not isinstance(value, DigestV1):
        raise ContractValueError(f"{field} must be DigestV1 or null")
    return value


@dataclass(frozen=True, slots=True)
class AtlasTierDescriptorV1:
    tier: EventAtlasTier
    evidence_posture: TierEvidencePosture
    coverage_digest: DigestV1
    manifest_digest: DigestV1 | None
    synthetic_fixture_digest: DigestV1 | None
    synthetic_schema_digest: DigestV1 | None
    real_coverage_status: RealCoverageStatus
    delivery_status: DeliveryStatus

    def __post_init__(self) -> None:
        if not isinstance(self.tier, EventAtlasTier):
            raise ContractValueError("tier must be EventAtlasTier")
        if not isinstance(self.evidence_posture, TierEvidencePosture):
            raise ContractValueError("evidence_posture must be TierEvidencePosture")
        if not isinstance(self.coverage_digest, DigestV1):
            raise ContractValueError("coverage_digest must be DigestV1")
        _optional_digest(self.manifest_digest, field="manifest_digest")
        _optional_digest(self.synthetic_fixture_digest, field="synthetic_fixture_digest")
        _optional_digest(self.synthetic_schema_digest, field="synthetic_schema_digest")
        if not isinstance(self.real_coverage_status, RealCoverageStatus):
            raise ContractValueError("real_coverage_status must be RealCoverageStatus")
        if not isinstance(self.delivery_status, DeliveryStatus):
            raise ContractValueError("delivery_status must be DeliveryStatus")
        if self.tier is EventAtlasTier.HISTORICAL_COARSE:
            if (
                self.evidence_posture is not TierEvidencePosture.REAL_CHECKSUM_VERIFIED_ARCHIVE
                or self.manifest_digest is None
                or self.synthetic_fixture_digest is not None
                or self.synthetic_schema_digest is not None
                or self.real_coverage_status is not RealCoverageStatus.OBSERVED
                or self.delivery_status is not DeliveryStatus.AVAILABLE
            ):
                raise ContractValueError(
                    "historical tier must bind only observed real archive evidence"
                )
        elif (
            self.evidence_posture is not TierEvidencePosture.SYNTHETIC_CONTRACT_ONLY
            or self.manifest_digest is not None
            or self.synthetic_fixture_digest is None
            or self.synthetic_schema_digest is None
            or self.real_coverage_status is not RealCoverageStatus.MISSING
            or self.delivery_status is not DeliveryStatus.BLOCKED
        ):
            raise ContractValueError(
                "forward tier must remain synthetic-only with real coverage MISSING/BLOCKED"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "coverageSha256": self.coverage_digest.hexdigest,
            "deliveryStatus": self.delivery_status.value,
            "evidencePosture": self.evidence_posture.value,
            "manifestSha256": (
                None if self.manifest_digest is None else self.manifest_digest.hexdigest
            ),
            "realCoverageStatus": self.real_coverage_status.value,
            "schema": "AtlasTierDescriptorV1",
            "syntheticFixtureSha256": (
                None
                if self.synthetic_fixture_digest is None
                else self.synthetic_fixture_digest.hexdigest
            ),
            "syntheticSchemaSha256": (
                None
                if self.synthetic_schema_digest is None
                else self.synthetic_schema_digest.hexdigest
            ),
            "tier": self.tier.value,
            "version": 1,
        }


@dataclass(frozen=True, slots=True)
class DiscoveryRuleV1:
    rule_id: str
    rule_version: str
    metric: DiscoveryMetric
    basis: DiscoveryBasis
    window_ns: int
    threshold_numerator: int
    threshold_denominator: int
    lookback_windows: int

    def __post_init__(self) -> None:
        require_id(self.rule_id, field="rule_id")
        require_id(self.rule_version, field="rule_version")
        if not isinstance(self.metric, DiscoveryMetric):
            raise ContractValueError("metric must be DiscoveryMetric")
        if not isinstance(self.basis, DiscoveryBasis):
            raise ContractValueError("basis must be DiscoveryBasis")
        require_strict_int(self.window_ns, field="window_ns", minimum=1, maximum=MAX_WINDOW_NS)
        require_strict_int(
            self.threshold_numerator,
            field="threshold_numerator",
            minimum=1,
            maximum=MAX_COUNT,
        )
        require_strict_int(
            self.threshold_denominator,
            field="threshold_denominator",
            minimum=1,
            maximum=MAX_COUNT,
        )
        require_strict_int(
            self.lookback_windows,
            field="lookback_windows",
            minimum=0,
            maximum=MAX_LOOKBACK_WINDOWS,
        )
        if self.basis is DiscoveryBasis.ABSOLUTE and self.lookback_windows != 0:
            raise ContractValueError("absolute rules cannot have lookback windows")
        if self.basis is not DiscoveryBasis.ABSOLUTE and self.lookback_windows == 0:
            raise ContractValueError("relative rules require lookback windows")
        if (
            self.metric is DiscoveryMetric.TRADE_COUNT
            and self.basis is DiscoveryBasis.PREVIOUS_WINDOW_MAX
        ):
            raise ContractValueError("trade-count relative rules use the previous-window mean")
        if (
            self.metric is DiscoveryMetric.PRICE_RANGE
            and self.basis is DiscoveryBasis.PREVIOUS_WINDOW_MEAN
        ):
            raise ContractValueError("price-range relative rules use the previous-window maximum")

    def as_mapping(self) -> dict[str, object]:
        return {
            "basis": self.basis.value,
            "comparison": "GREATER_THAN_OR_EQUAL_EXACT",
            "lookbackWindows": self.lookback_windows,
            "metric": self.metric.value,
            "ruleId": self.rule_id,
            "ruleVersion": self.rule_version,
            "schema": "DiscoveryRuleV1",
            "thresholdDenominator": str(self.threshold_denominator),
            "thresholdNumerator": str(self.threshold_numerator),
            "version": 1,
            "windowNs": str(self.window_ns),
        }


def default_discovery_rules() -> tuple[DiscoveryRuleV1, ...]:
    window_ns = 300_000_000_000
    return (
        DiscoveryRuleV1(
            "absolute.price-range.5m.v1",
            "v1",
            DiscoveryMetric.PRICE_RANGE,
            DiscoveryBasis.ABSOLUTE,
            window_ns,
            1,
            20,
            0,
        ),
        DiscoveryRuleV1(
            "absolute.trade-count.5m.v1",
            "v1",
            DiscoveryMetric.TRADE_COUNT,
            DiscoveryBasis.ABSOLUTE,
            window_ns,
            250,
            1,
            0,
        ),
        DiscoveryRuleV1(
            "relative.price-range.previous-max.5m.v1",
            "v1",
            DiscoveryMetric.PRICE_RANGE,
            DiscoveryBasis.PREVIOUS_WINDOW_MAX,
            window_ns,
            2,
            1,
            3,
        ),
        DiscoveryRuleV1(
            "relative.trade-count.previous-mean.5m.v1",
            "v1",
            DiscoveryMetric.TRADE_COUNT,
            DiscoveryBasis.PREVIOUS_WINDOW_MEAN,
            window_ns,
            3,
            1,
            3,
        ),
    )


@dataclass(frozen=True, slots=True)
class HistoricalAtlasInputV1:
    rows: tuple[ReferenceMarketEvidenceRowV1, ...]
    manifest_digest: DigestV1
    manifest_published_at_ns: int
    coverage_digest: DigestV1
    invalid_row_count: int
    known_gap_count: int
    duplicate_row_count: int

    def __post_init__(self) -> None:
        if not isinstance(self.rows, tuple) or not 1 <= len(self.rows) <= MAX_ATLAS_ROWS:
            raise ContractValueError("rows must be a non-empty bounded immutable tuple")
        if any(not isinstance(row, ReferenceMarketEvidenceRowV1) for row in self.rows):
            raise ContractValueError("rows must contain validated Q02 evidence rows")
        if any(row.posture is EvidencePosture.SYNTHETIC for row in self.rows):
            raise ContractValueError(
                "historical atlas cannot treat synthetic rows as real evidence"
            )
        if not isinstance(self.manifest_digest, DigestV1):
            raise ContractValueError("manifest_digest must be DigestV1")
        require_strict_int(
            self.manifest_published_at_ns,
            field="manifest_published_at_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        if not isinstance(self.coverage_digest, DigestV1):
            raise ContractValueError("coverage_digest must be DigestV1")
        _count(self.invalid_row_count, field="invalid_row_count")
        _count(self.known_gap_count, field="known_gap_count")
        _count(self.duplicate_row_count, field="duplicate_row_count")
        record_ids = tuple(row.record_id for row in self.rows)
        if len(record_ids) != len(set(record_ids)):
            raise ContractValueError("historical rows must have unique record IDs")
        if any(
            self.manifest_published_at_ns < row.normalization_time_ns
            or self.manifest_published_at_ns < row.persistence_time_ns
            for row in self.rows
        ):
            raise ContractValueError(
                "manifest publication must not precede row normalization or persistence"
            )


@dataclass(frozen=True, slots=True)
class PointInTimeInstrumentV1:
    venue: str
    product: str
    symbol: str
    base_asset_id: str
    quote_asset_id: str
    instrument_version: str
    observed_at_ns: int
    missing_identity_fields: tuple[str, ...]
    identity_posture: InstrumentIdentityPosture = InstrumentIdentityPosture.OBSERVED_ROW_FIELDS_ONLY
    economics_posture: EconomicsPosture = EconomicsPosture.UNAVAILABLE

    def __post_init__(self) -> None:
        for name in (
            "venue",
            "product",
            "symbol",
            "base_asset_id",
            "quote_asset_id",
            "instrument_version",
        ):
            require_id(getattr(self, name), field=name)
        require_strict_int(self.observed_at_ns, field="observed_at_ns", minimum=0)
        _sorted_ids(self.missing_identity_fields, field="missing_identity_fields", maximum=16)
        if not self.missing_identity_fields:
            raise ContractValueError("row-only instrument identity must report missing fields")
        if self.identity_posture is not InstrumentIdentityPosture.OBSERVED_ROW_FIELDS_ONLY:
            raise ContractValueError("Q03 instrument identity is row-field evidence only")
        if self.economics_posture is not EconomicsPosture.UNAVAILABLE:
            raise ContractValueError("Q03 does not provide point-in-time economics")

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseAssetId": self.base_asset_id,
            "economicsPosture": self.economics_posture.value,
            "identityPosture": self.identity_posture.value,
            "instrumentVersion": self.instrument_version,
            "missingIdentityFields": list(self.missing_identity_fields),
            "observedAtNs": str(self.observed_at_ns),
            "product": self.product,
            "quoteAssetId": self.quote_asset_id,
            "schema": "PointInTimeInstrumentV1",
            "symbol": self.symbol,
            "venue": self.venue,
            "version": 1,
        }


@dataclass(frozen=True, slots=True)
class AtlasWindowRecordV1:
    record_id: str
    inventory_class: InventoryClass
    window_start_ns: int
    window_end_ns: int
    row_count: int
    known_gap_row_count: int
    duplicate_row_count: int
    late_row_count: int
    matched_rule_ids: tuple[str, ...]
    unevaluable_rule_ids: tuple[str, ...]
    pre_window_evidence_digest: DigestV1 | None
    evolution_evidence_digest: DigestV1
    source_coverage_digest: DigestV1
    instrument: PointInTimeInstrumentV1
    later_outcomes_status: EvidenceAvailability = EvidenceAvailability.UNAVAILABLE

    def __post_init__(self) -> None:
        require_id(self.record_id, field="record_id")
        if not isinstance(self.inventory_class, InventoryClass):
            raise ContractValueError("inventory_class must be InventoryClass")
        start = require_strict_int(self.window_start_ns, field="window_start_ns", minimum=0)
        end = require_strict_int(self.window_end_ns, field="window_end_ns", minimum=1)
        if start >= end:
            raise ContractValueError("window start must precede window end")
        _count(self.row_count, field="row_count", maximum=MAX_ATLAS_ROWS)
        if self.row_count == 0:
            raise ContractValueError("materialized windows cannot be empty")
        for name in ("known_gap_row_count", "duplicate_row_count", "late_row_count"):
            _count(getattr(self, name), field=name, maximum=self.row_count)
        _sorted_ids(self.matched_rule_ids, field="matched_rule_ids", maximum=MAX_ATLAS_RULES)
        _sorted_ids(
            self.unevaluable_rule_ids,
            field="unevaluable_rule_ids",
            maximum=MAX_ATLAS_RULES,
        )
        if set(self.matched_rule_ids).intersection(self.unevaluable_rule_ids):
            raise ContractValueError("a rule cannot be matched and unevaluable")
        if self.inventory_class is InventoryClass.CANDIDATE and not self.matched_rule_ids:
            raise ContractValueError("candidate windows must match at least one discovery rule")
        if self.inventory_class is InventoryClass.CONTROL and self.matched_rule_ids:
            raise ContractValueError("control windows cannot match discovery rules")
        _optional_digest(self.pre_window_evidence_digest, field="pre_window_evidence_digest")
        for name in ("evolution_evidence_digest", "source_coverage_digest"):
            if not isinstance(getattr(self, name), DigestV1):
                raise ContractValueError(f"{name} must be DigestV1")
        if not isinstance(self.instrument, PointInTimeInstrumentV1):
            raise ContractValueError("instrument must be PointInTimeInstrumentV1")
        if not self.window_start_ns <= self.instrument.observed_at_ns < self.window_end_ns:
            raise ContractValueError(
                "instrument observed_at_ns must identify evidence inside the discovery window"
            )
        if self.later_outcomes_status is not EvidenceAvailability.UNAVAILABLE:
            raise ContractValueError("Q03 later outcomes must remain UNAVAILABLE")

    def as_mapping(self) -> dict[str, object]:
        return {
            "duplicateRowCount": self.duplicate_row_count,
            "evolutionEvidenceSha256": self.evolution_evidence_digest.hexdigest,
            "instrument": self.instrument.as_mapping(),
            "inventoryClass": self.inventory_class.value,
            "knownGapRowCount": self.known_gap_row_count,
            "lateRowCount": self.late_row_count,
            "laterOutcomesStatus": self.later_outcomes_status.value,
            "matchedRuleIds": list(self.matched_rule_ids),
            "preWindowEvidenceSha256": (
                None
                if self.pre_window_evidence_digest is None
                else self.pre_window_evidence_digest.hexdigest
            ),
            "recordId": self.record_id,
            "rowCount": self.row_count,
            "schema": "AtlasWindowRecordV1",
            "sourceCoverageSha256": self.source_coverage_digest.hexdigest,
            "unevaluableRuleIds": list(self.unevaluable_rule_ids),
            "version": 1,
            "windowEndNs": str(self.window_end_ns),
            "windowStartNs": str(self.window_start_ns),
        }


@dataclass(frozen=True, slots=True)
class EventAtlasV1:
    revision: str
    as_of_ms: int
    tiers: tuple[AtlasTierDescriptorV1, ...]
    rules: tuple[DiscoveryRuleV1, ...]
    candidates: tuple[AtlasWindowRecordV1, ...]
    controls: tuple[AtlasWindowRecordV1, ...]
    total_candidate_count: int
    total_control_count: int
    omitted_candidate_count: int
    omitted_control_count: int
    omitted_candidate_row_count: int
    omitted_control_row_count: int
    historical_row_count: int
    invalid_row_count: int
    known_gap_count: int
    duplicate_row_count: int
    symbols: tuple[str, ...]
    products: tuple[str, ...]
    utc_dates: tuple[str, ...]

    def __post_init__(self) -> None:
        require_id(self.revision, field="revision")
        require_utc_millis(self.as_of_ms, field="as_of_ms")
        if not isinstance(self.tiers, tuple) or any(
            not isinstance(tier, AtlasTierDescriptorV1) for tier in self.tiers
        ):
            raise ContractValueError("tiers must be an immutable tuple of AtlasTierDescriptorV1")
        if tuple(tier.tier for tier in self.tiers) != tuple(EventAtlasTier):
            raise ContractValueError("tiers must contain the fixed two tiers in canonical order")
        if (
            not isinstance(self.rules, tuple)
            or not 1 <= len(self.rules) <= MAX_ATLAS_RULES
            or any(not isinstance(rule, DiscoveryRuleV1) for rule in self.rules)
        ):
            raise ContractValueError(
                "rules must be a non-empty bounded immutable tuple of DiscoveryRuleV1"
            )
        rule_ids = tuple(rule.rule_id for rule in self.rules)
        if rule_ids != tuple(sorted(set(rule_ids))):
            raise ContractValueError("rules must be sorted by unique rule ID")
        windows = {rule.window_ns for rule in self.rules}
        if len(windows) != 1:
            raise ContractValueError("one atlas revision must use one fixed discovery window")
        discovery_window_ns = next(iter(windows))
        for records, expected_class, field in (
            (self.candidates, InventoryClass.CANDIDATE, "candidates"),
            (self.controls, InventoryClass.CONTROL, "controls"),
        ):
            if not isinstance(records, tuple) or len(records) > MAX_ATLAS_RECORDS_PER_CLASS:
                raise ContractValueError(f"{field} must be a bounded immutable tuple")
            if any(not isinstance(record, AtlasWindowRecordV1) for record in records):
                raise ContractValueError(f"{field} must contain AtlasWindowRecordV1")
            if any(record.inventory_class is not expected_class for record in records):
                raise ContractValueError(f"{field} contains the wrong inventory class")
            ids = tuple(record.record_id for record in records)
            if ids != tuple(sorted(set(ids))):
                raise ContractValueError(f"{field} must be sorted by unique record ID")
        for name in (
            "total_candidate_count",
            "total_control_count",
            "omitted_candidate_count",
            "omitted_control_count",
            "omitted_candidate_row_count",
            "omitted_control_row_count",
            "historical_row_count",
            "invalid_row_count",
            "known_gap_count",
            "duplicate_row_count",
        ):
            _count(getattr(self, name), field=name)
        if self.total_candidate_count != len(self.candidates) + self.omitted_candidate_count:
            raise ContractValueError("candidate total does not reconcile with retained inventory")
        if self.total_control_count != len(self.controls) + self.omitted_control_count:
            raise ContractValueError("control total does not reconcile with retained inventory")
        if (self.omitted_candidate_count == 0) != (self.omitted_candidate_row_count == 0):
            raise ContractValueError(
                "omitted candidate count and row count must both be zero or nonzero"
            )
        if (self.omitted_control_count == 0) != (self.omitted_control_row_count == 0):
            raise ContractValueError(
                "omitted control count and row count must both be zero or nonzero"
            )
        if self.omitted_candidate_row_count < self.omitted_candidate_count:
            raise ContractValueError("every omitted candidate window must contain at least one row")
        if self.omitted_control_row_count < self.omitted_control_count:
            raise ContractValueError("every omitted control window must contain at least one row")
        retained = (*self.candidates, *self.controls)
        bound_row_count = (
            sum(record.row_count for record in retained)
            + self.omitted_candidate_row_count
            + self.omitted_control_row_count
        )
        if self.historical_row_count != bound_row_count:
            raise ContractValueError(
                "historical row count does not reconcile with window inventory"
            )
        registered_rule_ids = set(rule_ids)
        historical_coverage = self.tiers[0].coverage_digest
        cutoff_ns = self.as_of_ms * 1_000_000
        for record in retained:
            referenced_rule_ids = set(record.matched_rule_ids).union(record.unevaluable_rule_ids)
            if not referenced_rule_ids.issubset(registered_rule_ids):
                raise ContractValueError("window record references a rule outside the registry")
            if record.source_coverage_digest != historical_coverage:
                raise ContractValueError(
                    "window record coverage must equal historical tier coverage"
                )
            if (
                record.window_start_ns % discovery_window_ns != 0
                or record.window_end_ns - record.window_start_ns != discovery_window_ns
            ):
                raise ContractValueError(
                    "window record boundaries must align to the registry discovery window"
                )
            if record.window_end_ns > cutoff_ns:
                raise ContractValueError(
                    "discovery window ends after as_of cutoff; partial windows are unsupported"
                )
        _sorted_ids(self.symbols, field="symbols", maximum=MAX_ATLAS_ROWS)
        _sorted_ids(self.products, field="products", maximum=64)
        if self.utc_dates != tuple(sorted(set(self.utc_dates))) or not all(
            _is_canonical_date(value) for value in self.utc_dates
        ):
            raise ContractValueError("utc_dates must be sorted unique canonical date strings")

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfMs": self.as_of_ms,
            "authorityPosture": "RESEARCH_ONLY_NO_ACTION_AUTHORITY",
            "inventory": {
                "candidateCount": self.total_candidate_count,
                "candidates": [record.as_mapping() for record in self.candidates],
                "controlCount": self.total_control_count,
                "controls": [record.as_mapping() for record in self.controls],
                "duplicateRowCount": self.duplicate_row_count,
                "historicalRowCount": self.historical_row_count,
                "invalidRowCount": self.invalid_row_count,
                "knownGapCount": self.known_gap_count,
                "omittedCandidateCount": self.omitted_candidate_count,
                "omittedCandidateRowCount": self.omitted_candidate_row_count,
                "omittedControlCount": self.omitted_control_count,
                "omittedControlRowCount": self.omitted_control_row_count,
                "products": list(self.products),
                "symbols": list(self.symbols),
                "utcDates": list(self.utc_dates),
            },
            "laterOutcomesStatus": EvidenceAvailability.UNAVAILABLE.value,
            "revision": self.revision,
            "ruleSemantics": "DISCOVERY_ONLY_NOT_EVENT_TRUTH",
            "rules": [rule.as_mapping() for rule in self.rules],
            "schema": "EventAtlasV1",
            "tiers": [tier.as_mapping() for tier in self.tiers],
            "truthPosture": "RESEARCH_ONLY",
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()


@dataclass(frozen=True, slots=True)
class _Window:
    key: tuple[str, str, str, str, str, str, str, int]
    rows: tuple[ReferenceMarketEvidenceRowV1, ...]
    price_range: tuple[int, int] | None
    evidence_digest: DigestV1


def _scaled_pair(values: tuple[ExactScaledValueV1, ...]) -> tuple[int, int] | None:
    if not values:
        return None
    units = {value.unit_id for value in values}
    if len(units) != 1:
        return None
    scale = max(value.scale for value in values)
    coefficients = tuple(value.coefficient * (10 ** (scale - value.scale)) for value in values)
    low = min(coefficients)
    high = max(coefficients)
    if low <= 0:
        return None
    return high - low, low


def _window_evidence(rows: tuple[ReferenceMarketEvidenceRowV1, ...]) -> DigestV1:
    mapping = [
        {
            "eventTimeNs": str(row.event_time.normalized_ns),
            "rawPayloadSha256": row.raw_payload_digest.hexdigest,
            "recordId": row.record_id,
        }
        for row in rows
    ]
    return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


def _make_windows(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...], window_ns: int
) -> tuple[_Window, ...]:
    grouped: dict[
        tuple[str, str, str, str, str, str, str, int],
        list[ReferenceMarketEvidenceRowV1],
    ] = defaultdict(list)
    for row in rows:
        bucket = row.event_time.normalized_ns // window_ns * window_ns
        key = (
            row.venue,
            row.product,
            row.event_kind,
            row.symbol,
            row.base_asset_id,
            row.quote_asset_id,
            row.instrument_version,
            bucket,
        )
        grouped[key].append(row)
    windows = []
    for key, values in grouped.items():
        ordered = tuple(sorted(values, key=lambda row: row.canonical_order_key))
        prices = tuple(row.price for row in ordered if row.price is not None)
        windows.append(
            _Window(
                key=key,
                rows=ordered,
                price_range=_scaled_pair(prices),
                evidence_digest=_window_evidence(ordered),
            )
        )
    return tuple(sorted(windows, key=lambda window: window.key))


def _eligible_baseline(
    rule: DiscoveryRuleV1,
    current: _Window,
    previous: tuple[_Window, ...],
) -> tuple[_Window, ...] | None:
    if rule.basis is DiscoveryBasis.ABSOLUTE:
        return ()
    eligible = previous[-rule.lookback_windows :] if rule.lookback_windows else ()
    expected_starts = tuple(
        current.key[-1] - rule.window_ns * distance
        for distance in range(rule.lookback_windows, 0, -1)
    )
    if (
        len(eligible) != rule.lookback_windows
        or tuple(window.key[-1] for window in eligible) != expected_starts
    ):
        return None
    return eligible


def _pre_window_evidence(
    current: _Window,
    previous: tuple[_Window, ...],
    rules: tuple[DiscoveryRuleV1, ...],
) -> DigestV1 | None:
    bindings: list[dict[str, object]] = []
    for rule in rules:
        if rule.basis is DiscoveryBasis.ABSOLUTE:
            continue
        eligible = _eligible_baseline(rule, current, previous)
        if eligible is None:
            continue
        bindings.append(
            {
                "ruleId": rule.rule_id,
                "windows": [
                    {
                        "evidenceSha256": window.evidence_digest.hexdigest,
                        "windowStartNs": str(window.key[-1]),
                    }
                    for window in eligible
                ],
            }
        )
    if not bindings:
        return None
    return DigestV1(hashlib.sha256(canonical_json_bytes(bindings)).hexdigest())


def _rule_matches(
    rule: DiscoveryRuleV1,
    current: _Window,
    previous: tuple[_Window, ...],
) -> bool | None:
    eligible = _eligible_baseline(rule, current, previous)
    if eligible is None:
        return None
    if rule.metric is DiscoveryMetric.TRADE_COUNT:
        observed = len(current.rows)
        if rule.basis is DiscoveryBasis.ABSOLUTE:
            return observed * rule.threshold_denominator >= rule.threshold_numerator
        baseline_sum = sum(len(window.rows) for window in eligible)
        return (
            observed * len(eligible) * rule.threshold_denominator
            >= baseline_sum * rule.threshold_numerator
        )
    observed_range = current.price_range
    if observed_range is None:
        return None
    observed_numerator, observed_denominator = observed_range
    if rule.basis is DiscoveryBasis.ABSOLUTE:
        return (
            observed_numerator * rule.threshold_denominator
            >= observed_denominator * rule.threshold_numerator
        )
    eligible_ranges = tuple(window.price_range for window in eligible)
    if any(value is None for value in eligible_ranges):
        return None
    concrete = tuple(value for value in eligible_ranges if value is not None)
    baseline_numerator, baseline_denominator = concrete[0]
    for numerator, denominator in concrete[1:]:
        if numerator * baseline_denominator > baseline_numerator * denominator:
            baseline_numerator, baseline_denominator = numerator, denominator
    if baseline_numerator == 0:
        return None
    return (
        observed_numerator * baseline_denominator * rule.threshold_denominator
        >= observed_denominator * baseline_numerator * rule.threshold_numerator
    )


def _record(
    window: _Window,
    *,
    previous: tuple[_Window, ...],
    rules: tuple[DiscoveryRuleV1, ...],
    coverage_digest: DigestV1,
    window_ns: int,
) -> AtlasWindowRecordV1:
    matched: list[str] = []
    unevaluable: list[str] = []
    for rule in rules:
        result = _rule_matches(rule, window, previous)
        if result is True:
            matched.append(rule.rule_id)
        elif result is None:
            unevaluable.append(rule.rule_id)
    inventory_class = InventoryClass.CANDIDATE if matched else InventoryClass.CONTROL
    *identity, start_ns = window.key
    venue, product, _event_kind, symbol, base, quote, instrument_version = identity
    core = {
        "evolutionEvidenceSha256": window.evidence_digest.hexdigest,
        "inventoryClass": inventory_class.value,
        "windowStartNs": str(start_ns),
    }
    record_id = f"atlas-window-{hashlib.sha256(canonical_json_bytes(core)).hexdigest()}"
    pre_digest = _pre_window_evidence(window, previous, rules)
    missing_identity_fields = [
        "EFFECTIVE_DATED_FILTERS",
        "FEE_SCHEDULE",
        "LISTING_STATUS",
    ]
    if base.startswith("UNKNOWN"):
        missing_identity_fields.append("BASE_ASSET_ID")
    if quote.startswith("UNKNOWN"):
        missing_identity_fields.append("QUOTE_ASSET_ID")
    return AtlasWindowRecordV1(
        record_id=record_id,
        inventory_class=inventory_class,
        window_start_ns=start_ns,
        window_end_ns=start_ns + window_ns,
        row_count=len(window.rows),
        known_gap_row_count=sum(row.quality.state is QualityState.GAPPED for row in window.rows),
        duplicate_row_count=sum(row.duplicate for row in window.rows),
        late_row_count=sum(row.late for row in window.rows),
        matched_rule_ids=tuple(matched),
        unevaluable_rule_ids=tuple(unevaluable),
        pre_window_evidence_digest=pre_digest,
        evolution_evidence_digest=window.evidence_digest,
        source_coverage_digest=coverage_digest,
        instrument=PointInTimeInstrumentV1(
            venue=venue,
            product=product,
            symbol=symbol,
            base_asset_id=base,
            quote_asset_id=quote,
            instrument_version=instrument_version,
            observed_at_ns=min(row.event_time.normalized_ns for row in window.rows),
            missing_identity_fields=tuple(sorted(missing_identity_fields)),
        ),
    )


def build_event_atlas(
    *,
    revision: str,
    as_of_ms: int,
    historical: HistoricalAtlasInputV1,
    forward_coverage_digest: DigestV1,
    forward_fixture_digest: DigestV1,
    forward_schema_digest: DigestV1,
    rules: tuple[DiscoveryRuleV1, ...] | None = None,
    max_candidates: int = MAX_ATLAS_RECORDS_PER_CLASS,
    max_controls: int = MAX_ATLAS_RECORDS_PER_CLASS,
) -> EventAtlasV1:
    """Materialize bounded research evidence; never infer labels, outcomes or actions."""
    require_id(revision, field="revision")
    require_utc_millis(as_of_ms, field="as_of_ms")
    if not isinstance(historical, HistoricalAtlasInputV1):
        raise ContractValueError("historical must be HistoricalAtlasInputV1")
    cutoff_ns = as_of_ms * 1_000_000
    if any(row.normalization_time_ns > cutoff_ns for row in historical.rows):
        raise ContractValueError("row normalization time is after the EventAtlas as_of cutoff")
    if any(row.persistence_time_ns > cutoff_ns for row in historical.rows):
        raise ContractValueError("row persistence time is after the EventAtlas as_of cutoff")
    if historical.manifest_published_at_ns > cutoff_ns:
        raise ContractValueError("manifest publication is after the EventAtlas as_of cutoff")
    for name, value in (
        ("forward_coverage_digest", forward_coverage_digest),
        ("forward_fixture_digest", forward_fixture_digest),
        ("forward_schema_digest", forward_schema_digest),
    ):
        if not isinstance(value, DigestV1):
            raise ContractValueError(f"{name} must be DigestV1")
    candidate_limit = _count(
        max_candidates,
        field="max_candidates",
        maximum=MAX_ATLAS_RECORDS_PER_CLASS,
    )
    control_limit = _count(
        max_controls,
        field="max_controls",
        maximum=MAX_ATLAS_RECORDS_PER_CLASS,
    )
    selected_rules = default_discovery_rules() if rules is None else rules
    if not isinstance(selected_rules, tuple) or not 1 <= len(selected_rules) <= MAX_ATLAS_RULES:
        raise ContractValueError("rules must be a non-empty bounded immutable tuple")
    if any(not isinstance(rule, DiscoveryRuleV1) for rule in selected_rules):
        raise ContractValueError("rules must contain DiscoveryRuleV1 values")
    selected_rules = tuple(sorted(selected_rules, key=lambda rule: rule.rule_id))
    if len({rule.rule_id for rule in selected_rules}) != len(selected_rules):
        raise ContractValueError("rule IDs must be unique")
    windows_ns = {rule.window_ns for rule in selected_rules}
    if len(windows_ns) != 1:
        raise ContractValueError("one atlas build requires one fixed window size")
    window_ns = next(iter(windows_ns))
    windows = _make_windows(historical.rows, window_ns)
    if any(window.key[-1] + window_ns > cutoff_ns for window in windows):
        raise ContractValueError(
            "discovery window ends after as_of cutoff; partial windows are unsupported"
        )
    previous_by_identity: dict[tuple[str, ...], list[_Window]] = defaultdict(list)
    records: list[AtlasWindowRecordV1] = []
    for window in windows:
        identity = window.key[:-1]
        previous = tuple(previous_by_identity[identity])
        records.append(
            _record(
                window,
                previous=previous,
                rules=selected_rules,
                coverage_digest=historical.coverage_digest,
                window_ns=window_ns,
            )
        )
        previous_by_identity[identity].append(window)
    candidates = tuple(
        sorted(
            (r for r in records if r.inventory_class is InventoryClass.CANDIDATE),
            key=lambda r: r.record_id,
        )
    )
    controls = tuple(
        sorted(
            (r for r in records if r.inventory_class is InventoryClass.CONTROL),
            key=lambda r: r.record_id,
        )
    )
    retained_candidates = candidates[:candidate_limit]
    retained_controls = controls[:control_limit]
    omitted_candidates = candidates[candidate_limit:]
    omitted_controls = controls[control_limit:]
    utc_dates = tuple(
        sorted(
            {
                datetime.fromtimestamp(
                    row.event_time.normalized_ns // 1_000_000_000,
                    tz=UTC,
                )
                .date()
                .isoformat()
                for row in historical.rows
            }
        )
    )
    return EventAtlasV1(
        revision=revision,
        as_of_ms=as_of_ms,
        tiers=(
            AtlasTierDescriptorV1(
                tier=EventAtlasTier.HISTORICAL_COARSE,
                evidence_posture=TierEvidencePosture.REAL_CHECKSUM_VERIFIED_ARCHIVE,
                coverage_digest=historical.coverage_digest,
                manifest_digest=historical.manifest_digest,
                synthetic_fixture_digest=None,
                synthetic_schema_digest=None,
                real_coverage_status=RealCoverageStatus.OBSERVED,
                delivery_status=DeliveryStatus.AVAILABLE,
            ),
            AtlasTierDescriptorV1(
                tier=EventAtlasTier.FORWARD_HIGH_FIDELITY,
                evidence_posture=TierEvidencePosture.SYNTHETIC_CONTRACT_ONLY,
                coverage_digest=forward_coverage_digest,
                manifest_digest=None,
                synthetic_fixture_digest=forward_fixture_digest,
                synthetic_schema_digest=forward_schema_digest,
                real_coverage_status=RealCoverageStatus.MISSING,
                delivery_status=DeliveryStatus.BLOCKED,
            ),
        ),
        rules=selected_rules,
        candidates=retained_candidates,
        controls=retained_controls,
        total_candidate_count=len(candidates),
        total_control_count=len(controls),
        omitted_candidate_count=len(omitted_candidates),
        omitted_control_count=len(omitted_controls),
        omitted_candidate_row_count=sum(record.row_count for record in omitted_candidates),
        omitted_control_row_count=sum(record.row_count for record in omitted_controls),
        historical_row_count=len(historical.rows),
        invalid_row_count=historical.invalid_row_count,
        known_gap_count=historical.known_gap_count,
        duplicate_row_count=historical.duplicate_row_count,
        symbols=tuple(sorted({row.symbol for row in historical.rows})),
        products=tuple(sorted({row.product for row in historical.rows})),
        utc_dates=utc_dates,
    )


def render_event_atlas_markdown(atlas: EventAtlasV1) -> str:
    if not isinstance(atlas, EventAtlasV1):
        raise ContractValueError("atlas must be EventAtlasV1")
    lines = [
        "# Event Atlas V1",
        "",
        f"Registry revision: `{atlas.revision}`",
        f"Registry SHA-256: `{atlas.sha256}`",
        "Truth posture: `RESEARCH_ONLY`; rules are discovery descriptors, not event truth.",
        "Later outcomes: `UNAVAILABLE`.",
        "",
        "## Evidence tiers",
        "",
    ]
    for tier in atlas.tiers:
        lines.append(
            f"- `{tier.tier.value}`: `{tier.evidence_posture.value}`; "
            f"real coverage `{tier.real_coverage_status.value}`; delivery "
            f"`{tier.delivery_status.value}`; coverage `{tier.coverage_digest.hexdigest}`"
        )
    lines.extend(
        [
            "",
            "## Discovery rules",
            "",
            *(
                f"- `{rule.rule_id}` `{rule.rule_version}`: `{rule.metric.value}` / "
                f"`{rule.basis.value}` >= "
                f"`{rule.threshold_numerator}/{rule.threshold_denominator}` "
                f"over `{rule.window_ns}` ns"
                for rule in atlas.rules
            ),
            "",
            "## Bounded inventory",
            "",
            f"- Historical rows: `{atlas.historical_row_count}`",
            f"- Candidates: `{atlas.total_candidate_count}` retained `{len(atlas.candidates)}` "
            f"omitted `{atlas.omitted_candidate_count}`",
            f"- Controls: `{atlas.total_control_count}` retained `{len(atlas.controls)}` "
            f"omitted `{atlas.omitted_control_count}`",
            f"- Known gaps / invalid / duplicate: `{atlas.known_gap_count}` / "
            f"`{atlas.invalid_row_count}` / `{atlas.duplicate_row_count}`",
            f"- Symbols: `{', '.join(atlas.symbols)}`",
            f"- Products: `{', '.join(atlas.products)}`",
            f"- UTC dates: `{', '.join(atlas.utc_dates)}`",
            "",
            "Every retained record binds source coverage, row-derived instrument identity, "
            "available pre/evolution evidence, and an explicit unavailable "
            "economics/outcome posture.",
        ]
    )
    return "\n".join(lines) + "\n"


def verify_event_atlas_markdown(markdown: str, atlas: EventAtlasV1) -> None:
    if markdown != render_event_atlas_markdown(atlas):
        raise ContractValueError("Markdown differs from the deterministic EventAtlas projection")
