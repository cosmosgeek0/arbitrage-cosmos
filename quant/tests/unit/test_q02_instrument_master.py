from __future__ import annotations

import hashlib
from dataclasses import replace

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.lake import (
    ArchiveCoverage,
    BorrowEligibility,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    ExchangeInfoSnapshotV1,
    HorizonStatus,
    InstrumentFiltersV1,
    InstrumentLifecycle,
    InstrumentMasterIntervalV1,
    InstrumentMasterV1,
    InstrumentMigrationV1,
    InstrumentResolutionStatus,
    MasterCoverageIntervalV1,
    MigrationKind,
)

BASE_NS = 1_783_814_400_000_000_000
SECOND_NS = 1_000_000_000


def _at(second: int) -> int:
    return BASE_NS + second * SECOND_NS


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _snapshot(
    snapshot_id: str,
    second: int = 0,
    *,
    posture: EvidencePosture = EvidencePosture.REPLAY,
) -> ExchangeInfoSnapshotV1:
    return ExchangeInfoSnapshotV1(
        snapshot_id=snapshot_id,
        venue="binance",
        product="spot",
        source_endpoint="exchangeInfo",
        observed_at_ns=_at(second),
        payload_digest=_digest(snapshot_id),
        posture=posture,
    )


def _scaled(value: int, *, scale: int, unit: str) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=value, scale=scale, unit_id=unit)


def _filters(*, tick: int = 1) -> InstrumentFiltersV1:
    return InstrumentFiltersV1(
        price_precision=2,
        quantity_precision=3,
        tick_size=_scaled(tick, scale=2, unit="USDT"),
        step_size=_scaled(1, scale=3, unit="BTC"),
        min_quantity=_scaled(1, scale=3, unit="BTC"),
        max_quantity=_scaled(1_000, scale=0, unit="BTC"),
        min_notional=_scaled(5, scale=0, unit="USDT"),
        max_notional=None,
    )


def _interval(
    instrument_id: str,
    version: str,
    start: int,
    end: int,
    lifecycle: InstrumentLifecycle,
    *,
    filters: InstrumentFiltersV1 | None = None,
    symbol: str = "BTCUSDT",
    base_asset_id: str = "BTC",
    snapshot_id: str = "snapshot1",
) -> InstrumentMasterIntervalV1:
    return InstrumentMasterIntervalV1(
        canonical_instrument_id=instrument_id,
        instrument_version=version,
        venue="binance",
        product="spot",
        symbol=symbol,
        base_asset_id=base_asset_id,
        quote_asset_id="USDT",
        settlement_asset_id=None,
        contract_id=None,
        lifecycle=lifecycle,
        filters=_filters() if filters is None else filters,
        borrow_eligibility=BorrowEligibility.UNKNOWN,
        valid_from_ns=_at(start),
        valid_until_ns=_at(end),
        first_observed_ns=_at(start),
        last_observed_ns=_at(start),
        source_snapshot_id=snapshot_id,
    )


def _coverage(
    start: int,
    end: int,
    state: ArchiveCoverage = ArchiveCoverage.COMPLETE,
    *,
    snapshot_id: str | None = "snapshot1",
) -> MasterCoverageIntervalV1:
    return MasterCoverageIntervalV1(
        venue="binance",
        product="spot",
        valid_from_ns=_at(start),
        valid_until_ns=_at(end),
        state=state,
        source_snapshot_id=snapshot_id,
    )


def _master(
    intervals: tuple[InstrumentMasterIntervalV1, ...],
    *,
    coverage: tuple[MasterCoverageIntervalV1, ...] | None = None,
    snapshots: tuple[ExchangeInfoSnapshotV1, ...] | None = None,
    migrations: tuple[InstrumentMigrationV1, ...] = (),
) -> InstrumentMasterV1:
    if coverage is None:
        coverage = (_coverage(0, 50),)
    if snapshots is None:
        snapshots = (_snapshot("snapshot1"),)
    return InstrumentMasterV1(
        revision_id="instrument-master.v1",
        snapshots=tuple(
            sorted(snapshots, key=lambda item: (item.observed_at_ns, item.snapshot_id))
        ),
        coverage=tuple(
            sorted(coverage, key=lambda item: (item.venue, item.product, item.valid_from_ns))
        ),
        intervals=tuple(
            sorted(
                intervals,
                key=lambda item: (
                    item.venue,
                    item.product,
                    item.canonical_instrument_id,
                    item.valid_from_ns,
                ),
            )
        ),
        migrations=tuple(
            sorted(migrations, key=lambda item: (item.effective_at_ns, item.migration_id))
        ),
    )


