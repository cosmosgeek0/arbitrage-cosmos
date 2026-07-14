from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import FrozenInstanceError, replace
from typing import Any, cast

import pytest

from quant_edge.bootstrap.atlas import (
    AtlasTierDescriptorV1,
    DeliveryStatus,
    DiscoveryBasis,
    DiscoveryMetric,
    DiscoveryRuleV1,
    EconomicsPosture,
    EventAtlasTier,
    EventAtlasV1,
    EvidenceAvailability,
    HistoricalAtlasInputV1,
    InventoryClass,
    RealCoverageStatus,
    TierEvidencePosture,
    build_event_atlas,
    default_discovery_rules,
    render_event_atlas_markdown,
    verify_event_atlas_markdown,
)
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    QualityFactsV1,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
)

BASE_MS = 1_510_000_000_000
AS_OF_MS = 1_783_814_400_000
WINDOW_NS = 60_000_000_000


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _row(
    record_number: int,
    *,
    window: int = 0,
    offset_ms: int = 0,
    price: int | None = 10_000,
    symbol: str = "BNBUSDT",
    base: str = "BNB",
    quote: str = "USDT",
    posture: EvidencePosture = EvidencePosture.REPLAY,
) -> ReferenceMarketEvidenceRowV1:
    event_ms = BASE_MS + window * 60_000 + offset_ms
    synthetic = posture is EvidencePosture.SYNTHETIC
    return ReferenceMarketEvidenceRowV1(
        record_id=f"record-{record_number}",
        source_id="binance-public-data",
        source_endpoint="spot-daily-aggTrades",
        venue="binance",
        product="spot",
        event_kind="aggTrades",
        symbol=symbol,
        base_asset_id=base,
        quote_asset_id=quote,
        instrument_version="archive-contract.v1",
        stream_id="historical-archive",
        event_time=RawTimestampV1(
            raw=event_ms,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
        ),
        trade_time=None,
        receive_wall_time=None,
        receive_monotonic_ns=None,
        normalization_time_ns=(AS_OF_MS - 2) * 1_000_000,
        persistence_time_ns=(AS_OF_MS - 1) * 1_000_000,
        session_id="archive-session",
        sequence_first=record_number,
        sequence_last=record_number,
        raw_payload_digest=_digest(f"payload-{record_number}"),
        posture=posture,
        duplicate=False,
        late=False,
        quality=derive_quality(
            QualityFactsV1(
                available=True,
                synthetic=synthetic,
                gap=False,
                stale=False,
                reconstructing=False,
                sampled=False,
                partial=not synthetic,
                complete_proven=False,
            )
        ),
        price=(
            None
            if price is None
            else ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT")
        ),
        quantity=ExactScaledValueV1(coefficient=100, scale=3, unit_id="BNB"),
    )


def _historical(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...],
) -> HistoricalAtlasInputV1:
    return HistoricalAtlasInputV1(
        rows=rows,
        manifest_digest=_digest("manifest"),
        manifest_published_at_ns=AS_OF_MS * 1_000_000,
        coverage_digest=_digest("historical-coverage"),
        invalid_row_count=2,
        known_gap_count=1,
        duplicate_row_count=0,
    )


def _count_rule(threshold: int, *, relative: bool = False) -> DiscoveryRuleV1:
    return DiscoveryRuleV1(
        rule_id=("relative.count.v1" if relative else "absolute.count.v1"),
        rule_version="v1",
        metric=DiscoveryMetric.TRADE_COUNT,
        basis=(DiscoveryBasis.PREVIOUS_WINDOW_MEAN if relative else DiscoveryBasis.ABSOLUTE),
        window_ns=WINDOW_NS,
        threshold_numerator=threshold,
        threshold_denominator=1,
        lookback_windows=2 if relative else 0,
    )


def _price_rule(numerator: int, denominator: int) -> DiscoveryRuleV1:
    return DiscoveryRuleV1(
        rule_id="absolute.price-range.v1",
        rule_version="v1",
        metric=DiscoveryMetric.PRICE_RANGE,
        basis=DiscoveryBasis.ABSOLUTE,
        window_ns=WINDOW_NS,
        threshold_numerator=numerator,
        threshold_denominator=denominator,
        lookback_windows=0,
    )


