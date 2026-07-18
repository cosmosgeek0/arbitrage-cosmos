from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    require_contract_id,
    require_path_segment,
    require_strict_int,
)

MAX_MASTER_SNAPSHOTS: Final = 10_000
MAX_MASTER_COVERAGE_INTERVALS: Final = 20_000
MAX_INSTRUMENT_INTERVALS: Final = 100_000
MAX_INSTRUMENT_MIGRATIONS: Final = 10_000


class InstrumentLifecycle(StrEnum):
    LISTED = "LISTED"
    TRADING = "TRADING"
    HALTED = "HALTED"
    DELISTED = "DELISTED"


class BorrowEligibility(StrEnum):
    ELIGIBLE = "ELIGIBLE"
    INELIGIBLE = "INELIGIBLE"
    UNKNOWN = "UNKNOWN"


class ArchiveCoverage(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    UNAVAILABLE = "UNAVAILABLE"


class InstrumentResolutionStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    NOT_LISTED = "NOT_LISTED"
    UNAVAILABLE = "UNAVAILABLE"


class HorizonStatus(StrEnum):
    STABLE = "STABLE"
    BLOCKED = "BLOCKED"


class MigrationKind(StrEnum):
    SYMBOL = "SYMBOL"
    ASSET = "ASSET"
    CONTRACT = "CONTRACT"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_optional_contract_id(value: str | None, *, field: str) -> None:
    if value is not None:
        require_contract_id(value, field=field)


def _scaled_is_positive(value: ExactScaledValueV1) -> bool:
    return value.coefficient > 0


def _scaled_compare(left: ExactScaledValueV1, right: ExactScaledValueV1) -> int:
    if left.unit_id != right.unit_id:
        raise ContractValueError("scaled values must share one unit")
    left_integer = left.coefficient * (10**right.scale)
    right_integer = right.coefficient * (10**left.scale)
    if left_integer < right_integer:
        return -1
    if left_integer > right_integer:
        return 1
    return 0


def _combine_postures(
    postures: tuple[EvidencePosture | None, ...],
) -> EvidencePosture | None:
    available = tuple(posture for posture in postures if posture is not None)
    if not available:
        return None
    if EvidencePosture.SYNTHETIC in available:
        return EvidencePosture.SYNTHETIC
    if EvidencePosture.REPLAY in available:
        return EvidencePosture.REPLAY
    return EvidencePosture.LIVE


@dataclass(frozen=True, slots=True)
class InstrumentFiltersV1:
    """Exact exchange filter facts; absence remains null rather than a fabricated zero."""

    price_precision: int
    quantity_precision: int
    tick_size: ExactScaledValueV1
    step_size: ExactScaledValueV1
    min_quantity: ExactScaledValueV1
    max_quantity: ExactScaledValueV1 | None
    min_notional: ExactScaledValueV1 | None
    max_notional: ExactScaledValueV1 | None

    def __post_init__(self) -> None:
        require_strict_int(self.price_precision, field="price_precision", minimum=0, maximum=38)
        require_strict_int(
            self.quantity_precision,
            field="quantity_precision",
            minimum=0,
            maximum=38,
        )
        for field_name in ("tick_size", "step_size", "min_quantity"):
            value = getattr(self, field_name)
            if not isinstance(value, ExactScaledValueV1) or not _scaled_is_positive(value):
                raise ContractValueError(f"{field_name} must be a positive ExactScaledValueV1")
        for field_name in ("max_quantity", "min_notional", "max_notional"):
            value = getattr(self, field_name)
            if value is not None and (
                not isinstance(value, ExactScaledValueV1) or not _scaled_is_positive(value)
            ):
                raise ContractValueError(
                    f"{field_name} must be a positive ExactScaledValueV1 or null"
                )
        if self.max_quantity is not None and (
            _scaled_compare(self.min_quantity, self.max_quantity) > 0
        ):
            raise ContractValueError("min_quantity must not exceed max_quantity")
        if (
            self.min_notional is not None
            and self.max_notional is not None
            and _scaled_compare(self.min_notional, self.max_notional) > 0
        ):
            raise ContractValueError("min_notional must not exceed max_notional")


@dataclass(frozen=True, slots=True)
class ExchangeInfoSnapshotV1:
    snapshot_id: str
    venue: str
    product: str
    source_endpoint: str
    observed_at_ns: int
    payload_digest: DigestV1
    posture: EvidencePosture

    def __post_init__(self) -> None:
        require_contract_id(self.snapshot_id, field="snapshot_id")
        require_path_segment(self.venue, field="venue")
        require_path_segment(self.product, field="product")
        require_contract_id(self.source_endpoint, field="source_endpoint")
        _require_ns(self.observed_at_ns, field="observed_at_ns")
        if not isinstance(self.payload_digest, DigestV1):
            raise ContractValueError("payload_digest must be DigestV1")
        if not isinstance(self.posture, EvidencePosture):
            raise ContractValueError("posture must be EvidencePosture")


@dataclass(frozen=True, slots=True)
class MasterCoverageIntervalV1:
    """Archive coverage for one venue/product over a half-open UTC interval."""

    venue: str
    product: str
    valid_from_ns: int
    valid_until_ns: int
    state: ArchiveCoverage
    source_snapshot_id: str | None

    def __post_init__(self) -> None:
        require_path_segment(self.venue, field="venue")
        require_path_segment(self.product, field="product")
        start = _require_ns(self.valid_from_ns, field="valid_from_ns")
        end = _require_ns(self.valid_until_ns, field="valid_until_ns")
        if end <= start:
            raise ContractValueError("coverage valid_until_ns must follow valid_from_ns")
        if not isinstance(self.state, ArchiveCoverage):
            raise ContractValueError("state must be ArchiveCoverage")
        if self.state is ArchiveCoverage.UNAVAILABLE:
            if self.source_snapshot_id is not None:
                raise ContractValueError("UNAVAILABLE coverage cannot cite a source snapshot")
        elif self.source_snapshot_id is None:
            raise ContractValueError("available coverage must cite a source snapshot")
        else:
            require_contract_id(self.source_snapshot_id, field="source_snapshot_id")


@dataclass(frozen=True, slots=True)
class InstrumentMasterIntervalV1:
    """Point-in-time instrument truth over a half-open UTC interval."""

    canonical_instrument_id: str
    instrument_version: str
    venue: str
    product: str
    symbol: str
    base_asset_id: str
    quote_asset_id: str
    settlement_asset_id: str | None
    contract_id: str | None
    lifecycle: InstrumentLifecycle
    filters: InstrumentFiltersV1 | None
    borrow_eligibility: BorrowEligibility
    valid_from_ns: int
    valid_until_ns: int
    first_observed_ns: int
    last_observed_ns: int
    source_snapshot_id: str

    def __post_init__(self) -> None:
        for field_name in (
            "canonical_instrument_id",
            "instrument_version",
            "symbol",
            "base_asset_id",
            "quote_asset_id",
            "source_snapshot_id",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        require_path_segment(self.venue, field="venue")
        require_path_segment(self.product, field="product")
        _require_optional_contract_id(self.settlement_asset_id, field="settlement_asset_id")
        _require_optional_contract_id(self.contract_id, field="contract_id")
        if not isinstance(self.lifecycle, InstrumentLifecycle):
            raise ContractValueError("lifecycle must be InstrumentLifecycle")
        if self.filters is not None and not isinstance(self.filters, InstrumentFiltersV1):
            raise ContractValueError("filters must be InstrumentFiltersV1 or null")
        if self.lifecycle is InstrumentLifecycle.TRADING and self.filters is None:
            raise ContractValueError("TRADING intervals require exact filter truth")
        if not isinstance(self.borrow_eligibility, BorrowEligibility):
            raise ContractValueError("borrow_eligibility must be BorrowEligibility")
        start = _require_ns(self.valid_from_ns, field="valid_from_ns")
        end = _require_ns(self.valid_until_ns, field="valid_until_ns")
        first = _require_ns(self.first_observed_ns, field="first_observed_ns")
        last = _require_ns(self.last_observed_ns, field="last_observed_ns")
        if end <= start:
            raise ContractValueError("valid_until_ns must follow valid_from_ns")
        if last < first:
            raise ContractValueError("last_observed_ns must not precede first_observed_ns")
        if first < start or last >= end:
            raise ContractValueError(
                "first_observed_ns and last_observed_ns must fall inside the validity interval"
            )
        if self.filters is not None:
            if self.filters.tick_size.unit_id != self.quote_asset_id:
                raise ContractValueError("tick_size unit must equal quote_asset_id")
            for value in (
                self.filters.step_size,
                self.filters.min_quantity,
                self.filters.max_quantity,
            ):
                if value is not None and value.unit_id != self.base_asset_id:
                    raise ContractValueError("quantity filter units must equal base_asset_id")
            for value in (self.filters.min_notional, self.filters.max_notional):
                if value is not None and value.unit_id != self.quote_asset_id:
                    raise ContractValueError("notional filter units must equal quote_asset_id")


@dataclass(frozen=True, slots=True)
class InstrumentMigrationV1:
    migration_id: str
    from_instrument_id: str
    to_instrument_id: str
    effective_at_ns: int
    kind: MigrationKind
    source_snapshot_id: str

    def __post_init__(self) -> None:
        for field_name in (
            "migration_id",
            "from_instrument_id",
            "to_instrument_id",
            "source_snapshot_id",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if self.from_instrument_id == self.to_instrument_id:
            raise ContractValueError("a migration must change canonical instrument identity")
        _require_ns(self.effective_at_ns, field="effective_at_ns")
        if not isinstance(self.kind, MigrationKind):
            raise ContractValueError("kind must be MigrationKind")


@dataclass(frozen=True, slots=True)
class InstrumentResolutionV1:
    status: InstrumentResolutionStatus
    as_of_ns: int
    interval: InstrumentMasterIntervalV1 | None
    reason_codes: tuple[str, ...]
    posture: EvidencePosture | None = None


@dataclass(frozen=True, slots=True)
class AsOfUniverseV1:
    venue: str
    product: str
    as_of_ns: int
    coverage: ArchiveCoverage
    instruments: tuple[InstrumentMasterIntervalV1, ...]
    reason_codes: tuple[str, ...]
    posture: EvidencePosture | None = None


@dataclass(frozen=True, slots=True)
class HorizonAssessmentV1:
    status: HorizonStatus
    start_ns: int
    end_ns: int
    instrument_path: tuple[str, ...]
    reason_codes: tuple[str, ...]
    posture: EvidencePosture | None = None


_ALLOWED_TRANSITIONS: Final = {
    InstrumentLifecycle.LISTED: frozenset(
        {
            InstrumentLifecycle.LISTED,
            InstrumentLifecycle.TRADING,
            InstrumentLifecycle.HALTED,
            InstrumentLifecycle.DELISTED,
        }
    ),
    InstrumentLifecycle.TRADING: frozenset(
        {
            InstrumentLifecycle.TRADING,
            InstrumentLifecycle.HALTED,
            InstrumentLifecycle.DELISTED,
        }
    ),
    InstrumentLifecycle.HALTED: frozenset(
        {
            InstrumentLifecycle.HALTED,
            InstrumentLifecycle.TRADING,
            InstrumentLifecycle.DELISTED,
        }
    ),
    InstrumentLifecycle.DELISTED: frozenset(),
}


@dataclass(frozen=True, slots=True)
class InstrumentMasterV1:
    revision_id: str
    snapshots: tuple[ExchangeInfoSnapshotV1, ...]
    coverage: tuple[MasterCoverageIntervalV1, ...]
    intervals: tuple[InstrumentMasterIntervalV1, ...]
    migrations: tuple[InstrumentMigrationV1, ...] = ()

    def __post_init__(self) -> None:
        require_contract_id(self.revision_id, field="revision_id")
        self._validate_bounded_tuples()
        snapshot_by_id = self._validate_snapshots()
        self._validate_coverage(snapshot_by_id)
        intervals_by_id = self._validate_intervals(snapshot_by_id)
        self._validate_migrations(snapshot_by_id, intervals_by_id)

    def _validate_bounded_tuples(self) -> None:
        bounds = (
            ("snapshots", self.snapshots, MAX_MASTER_SNAPSHOTS),
            ("coverage", self.coverage, MAX_MASTER_COVERAGE_INTERVALS),
            ("intervals", self.intervals, MAX_INSTRUMENT_INTERVALS),
            ("migrations", self.migrations, MAX_INSTRUMENT_MIGRATIONS),
        )
        for name, values, maximum in bounds:
            if not isinstance(values, tuple) or len(values) > maximum:
                raise ContractValueError(f"{name} must be a tuple of at most {maximum} entries")

    def _validate_snapshots(self) -> dict[str, ExchangeInfoSnapshotV1]:
        expected = tuple(
            sorted(self.snapshots, key=lambda item: (item.observed_at_ns, item.snapshot_id))
        )
        if self.snapshots != expected:
            raise ContractValueError("snapshots must be sorted by observed time and identity")
        snapshot_by_id: dict[str, ExchangeInfoSnapshotV1] = {}
        for snapshot in self.snapshots:
            if not isinstance(snapshot, ExchangeInfoSnapshotV1):
                raise ContractValueError("snapshots must contain ExchangeInfoSnapshotV1")
            if snapshot.snapshot_id in snapshot_by_id:
                raise ContractValueError("snapshot identities must be unique")
            snapshot_by_id[snapshot.snapshot_id] = snapshot
        return snapshot_by_id

    def _validate_coverage(
        self,
        snapshot_by_id: dict[str, ExchangeInfoSnapshotV1],
    ) -> None:
        expected = tuple(
            sorted(
                self.coverage,
                key=lambda item: (item.venue, item.product, item.valid_from_ns),
            )
        )
        if self.coverage != expected:
            raise ContractValueError("coverage must be sorted by venue/product/start")
        previous_by_market: dict[tuple[str, str], MasterCoverageIntervalV1] = {}
        for item in self.coverage:
            if not isinstance(item, MasterCoverageIntervalV1):
                raise ContractValueError("coverage must contain MasterCoverageIntervalV1")
            market = (item.venue, item.product)
            previous = previous_by_market.get(market)
            if previous is not None and item.valid_from_ns < previous.valid_until_ns:
                raise ContractValueError("coverage intervals must not overlap")
            previous_by_market[market] = item
            if item.source_snapshot_id is not None:
                snapshot = snapshot_by_id.get(item.source_snapshot_id)
                if snapshot is None:
                    raise ContractValueError("coverage references an unknown snapshot")
                if (snapshot.venue, snapshot.product) != market:
                    raise ContractValueError("coverage snapshot market identity must match")
                if snapshot.observed_at_ns >= item.valid_until_ns:
                    raise ContractValueError(
                        "coverage snapshot must be observed before coverage valid_until_ns"
                    )

    def _validate_intervals(
        self,
        snapshot_by_id: dict[str, ExchangeInfoSnapshotV1],
    ) -> dict[str, list[InstrumentMasterIntervalV1]]:
        expected = tuple(
            sorted(
                self.intervals,
                key=lambda item: (
                    item.venue,
                    item.product,
                    item.canonical_instrument_id,
                    item.valid_from_ns,
                ),
            )
        )
        if self.intervals != expected:
            raise ContractValueError("instrument intervals must be sorted by market/identity/start")
        by_id: dict[str, list[InstrumentMasterIntervalV1]] = {}
        by_physical_identity: dict[
            tuple[str, str, str],
            list[InstrumentMasterIntervalV1],
        ] = {}
        versions: set[tuple[str, str]] = set()
        for interval in self.intervals:
            if not isinstance(interval, InstrumentMasterIntervalV1):
                raise ContractValueError("intervals must contain InstrumentMasterIntervalV1")
            snapshot = snapshot_by_id.get(interval.source_snapshot_id)
            if snapshot is None:
                raise ContractValueError("instrument interval references an unknown snapshot")
            if (snapshot.venue, snapshot.product) != (interval.venue, interval.product):
                raise ContractValueError("instrument interval snapshot market identity must match")
            if snapshot.observed_at_ns > interval.first_observed_ns:
                raise ContractValueError(
                    "instrument interval snapshot must not follow first_observed_ns"
                )
            version_key = (interval.canonical_instrument_id, interval.instrument_version)
            if version_key in versions:
                raise ContractValueError(
                    "instrument versions must be unique per canonical identity"
                )
            versions.add(version_key)
            by_id.setdefault(interval.canonical_instrument_id, []).append(interval)
            by_physical_identity.setdefault(
                (interval.venue, interval.product, interval.symbol),
                [],
            ).append(interval)
        for items in by_id.values():
            first = items[0]
            stable_identity = (
                first.venue,
                first.product,
                first.symbol,
                first.base_asset_id,
                first.quote_asset_id,
                first.settlement_asset_id,
                first.contract_id,
            )
            for index, interval in enumerate(items):
                identity = (
                    interval.venue,
                    interval.product,
                    interval.symbol,
                    interval.base_asset_id,
                    interval.quote_asset_id,
                    interval.settlement_asset_id,
                    interval.contract_id,
                )
                if identity != stable_identity:
                    raise ContractValueError(
                        "identity changes require an explicit canonical migration edge"
                    )
                if index == 0:
                    continue
                previous = items[index - 1]
                if interval.valid_from_ns < previous.valid_until_ns:
                    raise ContractValueError("instrument validity intervals must not overlap")
                if interval.lifecycle not in _ALLOWED_TRANSITIONS[previous.lifecycle]:
                    raise ContractValueError("instrument lifecycle transition is invalid")
        for physical_intervals in by_physical_identity.values():
            ordered = sorted(
                physical_intervals,
                key=lambda item: (
                    item.valid_from_ns,
                    item.valid_until_ns,
                    item.canonical_instrument_id,
                ),
            )
            for index, interval in enumerate(ordered[1:], start=1):
                previous = ordered[index - 1]
                if interval.valid_from_ns < previous.valid_until_ns:
                    raise ContractValueError(
                        "physical instrument identity intervals must not overlap"
                    )
        return by_id

    def _validate_migrations(
        self,
        snapshot_by_id: dict[str, ExchangeInfoSnapshotV1],
        intervals_by_id: dict[str, list[InstrumentMasterIntervalV1]],
    ) -> None:
        expected = tuple(
            sorted(self.migrations, key=lambda item: (item.effective_at_ns, item.migration_id))
        )
        if self.migrations != expected:
            raise ContractValueError("migrations must be sorted by effective time and identity")
        seen_ids: set[str] = set()
        from_ids: set[str] = set()
        to_ids: set[str] = set()
        edges: dict[str, str] = {}
        for migration in self.migrations:
            if not isinstance(migration, InstrumentMigrationV1):
                raise ContractValueError("migrations must contain InstrumentMigrationV1")
            if migration.migration_id in seen_ids:
                raise ContractValueError("migration identities must be unique")
            if migration.from_instrument_id in from_ids or migration.to_instrument_id in to_ids:
                raise ContractValueError("migration identities must form an unambiguous chain")
            seen_ids.add(migration.migration_id)
            from_ids.add(migration.from_instrument_id)
            to_ids.add(migration.to_instrument_id)
            source = intervals_by_id.get(migration.from_instrument_id)
            target = intervals_by_id.get(migration.to_instrument_id)
            if source is None or target is None:
                raise ContractValueError("migration endpoints must exist in the master")
            if source[-1].valid_until_ns != migration.effective_at_ns:
                raise ContractValueError("migration must bind the source validity boundary")
            if target[0].valid_from_ns != migration.effective_at_ns:
                raise ContractValueError("migration must bind the target validity boundary")
            source_market = (source[-1].venue, source[-1].product)
            target_market = (target[0].venue, target[0].product)
            if source_market != target_market:
                raise ContractValueError("migration endpoints must share one venue/product")
            snapshot = snapshot_by_id.get(migration.source_snapshot_id)
            if snapshot is None:
                raise ContractValueError("migration references an unknown snapshot")
            if (snapshot.venue, snapshot.product) != source_market:
                raise ContractValueError("migration snapshot market identity must match")
            edges[migration.from_instrument_id] = migration.to_instrument_id
        for origin in edges:
            visited: set[str] = set()
            current = origin
            while current in edges:
                if current in visited:
                    raise ContractValueError("migration graph must be acyclic")
                visited.add(current)
                current = edges[current]

    def _coverage_at(
        self,
        venue: str,
        product: str,
        as_of_ns: int,
    ) -> MasterCoverageIntervalV1 | None:
        return next(
            (
                item
                for item in self.coverage
                if item.venue == venue
                and item.product == product
                and item.valid_from_ns <= as_of_ns < item.valid_until_ns
            ),
            None,
        )

    def _interval_at(
        self,
        canonical_instrument_id: str,
        as_of_ns: int,
    ) -> InstrumentMasterIntervalV1 | None:
        return next(
            (
                interval
                for interval in self.intervals
                if interval.canonical_instrument_id == canonical_instrument_id
                and interval.valid_from_ns <= as_of_ns < interval.valid_until_ns
            ),
            None,
        )

    def _snapshot_observed_at(self, snapshot_id: str) -> int:
        snapshot = next(item for item in self.snapshots if item.snapshot_id == snapshot_id)
        return snapshot.observed_at_ns

    def _snapshot_posture(self, snapshot_id: str | None) -> EvidencePosture | None:
        if snapshot_id is None:
            return None
        snapshot = next(item for item in self.snapshots if item.snapshot_id == snapshot_id)
        return snapshot.posture

    def _coverage_is_visible(
        self,
        coverage: MasterCoverageIntervalV1,
        *,
        as_of_ns: int,
    ) -> bool:
        return coverage.source_snapshot_id is None or (
            self._snapshot_observed_at(coverage.source_snapshot_id) <= as_of_ns
        )

    def _interval_is_visible(
        self,
        interval: InstrumentMasterIntervalV1,
        *,
        as_of_ns: int,
    ) -> bool:
        return (
            self._snapshot_observed_at(interval.source_snapshot_id) <= as_of_ns
            and interval.first_observed_ns <= as_of_ns
            and interval.last_observed_ns <= as_of_ns
        )

    def _has_future_migration_evidence(
        self,
        canonical_instrument_id: str,
        *,
        as_of_ns: int,
    ) -> bool:
        return any(
            migration.effective_at_ns <= as_of_ns
            and canonical_instrument_id
            in (migration.from_instrument_id, migration.to_instrument_id)
            and self._snapshot_observed_at(migration.source_snapshot_id) > as_of_ns
            for migration in self.migrations
        )

    def _has_synthetic_migration_evidence(
        self,
        canonical_instrument_id: str,
        *,
        as_of_ns: int,
    ) -> bool:
        return any(
            migration.effective_at_ns <= as_of_ns
            and canonical_instrument_id
            in (migration.from_instrument_id, migration.to_instrument_id)
            and self._snapshot_observed_at(migration.source_snapshot_id) <= as_of_ns
            and self._snapshot_posture(migration.source_snapshot_id) is EvidencePosture.SYNTHETIC
            for migration in self.migrations
        )

    def _migration_postures_at(
        self,
        canonical_instrument_id: str,
        *,
        as_of_ns: int,
    ) -> tuple[EvidencePosture, ...]:
        """Return every visible migration-source posture used by point-in-time truth."""

        return tuple(
            posture
            for migration in self.migrations
            if migration.effective_at_ns <= as_of_ns
            and canonical_instrument_id
            in (migration.from_instrument_id, migration.to_instrument_id)
            and self._snapshot_observed_at(migration.source_snapshot_id) <= as_of_ns
            for posture in (self._snapshot_posture(migration.source_snapshot_id),)
            if posture is not None
        )

    def resolve_as_of(
        self,
        canonical_instrument_id: str,
        *,
        as_of_ns: int,
    ) -> InstrumentResolutionV1:
        require_contract_id(canonical_instrument_id, field="canonical_instrument_id")
        point = _require_ns(as_of_ns, field="as_of_ns")
        identities = [
            item
            for item in self.intervals
            if item.canonical_instrument_id == canonical_instrument_id
        ]
        if not identities:
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("INSTRUMENT_IDENTITY_UNKNOWN",),
            )
        if self._has_future_migration_evidence(
            canonical_instrument_id,
            as_of_ns=point,
        ):
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("FUTURE_MIGRATION_EVIDENCE",),
            )
        if self._has_synthetic_migration_evidence(
            canonical_instrument_id,
            as_of_ns=point,
        ):
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("SYNTHETIC_MIGRATION_EVIDENCE",),
                posture=EvidencePosture.SYNTHETIC,
            )
        visible_identities = tuple(
            item for item in identities if self._interval_is_visible(item, as_of_ns=point)
        )
        if not visible_identities:
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("FUTURE_INSTRUMENT_EVIDENCE",),
            )
        coverage = self._coverage_at(
            visible_identities[0].venue,
            visible_identities[0].product,
            point,
        )
        if coverage is None or coverage.state is ArchiveCoverage.UNAVAILABLE:
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("ARCHIVE_COVERAGE_UNAVAILABLE",),
            )
        if not self._coverage_is_visible(coverage, as_of_ns=point):
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("FUTURE_ARCHIVE_EVIDENCE",),
            )
        coverage_posture = self._snapshot_posture(coverage.source_snapshot_id)
        coverage_reasons: set[str] = set()
        if coverage.state is ArchiveCoverage.PARTIAL:
            coverage_reasons.add("PARTIAL_ARCHIVE_COVERAGE")
        if coverage_posture is EvidencePosture.SYNTHETIC:
            coverage_reasons.add("SYNTHETIC_ARCHIVE_EVIDENCE")
        if coverage_reasons:
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=tuple(sorted(coverage_reasons)),
                posture=coverage_posture,
            )
        migration_postures = self._migration_postures_at(
            canonical_instrument_id,
            as_of_ns=point,
        )
        base_posture = _combine_postures((coverage_posture, *migration_postures))
        interval = self._interval_at(canonical_instrument_id, point)
        if interval is None:
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.NOT_LISTED,
                as_of_ns=point,
                interval=None,
                reason_codes=("INSTRUMENT_NOT_LISTED_AS_OF",),
                posture=base_posture,
            )
        if not self._interval_is_visible(interval, as_of_ns=point):
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("FUTURE_INSTRUMENT_EVIDENCE",),
            )
        interval_posture = self._snapshot_posture(interval.source_snapshot_id)
        combined_posture = _combine_postures((base_posture, interval_posture))
        if interval_posture is EvidencePosture.SYNTHETIC:
            return InstrumentResolutionV1(
                status=InstrumentResolutionStatus.UNAVAILABLE,
                as_of_ns=point,
                interval=None,
                reason_codes=("SYNTHETIC_INSTRUMENT_EVIDENCE",),
                posture=combined_posture,
            )
        return InstrumentResolutionV1(
            status=InstrumentResolutionStatus.AVAILABLE,
            as_of_ns=point,
            interval=interval,
            reason_codes=(),
            posture=combined_posture,
        )

    def universe_as_of(self, *, venue: str, product: str, as_of_ns: int) -> AsOfUniverseV1:
        require_path_segment(venue, field="venue")
        require_path_segment(product, field="product")
        point = _require_ns(as_of_ns, field="as_of_ns")
        coverage = self._coverage_at(venue, product, point)
        if coverage is None or coverage.state is ArchiveCoverage.UNAVAILABLE:
            return AsOfUniverseV1(
                venue=venue,
                product=product,
                as_of_ns=point,
                coverage=ArchiveCoverage.UNAVAILABLE,
                instruments=(),
                reason_codes=("ARCHIVE_COVERAGE_UNAVAILABLE",),
            )
        if not self._coverage_is_visible(coverage, as_of_ns=point):
            return AsOfUniverseV1(
                venue=venue,
                product=product,
                as_of_ns=point,
                coverage=ArchiveCoverage.UNAVAILABLE,
                instruments=(),
                reason_codes=("FUTURE_ARCHIVE_EVIDENCE",),
            )
        coverage_posture = self._snapshot_posture(coverage.source_snapshot_id)
        coverage_reasons: set[str] = set()
        if coverage.state is ArchiveCoverage.PARTIAL:
            coverage_reasons.add("PARTIAL_ARCHIVE_COVERAGE")
        if coverage_posture is EvidencePosture.SYNTHETIC:
            coverage_reasons.add("SYNTHETIC_ARCHIVE_EVIDENCE")
        if coverage_reasons:
            return AsOfUniverseV1(
                venue=venue,
                product=product,
                as_of_ns=point,
                coverage=coverage.state,
                instruments=(),
                reason_codes=tuple(sorted(coverage_reasons)),
                posture=coverage_posture,
            )
        applicable_intervals = tuple(
            interval
            for interval in self.intervals
            if interval.venue == venue
            and interval.product == product
            and interval.valid_from_ns <= point < interval.valid_until_ns
        )
        if any(
            self._has_future_migration_evidence(
                interval.canonical_instrument_id,
                as_of_ns=point,
            )
            for interval in applicable_intervals
        ):
            return AsOfUniverseV1(
                venue=venue,
                product=product,
                as_of_ns=point,
                coverage=ArchiveCoverage.UNAVAILABLE,
                instruments=(),
                reason_codes=("FUTURE_MIGRATION_EVIDENCE",),
            )
        if any(
            self._has_synthetic_migration_evidence(
                interval.canonical_instrument_id,
                as_of_ns=point,
            )
            for interval in applicable_intervals
        ):
            return AsOfUniverseV1(
                venue=venue,
                product=product,
                as_of_ns=point,
                coverage=coverage.state,
                instruments=(),
                reason_codes=("SYNTHETIC_MIGRATION_EVIDENCE",),
                posture=EvidencePosture.SYNTHETIC,
            )
        if any(
            not self._interval_is_visible(interval, as_of_ns=point)
            for interval in applicable_intervals
        ):
            return AsOfUniverseV1(
                venue=venue,
                product=product,
                as_of_ns=point,
                coverage=ArchiveCoverage.UNAVAILABLE,
                instruments=(),
                reason_codes=("FUTURE_INSTRUMENT_EVIDENCE",),
            )
        interval_postures = tuple(
            self._snapshot_posture(interval.source_snapshot_id) for interval in applicable_intervals
        )
        migration_postures = tuple(
            posture
            for interval in applicable_intervals
            for posture in self._migration_postures_at(
                interval.canonical_instrument_id,
                as_of_ns=point,
            )
        )
        combined_posture = _combine_postures(
            (coverage_posture, *interval_postures, *migration_postures)
        )
        if EvidencePosture.SYNTHETIC in interval_postures:
            return AsOfUniverseV1(
                venue=venue,
                product=product,
                as_of_ns=point,
                coverage=coverage.state,
                instruments=(),
                reason_codes=("SYNTHETIC_INSTRUMENT_EVIDENCE",),
                posture=combined_posture,
            )
        instruments = tuple(
            interval
            for interval in applicable_intervals
            if interval.lifecycle is InstrumentLifecycle.TRADING
        )
        return AsOfUniverseV1(
            venue=venue,
            product=product,
            as_of_ns=point,
            coverage=coverage.state,
            instruments=instruments,
            reason_codes=(),
            posture=combined_posture,
        )

    def assess_horizon(
        self,
        canonical_instrument_id: str,
        *,
        start_ns: int,
        end_ns: int,
    ) -> HorizonAssessmentV1:
        """Assess the closed label horizon [start_ns, end_ns] without survivor bias."""

        require_contract_id(canonical_instrument_id, field="canonical_instrument_id")
        start = _require_ns(start_ns, field="start_ns")
        end = _require_ns(end_ns, field="end_ns")
        if end <= start:
            raise ContractValueError("end_ns must follow start_ns")
        reasons: set[str] = set()
        path = [canonical_instrument_id]
        start_resolution = self.resolve_as_of(canonical_instrument_id, as_of_ns=start)
        evidence_postures: list[EvidencePosture] = []
        if start_resolution.posture is not None:
            evidence_postures.append(start_resolution.posture)
        current = start_resolution.interval
        if start_resolution.status is InstrumentResolutionStatus.UNAVAILABLE:
            reasons.update(start_resolution.reason_codes)
        elif current is None:
            reasons.add("START_NOT_LISTED")
        elif current.lifecycle is not InstrumentLifecycle.TRADING:
            reasons.add("START_NOT_TRADING")
        if current is None:
            return HorizonAssessmentV1(
                status=HorizonStatus.BLOCKED,
                start_ns=start,
                end_ns=end,
                instrument_path=tuple(path),
                reason_codes=tuple(sorted(reasons)),
                posture=_combine_postures(tuple(evidence_postures)),
            )

        cursor = start
        current_id = canonical_instrument_id
        visited: set[str] = set()
        while cursor <= end:
            market_coverage = self._coverage_at(current.venue, current.product, cursor)
            if market_coverage is None or market_coverage.state is not ArchiveCoverage.COMPLETE:
                reasons.add("ARCHIVE_COVERAGE_NOT_COMPLETE")
                break
            if not self._coverage_is_visible(market_coverage, as_of_ns=cursor):
                reasons.add("FUTURE_ARCHIVE_EVIDENCE")
                break
            coverage_posture = self._snapshot_posture(market_coverage.source_snapshot_id)
            if coverage_posture is not None:
                evidence_postures.append(coverage_posture)
            if coverage_posture is EvidencePosture.SYNTHETIC:
                reasons.add("SYNTHETIC_ARCHIVE_EVIDENCE")
                break
            coverage_end = market_coverage.valid_until_ns
            interval_end = current.valid_until_ns
            boundary = min(coverage_end, interval_end)
            if boundary > end:
                break
            if coverage_end <= interval_end:
                reasons.add("ARCHIVE_COVERAGE_NOT_COMPLETE")
                break

            migration = next(
                (
                    item
                    for item in self.migrations
                    if item.from_instrument_id == current_id and item.effective_at_ns == boundary
                ),
                None,
            )
            if migration is not None:
                if self._snapshot_observed_at(migration.source_snapshot_id) > boundary:
                    reasons.add("FUTURE_MIGRATION_EVIDENCE")
                    break
                migration_posture = self._snapshot_posture(migration.source_snapshot_id)
                if migration_posture is not None:
                    evidence_postures.append(migration_posture)
                if migration_posture is EvidencePosture.SYNTHETIC:
                    reasons.add("SYNTHETIC_MIGRATION_EVIDENCE")
                    break
                reasons.add("CROSSES_MIGRATION")
                if current_id in visited:
                    reasons.add("MIGRATION_PATH_INVALID")
                    break
                visited.add(current_id)
                current_id = migration.to_instrument_id
                path.append(current_id)
            next_interval = self._interval_at(current_id, boundary)
            if next_interval is None:
                reasons.add("CROSSES_UNAVAILABLE_INSTRUMENT_INTERVAL")
                break
            if not self._interval_is_visible(next_interval, as_of_ns=boundary):
                reasons.add("FUTURE_INSTRUMENT_EVIDENCE")
                break
            next_posture = self._snapshot_posture(next_interval.source_snapshot_id)
            if next_posture is not None:
                evidence_postures.append(next_posture)
            if next_posture is EvidencePosture.SYNTHETIC:
                reasons.add("SYNTHETIC_INSTRUMENT_EVIDENCE")
                break
            if next_interval.lifecycle is not current.lifecycle:
                reasons.add("CROSSES_LIFECYCLE_BOUNDARY")
                if next_interval.lifecycle is InstrumentLifecycle.HALTED:
                    reasons.add("CROSSES_HALT")
                elif next_interval.lifecycle is InstrumentLifecycle.DELISTED:
                    reasons.add("CROSSES_DELISTING")
                elif current.lifecycle is InstrumentLifecycle.LISTED:
                    reasons.add("CROSSES_LISTING")
            if next_interval.lifecycle is not InstrumentLifecycle.TRADING:
                reasons.add("HORIZON_NOT_CONTINUOUSLY_TRADING")
            if next_interval.filters != current.filters:
                reasons.add("CROSSES_FILTER_REVISION")
            current = next_interval
            cursor = boundary

        return HorizonAssessmentV1(
            status=HorizonStatus.STABLE if not reasons else HorizonStatus.BLOCKED,
            start_ns=start,
            end_ns=end,
            instrument_path=tuple(path),
            reason_codes=tuple(sorted(reasons)),
            posture=_combine_postures(tuple(evidence_postures)),
        )