def _lifecycle_master() -> InstrumentMasterV1:
    return _master(
        (
            _interval("BTC_SPOT", "v1", 10, 12, InstrumentLifecycle.LISTED),
            _interval("BTC_SPOT", "v2", 12, 20, InstrumentLifecycle.TRADING),
            _interval("BTC_SPOT", "v3", 20, 22, InstrumentLifecycle.HALTED),
            _interval("BTC_SPOT", "v4", 22, 30, InstrumentLifecycle.TRADING),
            _interval("BTC_SPOT", "v5", 30, 40, InstrumentLifecycle.DELISTED),
        )
    )


def test_as_of_universe_is_listing_halt_and_delisting_correct() -> None:
    master = _lifecycle_master()

    assert master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(9)).instruments == ()
    listed = master.resolve_as_of("BTC_SPOT", as_of_ns=_at(10))
    assert listed.status is InstrumentResolutionStatus.AVAILABLE
    assert listed.interval is not None
    assert listed.interval.lifecycle is InstrumentLifecycle.LISTED
    assert (
        master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(12))
        .instruments[0]
        .instrument_version
        == "v2"
    )
    assert (
        master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(20)).instruments == ()
    )
    assert (
        master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(22))
        .instruments[0]
        .instrument_version
        == "v4"
    )
    assert (
        master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(30)).instruments == ()
    )


def test_label_horizon_blocks_lifecycle_and_filter_revision_boundaries() -> None:
    lifecycle = _lifecycle_master()

    stable = lifecycle.assess_horizon("BTC_SPOT", start_ns=_at(15), end_ns=_at(19))
    halt = lifecycle.assess_horizon("BTC_SPOT", start_ns=_at(19), end_ns=_at(20))
    delisting = lifecycle.assess_horizon("BTC_SPOT", start_ns=_at(29), end_ns=_at(30))

    assert stable.status is HorizonStatus.STABLE
    assert stable.reason_codes == ()
    assert halt.status is HorizonStatus.BLOCKED
    assert {"CROSSES_HALT", "CROSSES_LIFECYCLE_BOUNDARY"} <= set(halt.reason_codes)
    assert delisting.status is HorizonStatus.BLOCKED
    assert "CROSSES_DELISTING" in delisting.reason_codes

    filter_master = _master(
        (
            _interval("BTC_SPOT", "filter-v1", 10, 25, InstrumentLifecycle.TRADING),
            _interval(
                "BTC_SPOT",
                "filter-v2",
                25,
                40,
                InstrumentLifecycle.TRADING,
                filters=_filters(tick=2),
            ),
        )
    )
    revision = filter_master.assess_horizon("BTC_SPOT", start_ns=_at(24), end_ns=_at(25))
    assert revision.status is HorizonStatus.BLOCKED
    assert revision.reason_codes == ("CROSSES_FILTER_REVISION",)