def _atlas(
    rows: tuple[ReferenceMarketEvidenceRowV1, ...],
    *,
    rules: tuple[DiscoveryRuleV1, ...],
    max_candidates: int = 4_096,
    max_controls: int = 4_096,
) -> EventAtlasV1:
    return build_event_atlas(
        revision="event-atlas.q03.v1",
        as_of_ms=AS_OF_MS,
        historical=_historical(rows),
        forward_coverage_digest=_digest("forward-coverage-missing"),
        forward_fixture_digest=_digest("forward-synthetic-fixture"),
        forward_schema_digest=_digest("forward-schema"),
        rules=rules,
        max_candidates=max_candidates,
        max_controls=max_controls,
    )


def test_two_tiers_are_structurally_honest_and_canonical() -> None:
    atlas = _atlas((_row(1),), rules=(_count_rule(2),))

    assert tuple(tier.tier for tier in atlas.tiers) == tuple(EventAtlasTier)
    historical, forward = atlas.tiers
    assert historical.evidence_posture is TierEvidencePosture.REAL_CHECKSUM_VERIFIED_ARCHIVE
    assert historical.real_coverage_status is RealCoverageStatus.OBSERVED
    assert forward.evidence_posture is TierEvidencePosture.SYNTHETIC_CONTRACT_ONLY
    assert forward.real_coverage_status is RealCoverageStatus.MISSING
    assert forward.delivery_status is DeliveryStatus.BLOCKED
    assert forward.manifest_digest is None
    assert parse_canonical_object(atlas.canonical_bytes()) == atlas.as_mapping()
    assert atlas.sha256 == hashlib.sha256(atlas.canonical_bytes()).hexdigest()
    forbidden = ("p(bait)", "profitability", "causalintent", "calibratedprobability")
    compact = atlas.canonical_bytes().decode().lower().replace("_", "")
    assert all(term not in compact for term in forbidden)


def test_zero_candidates_is_valid_and_controls_are_exact() -> None:
    atlas = _atlas(
        (_row(1, window=0), _row(2, window=1)),
        rules=(_count_rule(99),),
    )

    assert atlas.total_candidate_count == 0
    assert atlas.candidates == ()
    assert atlas.total_control_count == 2
    assert all(record.inventory_class is InventoryClass.CONTROL for record in atlas.controls)
    assert atlas.invalid_row_count == 2
    assert atlas.known_gap_count == 1
    assert atlas.utc_dates == ("2017-11-06",)


def test_candidate_uses_exact_absolute_price_ratio_and_binds_missing_truth() -> None:
    atlas = _atlas(
        (
            _row(1, offset_ms=1, price=10_000),
            _row(2, offset_ms=2, price=10_500),
        ),
        rules=(_price_rule(1, 20),),
    )

    assert atlas.total_candidate_count == 1
    candidate = atlas.candidates[0]
    assert candidate.matched_rule_ids == ("absolute.price-range.v1",)
    assert candidate.later_outcomes_status is EvidenceAvailability.UNAVAILABLE
    assert candidate.source_coverage_digest == _digest("historical-coverage")
    assert candidate.evolution_evidence_digest is not None
    assert candidate.instrument.economics_posture is EconomicsPosture.UNAVAILABLE
    assert "EFFECTIVE_DATED_FILTERS" in candidate.instrument.missing_identity_fields