def test_explicit_symbol_asset_migration_is_followed_without_survivor_rewrite() -> None:
    migration = InstrumentMigrationV1(
        migration_id="migration1",
        from_instrument_id="A_OLD_BTC",
        to_instrument_id="B_NEW_BTC",
        effective_at_ns=_at(28),
        kind=MigrationKind.SYMBOL,
        source_snapshot_id="snapshot2",
    )
    master = _master(
        (
            _interval(
                "A_OLD_BTC",
                "old-v1",
                10,
                28,
                InstrumentLifecycle.TRADING,
                symbol="XBTUSDT",
            ),
            _interval(
                "B_NEW_BTC",
                "new-v1",
                28,
                40,
                InstrumentLifecycle.TRADING,
                symbol="BTCUSDT",
                snapshot_id="snapshot2",
            ),
        ),
        snapshots=(_snapshot("snapshot1"), _snapshot("snapshot2", 28)),
        migrations=(migration,),
    )

    before = master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(27))
    after = master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(28))
    crossing = master.assess_horizon("A_OLD_BTC", start_ns=_at(27), end_ns=_at(29))

    assert tuple(item.symbol for item in before.instruments) == ("XBTUSDT",)
    assert tuple(item.symbol for item in after.instruments) == ("BTCUSDT",)
    assert (
        master.resolve_as_of("A_OLD_BTC", as_of_ns=_at(29)).status
        is InstrumentResolutionStatus.NOT_LISTED
    )
    assert crossing.status is HorizonStatus.BLOCKED
    assert crossing.instrument_path == ("A_OLD_BTC", "B_NEW_BTC")
    assert "CROSSES_MIGRATION" in crossing.reason_codes


def test_replay_migration_posture_cannot_be_upgraded_by_live_master_inputs() -> None:
    migration = InstrumentMigrationV1(
        migration_id="replay-migration",
        from_instrument_id="A_OLD_BTC",
        to_instrument_id="B_NEW_BTC",
        effective_at_ns=_at(28),
        kind=MigrationKind.SYMBOL,
        source_snapshot_id="replay-migration-snapshot",
    )
    master = _master(
        (
            _interval(
                "A_OLD_BTC",
                "old-v1",
                10,
                28,
                InstrumentLifecycle.TRADING,
                symbol="XBTUSDT",
                snapshot_id="live-master-snapshot",
            ),
            _interval(
                "B_NEW_BTC",
                "new-v1",
                28,
                40,
                InstrumentLifecycle.TRADING,
                symbol="BTCUSDT",
                snapshot_id="live-master-snapshot",
            ),
        ),
        coverage=(_coverage(0, 50, snapshot_id="live-master-snapshot"),),
        snapshots=(
            _snapshot(
                "live-master-snapshot",
                posture=EvidencePosture.LIVE,
            ),
            _snapshot(
                "replay-migration-snapshot",
                28,
                posture=EvidencePosture.REPLAY,
            ),
        ),
        migrations=(migration,),
    )

    target = master.resolve_as_of("B_NEW_BTC", as_of_ns=_at(29))
    source = master.resolve_as_of("A_OLD_BTC", as_of_ns=_at(29))
    universe = master.universe_as_of(
        venue="binance",
        product="spot",
        as_of_ns=_at(29),
    )

    assert target.status is InstrumentResolutionStatus.AVAILABLE
    assert target.posture is EvidencePosture.REPLAY
    assert source.status is InstrumentResolutionStatus.NOT_LISTED
    assert source.posture is EvidencePosture.REPLAY
    assert tuple(item.canonical_instrument_id for item in universe.instruments) == ("B_NEW_BTC",)
    assert universe.posture is EvidencePosture.REPLAY