def test_relative_baseline_requires_contiguous_windows_and_is_exact() -> None:
    rows = (
        _row(1, window=0),
        _row(2, window=1),
        _row(3, window=2),
        _row(4, window=2, offset_ms=1),
        _row(5, window=2, offset_ms=2),
        _row(6, window=2, offset_ms=3),
    )
    atlas = _atlas(rows, rules=(_count_rule(3, relative=True),))
    final = next(
        record for record in atlas.candidates if record.window_start_ns > BASE_MS * 1_000_000
    )
    assert final.matched_rule_ids == ("relative.count.v1",)
    assert final.pre_window_evidence_digest is not None

    permuted = _atlas(tuple(reversed(rows)), rules=(_count_rule(3, relative=True),))
    permuted_final = max(
        (*permuted.candidates, *permuted.controls),
        key=lambda record: record.window_start_ns,
    )
    assert permuted_final.pre_window_evidence_digest == final.pre_window_evidence_digest

    changed_oldest = (replace(rows[0], raw_payload_digest=_digest("changed-oldest")), *rows[1:])
    changed = _atlas(changed_oldest, rules=(_count_rule(3, relative=True),))
    changed_final = max(
        (*changed.candidates, *changed.controls),
        key=lambda record: record.window_start_ns,
    )
    assert changed_final.evolution_evidence_digest == final.evolution_evidence_digest
    assert changed_final.pre_window_evidence_digest != final.pre_window_evidence_digest

    renamed_rule = replace(
        _count_rule(3, relative=True),
        rule_id="relative.count.renamed.v1",
    )
    renamed = _atlas(rows, rules=(renamed_rule,))
    renamed_final = max(
        (*renamed.candidates, *renamed.controls),
        key=lambda record: record.window_start_ns,
    )
    assert renamed_final.pre_window_evidence_digest != final.pre_window_evidence_digest

    sparse = _atlas(
        tuple(row for row in rows if row.record_id != "record-2"),
        rules=(_count_rule(3, relative=True),),
    )
    last = max((*sparse.candidates, *sparse.controls), key=lambda record: record.window_start_ns)
    assert last.inventory_class is InventoryClass.CONTROL
    assert last.unevaluable_rule_ids == ("relative.count.v1",)
    assert last.pre_window_evidence_digest is None


def test_atlas_cutoff_binds_manifest_row_clocks_and_complete_windows() -> None:
    def build(historical: HistoricalAtlasInputV1, *, as_of_ms: int = AS_OF_MS) -> EventAtlasV1:
        return build_event_atlas(
            revision="event-atlas.q03.cutoff.v1",
            as_of_ms=as_of_ms,
            historical=historical,
            forward_coverage_digest=_digest("forward-coverage-missing"),
            forward_fixture_digest=_digest("forward-synthetic-fixture"),
            forward_schema_digest=_digest("forward-schema"),
            rules=(_count_rule(1),),
        )

    historical = _historical((_row(1),))
    with pytest.raises(ContractValueError, match="manifest publication"):
        build(
            replace(
                historical,
                manifest_published_at_ns=(AS_OF_MS + 1) * 1_000_000,
            )
        )

    future_normalization = replace(
        _row(1),
        normalization_time_ns=(AS_OF_MS + 1) * 1_000_000,
        persistence_time_ns=(AS_OF_MS + 2) * 1_000_000,
    )
    with pytest.raises(ContractValueError, match="normalization time"):
        build(
            replace(
                historical,
                rows=(future_normalization,),
                manifest_published_at_ns=(AS_OF_MS + 2) * 1_000_000,
            )
        )

    future_persistence = replace(
        _row(1),
        persistence_time_ns=(AS_OF_MS + 1) * 1_000_000,
    )
    with pytest.raises(ContractValueError, match="persistence time"):
        build(
            replace(
                historical,
                rows=(future_persistence,),
                manifest_published_at_ns=(AS_OF_MS + 1) * 1_000_000,
            )
        )

    bucket_start_ms = AS_OF_MS // 60_000 * 60_000
    partial_cutoff_ms = bucket_start_ms + 30_000
    partial_row = replace(
        _row(1),
        event_time=RawTimestampV1(
            raw=partial_cutoff_ms - 1_000,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
        ),
        normalization_time_ns=(partial_cutoff_ms - 500) * 1_000_000,
        persistence_time_ns=(partial_cutoff_ms - 400) * 1_000_000,
    )
    partial_historical = replace(
        historical,
        rows=(partial_row,),
        manifest_published_at_ns=(partial_cutoff_ms - 300) * 1_000_000,
    )
    with pytest.raises(ContractValueError, match="partial windows"):
        build(partial_historical, as_of_ms=partial_cutoff_ms)

    complete = build(partial_historical, as_of_ms=bucket_start_ms + 60_000)
    assert complete.historical_row_count == 1


def test_instrument_observation_is_the_earliest_evidence_inside_its_window() -> None:
    rows = (
        _row(1, offset_ms=500),
        _row(2, offset_ms=100),
    )
    atlas = _atlas(rows, rules=(_count_rule(1),))
    record = atlas.candidates[0]

    assert record.instrument.observed_at_ns == (BASE_MS + 100) * 1_000_000
    with pytest.raises(ContractValueError, match="inside the discovery window"):
        replace(
            record,
            instrument=replace(record.instrument, observed_at_ns=record.window_end_ns),
        )


def test_input_permutation_produces_identical_registry_and_projection() -> None:
    rows = (
        _row(1, window=0),
        _row(2, window=1),
        _row(3, window=1, offset_ms=1),
    )
    rules = (_count_rule(2),)
    first = _atlas(rows, rules=rules)
    second = _atlas(tuple(reversed(rows)), rules=rules)

    assert first.canonical_bytes() == second.canonical_bytes()
    assert render_event_atlas_markdown(first) == render_event_atlas_markdown(second)
    verify_event_atlas_markdown(render_event_atlas_markdown(first), first)
    with pytest.raises(ContractValueError, match="differs"):
        verify_event_atlas_markdown(render_event_atlas_markdown(first) + "drift\n", first)


def test_inventory_bounds_report_exact_omitted_counts() -> None:
    rows = tuple(_row(index + 1, window=index) for index in range(5))
    atlas = _atlas(
        rows,
        rules=(_count_rule(1),),
        max_candidates=2,
        max_controls=0,
    )

    assert atlas.total_candidate_count == 5
    assert len(atlas.candidates) == 2
    assert atlas.omitted_candidate_count == 3
    assert atlas.omitted_candidate_row_count == 3
    assert atlas.total_control_count == 0
    assert atlas.omitted_control_row_count == 0


def test_unknown_asset_ids_expand_point_in_time_identity_missingness() -> None:
    atlas = _atlas(
        (_row(1, base="UNKNOWN_BASE", quote="UNKNOWN_QUOTE"),),
        rules=(_count_rule(1),),
    )
    missing = atlas.candidates[0].instrument.missing_identity_fields
    assert "BASE_ASSET_ID" in missing
    assert "QUOTE_ASSET_ID" in missing


def test_default_rules_are_multiple_versioned_absolute_and_relative_descriptors() -> None:
    rules = default_discovery_rules()
    assert len(rules) == 4
    assert {rule.basis for rule in rules} == {
        DiscoveryBasis.ABSOLUTE,
        DiscoveryBasis.PREVIOUS_WINDOW_MAX,
        DiscoveryBasis.PREVIOUS_WINDOW_MEAN,
    }
    assert {rule.metric for rule in rules} == {
        DiscoveryMetric.PRICE_RANGE,
        DiscoveryMetric.TRADE_COUNT,
    }
    assert all(rule.rule_version == "v1" for rule in rules)
    assert all(isinstance(rule.threshold_numerator, int) for rule in rules)


def test_forward_tier_cannot_impersonate_real_coverage() -> None:
    atlas = _atlas((_row(1),), rules=(_count_rule(2),))
    mutations: tuple[Callable[[AtlasTierDescriptorV1], AtlasTierDescriptorV1], ...] = (
        lambda tier: replace(
            tier,
            evidence_posture=TierEvidencePosture.REAL_CHECKSUM_VERIFIED_ARCHIVE,
        ),
        lambda tier: replace(tier, manifest_digest=_digest("forged-real")),
        lambda tier: replace(tier, real_coverage_status=RealCoverageStatus.OBSERVED),
        lambda tier: replace(tier, delivery_status=DeliveryStatus.AVAILABLE),
        lambda tier: replace(tier, synthetic_fixture_digest=None),
        lambda tier: replace(tier, synthetic_schema_digest=None),
    )
    for mutate in mutations:
        with pytest.raises(ContractValueError, match="forward tier"):
            mutate(atlas.tiers[1])