def test_future_migration_attestation_cannot_leak_point_in_time_identity() -> None:
    migration = InstrumentMigrationV1(
        migration_id="future-attested-migration",
        from_instrument_id="A_OLD_BTC",
        to_instrument_id="B_NEW_BTC",
        effective_at_ns=_at(28),
        kind=MigrationKind.SYMBOL,
        source_snapshot_id="migration-snapshot",
    )
    master = _master(
        (
            _interval(
                "A_OLD_BTC",
                "old-v1",
                10,
                28,
                InstrumentLifecycle.TRADING,
                symbol="XBTUSDT",
            ),
            _interval(
                "B_NEW_BTC",
                "new-v1",
                28,
                120,
                InstrumentLifecycle.TRADING,
                symbol="BTCUSDT",
                snapshot_id="target-snapshot",
            ),
        ),
        snapshots=(
            _snapshot("snapshot1"),
            _snapshot("target-snapshot", 28),
            _snapshot("migration-snapshot", 100),
        ),
        coverage=(_coverage(0, 120),),
        migrations=(migration,),
    )

    source = master.resolve_as_of("A_OLD_BTC", as_of_ns=_at(29))
    target = master.resolve_as_of("B_NEW_BTC", as_of_ns=_at(29))
    universe = master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(29))
    crossing = master.assess_horizon("A_OLD_BTC", start_ns=_at(27), end_ns=_at(29))

    assert source.status is InstrumentResolutionStatus.UNAVAILABLE
    assert source.reason_codes == ("FUTURE_MIGRATION_EVIDENCE",)
    assert target.status is InstrumentResolutionStatus.UNAVAILABLE
    assert target.reason_codes == ("FUTURE_MIGRATION_EVIDENCE",)
    assert universe.coverage is ArchiveCoverage.UNAVAILABLE
    assert universe.instruments == ()
    assert universe.reason_codes == ("FUTURE_MIGRATION_EVIDENCE",)
    assert crossing.status is HorizonStatus.BLOCKED
    assert "FUTURE_MIGRATION_EVIDENCE" in crossing.reason_codes

    visible_target = master.resolve_as_of("B_NEW_BTC", as_of_ns=_at(100))
    visible_universe = master.universe_as_of(
        venue="binance",
        product="spot",
        as_of_ns=_at(100),
    )
    assert visible_target.status is InstrumentResolutionStatus.AVAILABLE
    assert tuple(item.canonical_instrument_id for item in visible_universe.instruments) == (
        "B_NEW_BTC",
    )


def test_missing_archive_day_is_unavailable_not_an_empty_historical_universe() -> None:
    master = _master(
        (_interval("BTC_SPOT", "v1", 10, 40, InstrumentLifecycle.TRADING),),
        snapshots=(_snapshot("snapshot1"), _snapshot("snapshot2", 20)),
        coverage=(
            _coverage(0, 15),
            _coverage(15, 20, ArchiveCoverage.UNAVAILABLE, snapshot_id=None),
            _coverage(20, 50, snapshot_id="snapshot2"),
        ),
    )

    unavailable = master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(17))
    crossing = master.assess_horizon("BTC_SPOT", start_ns=_at(14), end_ns=_at(21))

    assert unavailable.coverage is ArchiveCoverage.UNAVAILABLE
    assert unavailable.instruments == ()
    assert unavailable.reason_codes == ("ARCHIVE_COVERAGE_UNAVAILABLE",)
    assert crossing.status is HorizonStatus.BLOCKED
    assert crossing.reason_codes == ("ARCHIVE_COVERAGE_NOT_COMPLETE",)


def test_master_rejects_overlap_implicit_identity_change_and_broken_migration() -> None:
    first = _interval("BTC_SPOT", "v1", 10, 20, InstrumentLifecycle.TRADING)
    overlapping = _interval("BTC_SPOT", "v2", 19, 30, InstrumentLifecycle.TRADING)
    with pytest.raises(ContractValueError, match="must not overlap"):
        _master((first, overlapping))

    physical_alias = _interval(
        "ZZZ_BTC_SPOT_ALIAS",
        "v1",
        10,
        20,
        InstrumentLifecycle.TRADING,
    )
    with pytest.raises(ContractValueError, match="physical instrument identity"):
        _master((first, physical_alias))

    implicit_symbol_change = _interval(
        "BTC_SPOT",
        "v2",
        20,
        30,
        InstrumentLifecycle.TRADING,
        symbol="XBTUSDT",
    )
    with pytest.raises(ContractValueError, match="explicit canonical migration"):
        _master((first, implicit_symbol_change))

    source = replace(first, valid_until_ns=_at(28))
    target = _interval(
        "NEW_BTC_SPOT",
        "v1",
        29,
        40,
        InstrumentLifecycle.TRADING,
    )
    broken = InstrumentMigrationV1(
        migration_id="broken",
        from_instrument_id="BTC_SPOT",
        to_instrument_id="NEW_BTC_SPOT",
        effective_at_ns=_at(28),
        kind=MigrationKind.SYMBOL,
        source_snapshot_id="snapshot1",
    )
    with pytest.raises(ContractValueError, match="target validity boundary"):
        _master((source, target), migrations=(broken,))