@pytest.mark.parametrize(
    "rule",
    [
        DiscoveryRuleV1(
            "invalid.absolute-lookback",
            "v1",
            DiscoveryMetric.TRADE_COUNT,
            DiscoveryBasis.ABSOLUTE,
            WINDOW_NS,
            1,
            1,
            0,
        ),
        DiscoveryRuleV1(
            "invalid.relative-lookback",
            "v1",
            DiscoveryMetric.TRADE_COUNT,
            DiscoveryBasis.PREVIOUS_WINDOW_MEAN,
            WINDOW_NS,
            1,
            1,
            1,
        ),
    ],
)
def test_rules_are_frozen(rule: DiscoveryRuleV1) -> None:
    with pytest.raises(FrozenInstanceError):
        rule.threshold_numerator = 2  # type: ignore[misc]


def test_invalid_rules_rows_and_mutable_inputs_fail_closed() -> None:
    with pytest.raises(ContractValueError):
        replace(_count_rule(2), lookback_windows=1)
    with pytest.raises(ContractValueError):
        replace(_count_rule(2, relative=True), lookback_windows=0)
    with pytest.raises(ContractValueError):
        replace(_count_rule(2), threshold_denominator=0)
    with pytest.raises(ContractValueError):
        replace(_count_rule(2), basis=DiscoveryBasis.PREVIOUS_WINDOW_MAX, lookback_windows=1)
    with pytest.raises(ContractValueError, match="synthetic"):
        _historical((_row(1, posture=EvidencePosture.SYNTHETIC),))
    with pytest.raises(ContractValueError, match="unique record IDs"):
        _historical((_row(1), _row(1, offset_ms=1)))
    with pytest.raises(ContractValueError, match="immutable tuple"):
        HistoricalAtlasInputV1(
            rows=[_row(1)],  # type: ignore[arg-type]
            manifest_digest=_digest("manifest"),
            manifest_published_at_ns=AS_OF_MS * 1_000_000,
            coverage_digest=_digest("coverage"),
            invalid_row_count=0,
            known_gap_count=0,
            duplicate_row_count=0,
        )


def test_historical_tier_cannot_bind_synthetic_contract_evidence() -> None:
    with pytest.raises(ContractValueError, match="historical tier"):
        AtlasTierDescriptorV1(
            tier=EventAtlasTier.HISTORICAL_COARSE,
            evidence_posture=TierEvidencePosture.SYNTHETIC_CONTRACT_ONLY,
            coverage_digest=_digest("coverage"),
            manifest_digest=None,
            synthetic_fixture_digest=_digest("fixture"),
            synthetic_schema_digest=_digest("schema"),
            real_coverage_status=RealCoverageStatus.MISSING,
            delivery_status=DeliveryStatus.BLOCKED,
        )


def test_tier_descriptor_rejects_untyped_fields_and_bad_optional_digests() -> None:
    atlas = _atlas((_row(1),), rules=(_count_rule(2),))
    forward = atlas.tiers[1]
    mutations: tuple[Callable[[AtlasTierDescriptorV1], AtlasTierDescriptorV1], ...] = (
        lambda tier: replace(tier, tier=cast(Any, "FORWARD_HIGH_FIDELITY")),
        lambda tier: replace(tier, evidence_posture=cast(Any, "SYNTHETIC")),
        lambda tier: replace(tier, coverage_digest=cast(Any, "0" * 64)),
        lambda tier: replace(tier, manifest_digest=cast(Any, "0" * 64)),
        lambda tier: replace(tier, real_coverage_status=cast(Any, "MISSING")),
        lambda tier: replace(tier, delivery_status=cast(Any, "BLOCKED")),
    )
    for mutate in mutations:
        with pytest.raises(ContractValueError):
            mutate(forward)