def test_filters_and_terminal_lifecycle_fail_closed() -> None:
    with pytest.raises(ContractValueError, match="positive"):
        replace(_filters(), tick_size=_scaled(0, scale=2, unit="USDT"))
    with pytest.raises(ContractValueError, match="tick_size unit"):
        _interval(
            "BTC_SPOT",
            "v1",
            10,
            20,
            InstrumentLifecycle.TRADING,
            filters=replace(_filters(), tick_size=_scaled(1, scale=2, unit="BTC")),
        )

    delisted = _interval("BTC_SPOT", "v1", 10, 20, InstrumentLifecycle.DELISTED)
    relisted = _interval("BTC_SPOT", "v2", 20, 30, InstrumentLifecycle.TRADING)
    with pytest.raises(ContractValueError, match="lifecycle transition"):
        _master((delisted, relisted))


def test_unknown_identity_and_partial_archive_never_claim_complete_truth() -> None:
    master = _master(
        (_interval("BTC_SPOT", "v1", 10, 40, InstrumentLifecycle.TRADING),),
        coverage=(_coverage(0, 50, ArchiveCoverage.PARTIAL),),
    )

    unknown = master.resolve_as_of("ETH_SPOT", as_of_ns=_at(20))
    known = master.resolve_as_of("BTC_SPOT", as_of_ns=_at(20))
    partial = master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(20))

    assert unknown.status is InstrumentResolutionStatus.UNAVAILABLE
    assert unknown.reason_codes == ("INSTRUMENT_IDENTITY_UNKNOWN",)
    assert known.status is InstrumentResolutionStatus.UNAVAILABLE
    assert known.interval is None
    assert known.reason_codes == ("PARTIAL_ARCHIVE_COVERAGE",)
    assert known.posture is EvidencePosture.REPLAY
    assert partial.coverage is ArchiveCoverage.PARTIAL
    assert partial.reason_codes == ("PARTIAL_ARCHIVE_COVERAGE",)
    assert partial.instruments == ()
    assert partial.posture is EvidencePosture.REPLAY


def test_synthetic_snapshot_posture_is_visible_and_cannot_supply_statistics() -> None:
    synthetic_archive = _master(
        (_interval("BTC_SPOT", "v1", 10, 40, InstrumentLifecycle.TRADING),),
        snapshots=(
            _snapshot(
                "snapshot1",
                posture=EvidencePosture.SYNTHETIC,
            ),
        ),
    )
    archive_resolution = synthetic_archive.resolve_as_of("BTC_SPOT", as_of_ns=_at(20))
    archive_universe = synthetic_archive.universe_as_of(
        venue="binance",
        product="spot",
        as_of_ns=_at(20),
    )
    archive_horizon = synthetic_archive.assess_horizon(
        "BTC_SPOT",
        start_ns=_at(15),
        end_ns=_at(19),
    )
    assert archive_resolution.status is InstrumentResolutionStatus.UNAVAILABLE
    assert archive_resolution.reason_codes == ("SYNTHETIC_ARCHIVE_EVIDENCE",)
    assert archive_resolution.posture is EvidencePosture.SYNTHETIC
    assert archive_universe.instruments == ()
    assert archive_universe.reason_codes == ("SYNTHETIC_ARCHIVE_EVIDENCE",)
    assert archive_universe.posture is EvidencePosture.SYNTHETIC
    assert archive_horizon.status is HorizonStatus.BLOCKED
    assert archive_horizon.reason_codes == ("SYNTHETIC_ARCHIVE_EVIDENCE",)
    assert archive_horizon.posture is EvidencePosture.SYNTHETIC

    synthetic_interval = _master(
        (
            _interval(
                "BTC_SPOT",
                "v1",
                10,
                40,
                InstrumentLifecycle.TRADING,
                snapshot_id="synthetic-snapshot",
            ),
        ),
        snapshots=(
            _snapshot("snapshot1"),
            _snapshot(
                "synthetic-snapshot",
                posture=EvidencePosture.SYNTHETIC,
            ),
        ),
    )
    interval_resolution = synthetic_interval.resolve_as_of("BTC_SPOT", as_of_ns=_at(20))
    assert interval_resolution.status is InstrumentResolutionStatus.UNAVAILABLE
    assert interval_resolution.reason_codes == ("SYNTHETIC_INSTRUMENT_EVIDENCE",)
    assert interval_resolution.posture is EvidencePosture.SYNTHETIC

    migration = InstrumentMigrationV1(
        migration_id="synthetic-migration",
        from_instrument_id="A_OLD_BTC",
        to_instrument_id="B_NEW_BTC",
        effective_at_ns=_at(28),
        kind=MigrationKind.SYMBOL,
        source_snapshot_id="synthetic-migration-snapshot",
    )
    synthetic_migration = _master(
        (
            _interval(
                "A_OLD_BTC",
                "old-v1",
                10,
                28,
                InstrumentLifecycle.TRADING,
                symbol="XBTUSDT",
            ),
            _interval(
                "B_NEW_BTC",
                "new-v1",
                28,
                120,
                InstrumentLifecycle.TRADING,
                snapshot_id="target-snapshot",
            ),
        ),
        coverage=(_coverage(0, 120),),
        snapshots=(
            _snapshot("snapshot1"),
            _snapshot("target-snapshot", 28),
            _snapshot(
                "synthetic-migration-snapshot",
                28,
                posture=EvidencePosture.SYNTHETIC,
            ),
        ),
        migrations=(migration,),
    )
    migration_resolution = synthetic_migration.resolve_as_of(
        "B_NEW_BTC",
        as_of_ns=_at(29),
    )
    migration_universe = synthetic_migration.universe_as_of(
        venue="binance",
        product="spot",
        as_of_ns=_at(29),
    )
    migration_horizon = synthetic_migration.assess_horizon(
        "A_OLD_BTC",
        start_ns=_at(27),
        end_ns=_at(29),
    )
    assert migration_resolution.status is InstrumentResolutionStatus.UNAVAILABLE
    assert migration_resolution.reason_codes == ("SYNTHETIC_MIGRATION_EVIDENCE",)
    assert migration_resolution.posture is EvidencePosture.SYNTHETIC
    assert migration_universe.instruments == ()
    assert migration_universe.reason_codes == ("SYNTHETIC_MIGRATION_EVIDENCE",)
    assert migration_universe.posture is EvidencePosture.SYNTHETIC
    assert migration_horizon.status is HorizonStatus.BLOCKED
    assert "SYNTHETIC_MIGRATION_EVIDENCE" in migration_horizon.reason_codes
    assert migration_horizon.posture is EvidencePosture.SYNTHETIC


def test_future_snapshot_lineage_cannot_rewrite_an_earlier_as_of_universe() -> None:
    future_interval = replace(
        _interval(
            "BTC_SPOT",
            "future-v1",
            10,
            120,
            InstrumentLifecycle.TRADING,
            snapshot_id="snapshot100",
        ),
        first_observed_ns=_at(100),
        last_observed_ns=_at(100),
    )
    master = _master(
        (future_interval,),
        coverage=(_coverage(0, 120),),
        snapshots=(_snapshot("snapshot1"), _snapshot("snapshot100", 100)),
    )

    resolution = master.resolve_as_of("BTC_SPOT", as_of_ns=_at(20))
    universe = master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(20))

    assert resolution.status is InstrumentResolutionStatus.UNAVAILABLE
    assert resolution.reason_codes == ("FUTURE_INSTRUMENT_EVIDENCE",)
    assert universe.coverage is ArchiveCoverage.UNAVAILABLE
    assert universe.instruments == ()
    assert universe.reason_codes == ("FUTURE_INSTRUMENT_EVIDENCE",)
    assert (
        master.resolve_as_of("BTC_SPOT", as_of_ns=_at(100)).status
        is InstrumentResolutionStatus.AVAILABLE
    )