def test_rule_descriptor_rejects_wrong_enums_and_relative_metric_pairing() -> None:
    rule = _count_rule(2)
    with pytest.raises(ContractValueError, match="metric"):
        replace(rule, metric=cast(Any, "TRADE_COUNT"))
    with pytest.raises(ContractValueError, match="basis"):
        replace(rule, basis=cast(Any, "ABSOLUTE"))
    with pytest.raises(ContractValueError, match="price-range relative"):
        DiscoveryRuleV1(
            "invalid.price-mean.v1",
            "v1",
            DiscoveryMetric.PRICE_RANGE,
            DiscoveryBasis.PREVIOUS_WINDOW_MEAN,
            WINDOW_NS,
            2,
            1,
            1,
        )


def test_historical_input_rejects_unvalidated_rows_and_untyped_digests() -> None:
    good = _historical((_row(1),))
    with pytest.raises(ContractValueError, match="validated Q02"):
        replace(good, rows=(cast(Any, object()),))
    with pytest.raises(ContractValueError, match="manifest_digest"):
        replace(good, manifest_digest=cast(Any, "0" * 64))
    with pytest.raises(ContractValueError, match="manifest_published_at_ns"):
        replace(good, manifest_published_at_ns=cast(Any, "bad"))
    with pytest.raises(ContractValueError, match="must not precede"):
        replace(good, manifest_published_at_ns=(AS_OF_MS - 2) * 1_000_000)
    with pytest.raises(ContractValueError, match="coverage_digest"):
        replace(good, coverage_digest=cast(Any, "0" * 64))


def test_point_in_time_instrument_rejects_fabricated_completeness() -> None:
    instrument = _atlas((_row(1),), rules=(_count_rule(2),)).controls[0].instrument
    with pytest.raises(ContractValueError, match="immutable tuple"):
        replace(instrument, missing_identity_fields=cast(Any, ["LISTING_STATUS"]))
    with pytest.raises(ContractValueError, match="sorted and unique"):
        replace(instrument, missing_identity_fields=("LISTING_STATUS", "LISTING_STATUS"))
    with pytest.raises(ContractValueError, match="report missing"):
        replace(instrument, missing_identity_fields=())
    with pytest.raises(ContractValueError, match="row-field evidence"):
        replace(instrument, identity_posture=cast(Any, "COMPLETE"))
    with pytest.raises(ContractValueError, match="point-in-time economics"):
        replace(instrument, economics_posture=cast(Any, "AVAILABLE"))


def test_window_record_rejects_every_fabricated_state() -> None:
    control = _atlas((_row(1),), rules=(_count_rule(2),)).controls[0]
    with pytest.raises(ContractValueError, match="inventory_class"):
        replace(control, inventory_class=cast(Any, "CONTROL"))
    with pytest.raises(ContractValueError, match="window start"):
        replace(control, window_end_ns=control.window_start_ns)
    with pytest.raises(ContractValueError, match="cannot be empty"):
        replace(control, row_count=0)
    with pytest.raises(ContractValueError):
        replace(control, known_gap_row_count=control.row_count + 1)
    with pytest.raises(ContractValueError, match="matched and unevaluable"):
        replace(
            control,
            matched_rule_ids=("absolute.count.v1",),
            unevaluable_rule_ids=("absolute.count.v1",),
        )
    with pytest.raises(ContractValueError, match="candidate windows"):
        replace(control, inventory_class=InventoryClass.CANDIDATE)
    with pytest.raises(ContractValueError, match="control windows"):
        replace(control, matched_rule_ids=("absolute.count.v1",))
    with pytest.raises(ContractValueError, match="DigestV1 or null"):
        replace(control, pre_window_evidence_digest=cast(Any, "0" * 64))
    with pytest.raises(ContractValueError, match="must be DigestV1"):
        replace(control, evolution_evidence_digest=cast(Any, "0" * 64))
    with pytest.raises(ContractValueError, match="instrument"):
        replace(control, instrument=cast(Any, object()))
    with pytest.raises(ContractValueError, match="later outcomes"):
        replace(control, later_outcomes_status=EvidenceAvailability.AVAILABLE)