def test_future_coverage_snapshot_never_claims_an_earlier_empty_universe() -> None:
    master = _master(
        (_interval("BTC_SPOT", "v1", 10, 120, InstrumentLifecycle.TRADING),),
        coverage=(_coverage(0, 120, snapshot_id="snapshot100"),),
        snapshots=(_snapshot("snapshot1"), _snapshot("snapshot100", 100)),
    )

    resolution = master.resolve_as_of("BTC_SPOT", as_of_ns=_at(20))
    universe = master.universe_as_of(venue="binance", product="spot", as_of_ns=_at(20))

    assert resolution.status is InstrumentResolutionStatus.UNAVAILABLE
    assert resolution.reason_codes == ("FUTURE_ARCHIVE_EVIDENCE",)
    assert universe.coverage is ArchiveCoverage.UNAVAILABLE
    assert universe.instruments == ()
    assert universe.reason_codes == ("FUTURE_ARCHIVE_EVIDENCE",)


def test_horizon_fails_closed_when_next_interval_was_observed_in_the_future() -> None:
    future = replace(
        _interval(
            "BTC_SPOT",
            "v2",
            20,
            120,
            InstrumentLifecycle.TRADING,
            snapshot_id="snapshot100",
        ),
        first_observed_ns=_at(100),
        last_observed_ns=_at(100),
    )
    master = _master(
        (
            _interval("BTC_SPOT", "v1", 10, 20, InstrumentLifecycle.TRADING),
            future,
        ),
        coverage=(_coverage(0, 120),),
        snapshots=(_snapshot("snapshot1"), _snapshot("snapshot100", 100)),
    )

    assessment = master.assess_horizon("BTC_SPOT", start_ns=_at(15), end_ns=_at(25))

    assert assessment.status is HorizonStatus.BLOCKED
    assert assessment.reason_codes == ("FUTURE_INSTRUMENT_EVIDENCE",)


def test_interval_chronology_allows_snapshot_before_first_observation() -> None:
    observed_later = replace(
        _interval("BTC_SPOT", "v1", 10, 40, InstrumentLifecycle.TRADING),
        first_observed_ns=_at(15),
        last_observed_ns=_at(15),
    )
    master = _master((observed_later,))

    assert master.resolve_as_of("BTC_SPOT", as_of_ns=_at(14)).reason_codes == (
        "FUTURE_INSTRUMENT_EVIDENCE",
    )
    assert (
        master.resolve_as_of("BTC_SPOT", as_of_ns=_at(15)).status
        is InstrumentResolutionStatus.AVAILABLE
    )

    with pytest.raises(ContractValueError, match="inside the validity interval"):
        replace(observed_later, first_observed_ns=_at(9))
    with pytest.raises(ContractValueError, match="must not follow first_observed_ns"):
        _master(
            (replace(observed_later, source_snapshot_id="snapshot20"),),
            snapshots=(_snapshot("snapshot1"), _snapshot("snapshot20", 20)),
        )


def test_future_only_identity_cannot_leak_not_listed_market_lineage() -> None:
    future_identity = _interval(
        "FUTURE_SPOT",
        "v1",
        100,
        120,
        InstrumentLifecycle.TRADING,
    )
    master = _master((future_identity,), coverage=(_coverage(0, 120),))

    resolution = master.resolve_as_of("FUTURE_SPOT", as_of_ns=_at(20))

    assert resolution.status is InstrumentResolutionStatus.UNAVAILABLE
    assert resolution.reason_codes == ("FUTURE_INSTRUMENT_EVIDENCE",)


def test_future_last_observation_alone_blocks_as_of_resolution() -> None:
    revised_in_future = replace(
        _interval("BTC_SPOT", "v1", 10, 120, InstrumentLifecycle.TRADING),
        last_observed_ns=_at(100),
    )
    master = _master((revised_in_future,), coverage=(_coverage(0, 120),))

    early = master.resolve_as_of("BTC_SPOT", as_of_ns=_at(20))
    observable = master.resolve_as_of("BTC_SPOT", as_of_ns=_at(100))

    assert early.status is InstrumentResolutionStatus.UNAVAILABLE
    assert early.reason_codes == ("FUTURE_INSTRUMENT_EVIDENCE",)
    assert observable.status is InstrumentResolutionStatus.AVAILABLE