def test_event_atlas_envelope_rejects_inconsistent_bounded_inventory() -> None:
    atlas = _atlas(
        (
            _row(1, window=0),
            _row(2, window=1),
            _row(3, window=1, offset_ms=1),
        ),
        rules=(_count_rule(2),),
    )
    candidate = atlas.candidates[0]
    control = atlas.controls[0]
    other_window_rule = replace(atlas.rules[0], rule_id="z.other-window.v1", window_ns=2)
    unknown_rule_candidate = replace(candidate, matched_rule_ids=("unknown.rule.v1",))
    wrong_coverage_candidate = replace(
        candidate,
        source_coverage_digest=_digest("wrong-coverage"),
    )
    after_cutoff_candidate = replace(
        candidate,
        window_end_ns=(AS_OF_MS + 1) * 1_000_000,
    )
    wrong_duration_candidate = replace(
        candidate,
        window_end_ns=candidate.window_end_ns + 99,
    )
    unaligned_candidate = replace(
        candidate,
        window_start_ns=candidate.window_start_ns + 1,
        window_end_ns=candidate.window_end_ns + 1,
        instrument=replace(
            candidate.instrument,
            observed_at_ns=candidate.instrument.observed_at_ns + 1,
        ),
    )
    mutations: tuple[Callable[[EventAtlasV1], EventAtlasV1], ...] = (
        lambda value: replace(value, tiers=cast(Any, list(value.tiers))),
        lambda value: replace(value, tiers=tuple(reversed(value.tiers))),
        lambda value: replace(value, rules=cast(Any, list(value.rules))),
        lambda value: replace(value, rules=()),
        lambda value: replace(value, rules=(value.rules[0], value.rules[0])),
        lambda value: replace(value, rules=(*value.rules, other_window_rule)),
        lambda value: replace(value, candidates=cast(Any, list(value.candidates))),
        lambda value: replace(value, candidates=(cast(Any, object()),)),
        lambda value: replace(value, candidates=(control,)),
        lambda value: replace(value, candidates=(candidate, candidate)),
        lambda value: replace(value, candidates=(unknown_rule_candidate,)),
        lambda value: replace(value, candidates=(wrong_coverage_candidate,)),
        lambda value: replace(value, candidates=(after_cutoff_candidate,)),
        lambda value: replace(value, candidates=(wrong_duration_candidate,)),
        lambda value: replace(value, candidates=(unaligned_candidate,)),
        lambda value: replace(value, total_candidate_count=value.total_candidate_count + 1),
        lambda value: replace(value, total_control_count=value.total_control_count + 1),
        lambda value: replace(value, historical_row_count=value.historical_row_count + 1),
        lambda value: replace(value, omitted_candidate_row_count=1),
        lambda value: replace(value, omitted_control_row_count=1),
        lambda value: replace(
            value,
            total_candidate_count=len(value.candidates) + 2,
            omitted_candidate_count=2,
            omitted_candidate_row_count=1,
        ),
        lambda value: replace(
            value,
            total_control_count=len(value.controls) + 2,
            omitted_control_count=2,
            omitted_control_row_count=1,
        ),
        lambda value: replace(value, as_of_ms=BASE_MS - 1),
        lambda value: replace(value, symbols=(value.symbols[0], value.symbols[0])),
        lambda value: replace(value, utc_dates=("bad",)),
        lambda value: replace(value, utc_dates=("2026-99-99",)),
        lambda value: replace(value, utc_dates=cast(Any, (1,))),
    )
    for mutate in mutations:
        with pytest.raises(ContractValueError):
            mutate(atlas)


def test_price_metric_missingness_and_exact_relative_max_are_explicit() -> None:
    absolute = _price_rule(1, 100)
    no_price = _atlas((_row(1, price=None),), rules=(absolute,))
    assert no_price.controls[0].unevaluable_rule_ids == (absolute.rule_id,)

    mixed_unit_row = replace(
        _row(2, offset_ms=1),
        price=ExactScaledValueV1(coefficient=10_100, scale=2, unit_id="EUR"),
    )
    mixed = _atlas((_row(1), mixed_unit_row), rules=(absolute,))
    assert mixed.controls[0].unevaluable_rule_ids == (absolute.rule_id,)

    nonpositive = _atlas(
        (_row(1, price=0), _row(2, offset_ms=1, price=100)),
        rules=(absolute,),
    )
    assert nonpositive.controls[0].unevaluable_rule_ids == (absolute.rule_id,)

    relative = DiscoveryRuleV1(
        "relative.price.previous-max.v1",
        "v1",
        DiscoveryMetric.PRICE_RANGE,
        DiscoveryBasis.PREVIOUS_WINDOW_MAX,
        WINDOW_NS,
        2,
        1,
        3,
    )
    rows = (
        _row(1, window=0, price=10_000),
        _row(2, window=0, offset_ms=1, price=10_100),
        _row(3, window=1, price=10_000),
        _row(4, window=1, offset_ms=1, price=10_200),
        _row(5, window=2, price=10_000),
        _row(6, window=2, offset_ms=1, price=10_150),
        _row(7, window=3, price=10_000),
        _row(8, window=3, offset_ms=1, price=10_500),
    )
    relative_atlas = _atlas(rows, rules=(relative,))
    final = max(
        (*relative_atlas.candidates, *relative_atlas.controls),
        key=lambda record: record.window_start_ns,
    )
    assert final.matched_rule_ids == (relative.rule_id,)

    missing_baseline = _atlas(
        (
            _row(1, window=0, price=None),
            _row(2, window=1, price=10_000),
            _row(3, window=1, offset_ms=1, price=11_000),
        ),
        rules=(replace(relative, lookback_windows=1),),
    )
    assert max(
        (*missing_baseline.candidates, *missing_baseline.controls),
        key=lambda record: record.window_start_ns,
    ).unevaluable_rule_ids == (relative.rule_id,)

    flat_baseline = _atlas(
        (
            _row(1, window=0, price=10_000),
            _row(2, window=0, offset_ms=1, price=10_000),
            _row(3, window=1, price=10_000),
            _row(4, window=1, offset_ms=1, price=11_000),
        ),
        rules=(replace(relative, lookback_windows=1),),
    )
    assert max(
        (*flat_baseline.candidates, *flat_baseline.controls),
        key=lambda record: record.window_start_ns,
    ).unevaluable_rule_ids == (relative.rule_id,)


def test_builder_rejects_untyped_boundaries_and_rule_sets() -> None:
    historical = _historical((_row(1),))

    def build(**changes: object) -> EventAtlasV1:
        arguments: dict[str, object] = {
            "revision": "event-atlas.q03.hostile.v1",
            "as_of_ms": AS_OF_MS,
            "historical": historical,
            "forward_coverage_digest": _digest("forward-coverage"),
            "forward_fixture_digest": _digest("forward-fixture"),
            "forward_schema_digest": _digest("forward-schema"),
            "rules": (_count_rule(2),),
        }
        arguments.update(changes)
        return build_event_atlas(**cast(Any, arguments))

    invalid_changes: tuple[dict[str, object], ...] = (
        {"historical": object()},
        {"forward_coverage_digest": "0" * 64},
        {"rules": []},
        {"rules": (object(),)},
        {"rules": (_count_rule(2), _count_rule(2))},
        {
            "rules": (
                _count_rule(2),
                replace(_count_rule(2), rule_id="z.other.v1", window_ns=2),
            )
        },
    )
    for changes in invalid_changes:
        with pytest.raises(ContractValueError):
            build(**changes)

    defaulted = build_event_atlas(
        revision="event-atlas.q03.default.v1",
        as_of_ms=AS_OF_MS,
        historical=historical,
        forward_coverage_digest=_digest("forward-coverage"),
        forward_fixture_digest=_digest("forward-fixture"),
        forward_schema_digest=_digest("forward-schema"),
    )
    assert len(defaulted.rules) == 4
    with pytest.raises(ContractValueError, match="atlas must"):
        render_event_atlas_markdown(cast(Any, object()))
