from __future__ import annotations

import hashlib
from dataclasses import FrozenInstanceError, replace
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import CanonicalJsonError, ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    MAX_DECIMAL_COEFFICIENT,
    MAX_OBSERVED_QUALITY_REASON_CODES,
    QUALITY_STATE_ORDER,
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    PartitionKeyV1,
    QualityFactsV1,
    QualityState,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    ResearchQualityAssessmentV1,
    TimestampBasis,
    TimestampUnit,
    _restore_quality_assessment,
    derive_quality,
    require_contract_id,
    require_path_segment,
)
from quant_edge.lake.manifest import (
    MAX_MANIFEST_BYTES,
    DatasetRevisionManifestV1,
    ParentRevisionV1,
    PartitionManifestEntryV1,
    RetentionClass,
    RevisionKind,
)
from quant_edge.lake.retention import (
    MAX_RETENTION_REVISIONS,
    RetentionAction,
    RetentionDecisionV1,
    _derive_retention_decision,
    plan_retention,
)

AS_OF_NS = 1_783_814_400_000_000_000


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _facts() -> QualityFactsV1:
    return QualityFactsV1(
        available=True,
        synthetic=False,
        gap=False,
        stale=False,
        reconstructing=False,
        sampled=False,
        partial=False,
        complete_proven=True,
    )


def _quality_counts(
    row_count: int = 1,
    state: QualityState = QualityState.SYNTHETIC,
) -> tuple[tuple[QualityState, int], ...]:
    return tuple((item, row_count if item is state else 0) for item in QUALITY_STATE_ORDER)


def _partition_key() -> PartitionKeyV1:
    return PartitionKeyV1(
        schema_version="v1",
        venue="binance",
        product="spot",
        event_kind="trade",
        utc_date="2026-07-12",
        symbol_shard="BTCUSDT",
    )


def _partition_entry(
    *,
    revision_id: str = "r1",
    retention_class: RetentionClass = RetentionClass.PRESERVE,
    expires_at_ns: int | None = None,
    parent_artifact_digests: tuple[DigestV1, ...] = (),
) -> PartitionManifestEntryV1:
    key = _partition_key()
    return PartitionManifestEntryV1(
        key=key,
        relative_path=key.relative_partition_path(dataset_id="market", revision_id=revision_id),
        artifact_digest=_digest(f"artifact-{revision_id}"),
        byte_count=4_096,
        row_count=1,
        event_time_min_ns=AS_OF_NS - 2_000,
        event_time_max_ns=AS_OF_NS - 1_000,
        receive_time_min_ns=AS_OF_NS - 1_900,
        receive_time_max_ns=AS_OF_NS - 900,
        source_sessions=("session1",),
        quality_counts=_quality_counts(),
        gap_count=0,
        duplicate_count=0,
        late_count=0,
        parent_artifact_digests=parent_artifact_digests,
        retention_class=retention_class,
        expires_at_ns=expires_at_ns,
    )


def _parent(*, dataset_id: str = "market", revision_id: str = "r0") -> ParentRevisionV1:
    return ParentRevisionV1(
        dataset_id=dataset_id,
        revision_id=revision_id,
        manifest_digest=_digest(f"manifest-{dataset_id}-{revision_id}"),
    )


def _manifest(
    *,
    revision_id: str = "r1",
    revision_kind: RevisionKind = RevisionKind.INITIAL,
    parent_revisions: tuple[ParentRevisionV1, ...] | None = None,
    retention_class: RetentionClass = RetentionClass.PRESERVE,
    expires_at_ns: int | None = None,
) -> DatasetRevisionManifestV1:
    if parent_revisions is None:
        parent_revisions = () if revision_kind is RevisionKind.INITIAL else (_parent(),)
    return DatasetRevisionManifestV1(
        dataset_id="market",
        revision_id=revision_id,
        revision_kind=revision_kind,
        published_at_ns=AS_OF_NS,
        parent_revisions=parent_revisions,
        schema_id="ReferenceMarketEvidenceRowV1",
        schema_fingerprint=_digest("schema"),
        writer_profile_id="q02.parquet.v1",
        pyarrow_version="25.0.0",
        dependency_lock_digest=_digest("lock"),
        code_profile_digest=_digest("code"),
        config_digest=_digest("config"),
        producer_activity_id="activity.q02",
        truth_posture=EvidencePosture.SYNTHETIC,
        partition=_partition_entry(
            revision_id=revision_id,
            retention_class=retention_class,
            expires_at_ns=expires_at_ns,
        ),
    )


def _timestamp(ns: int = AS_OF_NS) -> RawTimestampV1:
    return RawTimestampV1(
        raw=ns,
        unit=TimestampUnit.NANOSECOND,
        basis=TimestampBasis.DECLARED,
    )


def _row() -> ReferenceMarketEvidenceRowV1:
    return ReferenceMarketEvidenceRowV1(
        record_id="record1",
        source_id="public_source",
        source_endpoint="public_endpoint",
        venue="binance",
        product="spot",
        event_kind="trade",
        symbol="BTCUSDT",
        base_asset_id="BTC",
        quote_asset_id="USDT",
        instrument_version="v1",
        stream_id="stream1",
        event_time=_timestamp(AS_OF_NS - 2_000),
        trade_time=_timestamp(AS_OF_NS - 2_100),
        receive_wall_time=_timestamp(AS_OF_NS - 1_900),
        receive_monotonic_ns=10,
        normalization_time_ns=AS_OF_NS - 1_800,
        persistence_time_ns=AS_OF_NS - 1_700,
        session_id="session1",
        sequence_first=7,
        sequence_last=8,
        raw_payload_digest=_digest("payload"),
        posture=EvidencePosture.SYNTHETIC,
        duplicate=False,
        late=False,
        quality=derive_quality(replace(_facts(), synthetic=True, complete_proven=False)),
        price=ExactScaledValueV1(coefficient=123_450, scale=2, unit_id="USDT"),
        quantity=ExactScaledValueV1(coefficient=25, scale=3, unit_id="BTC"),
    )


def _mapping_parts(
    manifest: DatasetRevisionManifestV1,
) -> tuple[dict[str, object], dict[str, object], dict[str, object], dict[str, object]]:
    envelope = manifest.as_mapping()
    core = cast(dict[str, object], envelope["core"])
    partition = cast(dict[str, object], core["partition"])
    key = cast(dict[str, object], partition["key"])
    return envelope, core, partition, key


@pytest.mark.parametrize(
    ("changes", "expected_state", "expected_generated_reason"),
    [
        ({}, QualityState.COMPLETE, "COMPLETE_PROOF"),
        (
            {"partial": True, "complete_proven": False},
            QualityState.PARTIAL,
            "PARTIAL_EVIDENCE",
        ),
        ({"gap": True}, QualityState.GAPPED, "KNOWN_GAP"),
        ({"stale": True}, QualityState.STALE, "STALE_EVIDENCE"),
        (
            {"reconstructing": True},
            QualityState.RECONSTRUCTING,
            "RECONSTRUCTING",
        ),
        ({"sampled": True}, QualityState.SAMPLED, "SAMPLED_EVIDENCE"),
        (
            {"available": False, "complete_proven": False},
            QualityState.UNAVAILABLE,
            "EXPLICITLY_UNAVAILABLE",
        ),
        (
            {"synthetic": True, "complete_proven": False},
            QualityState.SYNTHETIC,
            "SYNTHETIC_EVIDENCE",
        ),
        (
            {"available": None, "complete_proven": None},
            QualityState.UNKNOWN,
            "REQUIRED_FACT_UNKNOWN",
        ),
    ],
)
def test_quality_derivation_covers_every_state_with_a_reason(
    changes: dict[str, object],
    expected_state: QualityState,
    expected_generated_reason: str,
) -> None:
    facts = replace(_facts(), **changes)  # type: ignore[arg-type]
    assessment = derive_quality(facts)

    assert assessment.state is expected_state
    assert expected_generated_reason in assessment.reason_codes
    assert assessment.reason_codes == tuple(sorted(set(assessment.reason_codes)))


@pytest.mark.parametrize(
    ("changes", "expected_state"),
    [
        (
            {
                "available": False,
                "synthetic": True,
                "gap": True,
                "reconstructing": True,
                "stale": True,
                "sampled": True,
                "partial": True,
                "complete_proven": False,
            },
            QualityState.UNAVAILABLE,
        ),
        (
            {
                "synthetic": True,
                "gap": True,
                "reconstructing": True,
                "stale": True,
                "sampled": True,
                "partial": True,
                "complete_proven": False,
            },
            QualityState.SYNTHETIC,
        ),
        (
            {
                "gap": True,
                "reconstructing": True,
                "stale": True,
                "sampled": True,
                "partial": True,
                "complete_proven": False,
            },
            QualityState.GAPPED,
        ),
        (
            {
                "reconstructing": True,
                "stale": True,
                "sampled": True,
                "partial": True,
                "complete_proven": False,
            },
            QualityState.RECONSTRUCTING,
        ),
        (
            {
                "stale": True,
                "sampled": True,
                "partial": True,
                "complete_proven": False,
            },
            QualityState.STALE,
        ),
        (
            {"sampled": True, "partial": True, "complete_proven": False},
            QualityState.SAMPLED,
        ),
        (
            {"available": None, "partial": True, "complete_proven": None},
            QualityState.PARTIAL,
        ),
    ],
)
def test_quality_precedence_is_frozen_and_lower_priority_reasons_are_retained(
    changes: dict[str, object],
    expected_state: QualityState,
) -> None:
    assessment = derive_quality(replace(_facts(), **changes))  # type: ignore[arg-type]
    assert assessment.state is expected_state
    if changes.get("sampled") is True:
        assert "SAMPLED_EVIDENCE" in assessment.reason_codes
    if changes.get("partial") is True:
        assert "PARTIAL_EVIDENCE" in assessment.reason_codes


def test_observed_quality_reasons_are_preserved_without_reordering() -> None:
    facts = replace(
        _facts(),
        stale=True,
        observed_reasons=("SOURCE_CLOCK_DRIFT", "UPSTREAM_WARNING"),
    )
    assert derive_quality(facts).reason_codes == (
        "SOURCE_CLOCK_DRIFT",
        "STALE_EVIDENCE",
        "UPSTREAM_WARNING",
    )


def test_unproven_completeness_is_partial_without_caller_asserting_partial() -> None:
    assessment = derive_quality(replace(_facts(), complete_proven=False))

    assert assessment.state is QualityState.PARTIAL
    assert assessment.reason_codes == ("COMPLETENESS_NOT_PROVEN",)


def test_unavailable_row_rejects_numeric_observations() -> None:
    unavailable = derive_quality(
        QualityFactsV1(
            available=False,
            synthetic=False,
            gap=False,
            stale=False,
            reconstructing=False,
            sampled=False,
            partial=False,
            complete_proven=None,
        )
    )

    with pytest.raises(ContractValueError, match="unavailable evidence cannot contain numeric"):
        replace(
            _row(),
            posture=EvidencePosture.REPLAY,
            quality=unavailable,
            price=ExactScaledValueV1(1, 0, "USDT"),
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"available": False, "complete_proven": True},
        {"synthetic": True, "complete_proven": True},
        {"partial": True, "complete_proven": True},
    ],
)
def test_quality_facts_reject_contradictory_claims(changes: dict[str, object]) -> None:
    with pytest.raises(ContractValueError):
        replace(_facts(), **changes)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("available", 1),
        ("synthetic", 1),
        ("gap", None),
        ("stale", "false"),
        ("reconstructing", 0),
        ("sampled", object()),
        ("partial", []),
        ("complete_proven", 0),
        ("observed_reasons", ("OUT_OF_ORDER", "NOT_SORTED")),
        ("observed_reasons", ("DUPLICATE", "DUPLICATE")),
        ("observed_reasons", ("lowercase",)),
        ("observed_reasons", ("KNOWN_GAP",)),
        (
            "observed_reasons",
            tuple(f"EXTERNAL_{index:02}" for index in range(MAX_OBSERVED_QUALITY_REASON_CODES + 1)),
        ),
        ("observed_reasons", ["MUTABLE"]),
    ],
)
def test_quality_facts_reject_untyped_or_noncanonical_values(
    field_name: str,
    value: object,
) -> None:
    with pytest.raises(ContractValueError):
        replace(_facts(), **{field_name: value})  # type: ignore[arg-type]


def test_quality_assessment_is_typed_sorted_unique_and_immutable() -> None:
    assessment = derive_quality(
        replace(
            _facts(),
            gap=True,
            complete_proven=False,
            observed_reasons=("UPSTREAM_WARNING",),
        )
    )
    with pytest.raises(FrozenInstanceError):
        assessment.state = QualityState.COMPLETE  # type: ignore[misc]


def test_observed_reason_bound_reserves_worst_case_engine_capacity() -> None:
    observed = tuple(f"EXTERNAL_{index:02}" for index in range(MAX_OBSERVED_QUALITY_REASON_CODES))
    assessment = derive_quality(
        QualityFactsV1(
            available=False,
            synthetic=True,
            gap=True,
            stale=True,
            reconstructing=True,
            sampled=True,
            partial=True,
            complete_proven=None,
            observed_reasons=observed,
        )
    )

    assert assessment.state is QualityState.UNAVAILABLE
    assert len(assessment.reason_codes) == 32
    assert set(observed).issubset(assessment.reason_codes)
    with pytest.raises(ContractValueError, match="engine-derived"):
        ResearchQualityAssessmentV1(
            state=QualityState.GAPPED,
            reason_codes=("KNOWN_GAP",),
        )
    for state, reasons in (
        ("GAPPED", ("KNOWN_GAP",)),
        (QualityState.GAPPED, ("UPSTREAM_WARNING", "KNOWN_GAP")),
        (QualityState.GAPPED, ("KNOWN_GAP", "KNOWN_GAP")),
        (QualityState.GAPPED, ("not_upper",)),
        (QualityState.COMPLETE, ("KNOWN_GAP",)),
        (QualityState.COMPLETE, ("UPSTREAM_WARNING",)),
        (
            QualityState.COMPLETE,
            tuple(f"EXTERNAL_{index:02}" for index in range(33)),
        ),
    ):
        with pytest.raises(ContractValueError):
            _restore_quality_assessment(
                state,  # type: ignore[arg-type]
                reasons,
            )


@pytest.mark.parametrize("coefficient", [-MAX_DECIMAL_COEFFICIENT, 0, MAX_DECIMAL_COEFFICIENT])
@pytest.mark.parametrize("scale", [0, 38])
def test_exact_scaled_values_accept_only_frozen_numeric_boundaries(
    coefficient: int,
    scale: int,
) -> None:
    assert ExactScaledValueV1(coefficient, scale, "USDT") == ExactScaledValueV1(
        coefficient=coefficient,
        scale=scale,
        unit_id="USDT",
    )


def test_non_path_contract_fields_accept_canonical_colon_and_dotted_ids() -> None:
    stable_id = "runtime:0123456789abcdef01234567"
    row = replace(
        _row(),
        record_id=stable_id,
        source_id="source:0123456789abcdef01234567",
        source_endpoint="binance.spot.websocket.market",
        base_asset_id="asset:0123456789abcdef01234567",
        quote_asset_id="asset:89abcdef0123456789abcdef",
        session_id="session:0123456789abcdef01234567",
        price=ExactScaledValueV1(1, 0, "asset:89abcdef0123456789abcdef"),
    )
    assert row.record_id == stable_id
    entry = replace(_partition_entry(), source_sessions=(row.session_id,))
    assert entry.source_sessions == (row.session_id,)


@pytest.mark.parametrize(
    ("coefficient", "scale", "unit_id"),
    [
        (MAX_DECIMAL_COEFFICIENT + 1, 0, "USDT"),
        (-MAX_DECIMAL_COEFFICIENT - 1, 0, "USDT"),
        (True, 0, "USDT"),
        (1.0, 0, "USDT"),
        (1, True, "USDT"),
        (1, -1, "USDT"),
        (1, 39, "USDT"),
        (1, 0.0, "USDT"),
        (1, 0, ""),
        (1, 0, "."),
        (1, 0, "../USD"),
        (1, 0, "USD/USDT"),
        (1, 0, "\u20ac"),
        (1, 0, "U" * 129),
    ],
)
def test_exact_scaled_values_reject_lossy_ambiguous_or_unbounded_inputs(
    coefficient: object,
    scale: object,
    unit_id: object,
) -> None:
    with pytest.raises(ContractValueError):
        ExactScaledValueV1(
            coefficient=coefficient,  # type: ignore[arg-type]
            scale=scale,  # type: ignore[arg-type]
            unit_id=unit_id,  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    ("unit", "multiplier"),
    [
        (TimestampUnit.MILLISECOND, 1_000_000),
        (TimestampUnit.MICROSECOND, 1_000),
        (TimestampUnit.NANOSECOND, 1),
    ],
)
def test_timestamp_units_normalize_exactly_at_both_plausibility_boundaries(
    unit: TimestampUnit,
    multiplier: int,
) -> None:
    lower = RawTimestampV1(
        raw=UTC_NS_MIN // multiplier,
        unit=unit,
        basis=TimestampBasis.DECLARED,
    )
    upper = RawTimestampV1(
        raw=UTC_NS_MAX // multiplier,
        unit=unit,
        basis=TimestampBasis.INFERRED,
    )
    assert lower.normalized_ns == UTC_NS_MIN
    assert upper.normalized_ns == UTC_NS_MAX


@pytest.mark.parametrize(
    ("unit", "multiplier"),
    [
        (TimestampUnit.MILLISECOND, 1_000_000),
        (TimestampUnit.MICROSECOND, 1_000),
        (TimestampUnit.NANOSECOND, 1),
    ],
)
def test_timestamp_units_reject_values_just_outside_plausibility_range(
    unit: TimestampUnit,
    multiplier: int,
) -> None:
    for raw in (UTC_NS_MIN // multiplier - 1, UTC_NS_MAX // multiplier + 1):
        with pytest.raises(ContractValueError, match="plausible UTC range"):
            RawTimestampV1(raw=raw, unit=unit, basis=TimestampBasis.DECLARED)


@pytest.mark.parametrize("raw", [True, 1.5, INT64_MAX + 1])
def test_timestamp_rejects_non_integer_or_overflowing_raw_values(raw: object) -> None:
    with pytest.raises(ContractValueError):
        RawTimestampV1(
            raw=raw,  # type: ignore[arg-type]
            unit=TimestampUnit.NANOSECOND,
            basis=TimestampBasis.DECLARED,
        )


def test_timestamp_requires_explicit_unit_and_basis_enums() -> None:
    with pytest.raises(ContractValueError, match="explicit TimestampUnit"):
        RawTimestampV1(
            raw=AS_OF_NS,
            unit="NANOSECOND",  # type: ignore[arg-type]
            basis=TimestampBasis.DECLARED,
        )
    with pytest.raises(ContractValueError, match="explicit TimestampBasis"):
        RawTimestampV1(
            raw=AS_OF_NS,
            unit=TimestampUnit.NANOSECOND,
            basis="DECLARED",  # type: ignore[arg-type]
        )


@pytest.mark.parametrize("value", ["a", "A0_-", "a" * 64])
def test_strict_path_segments_accept_only_bounded_ascii_components(value: str) -> None:
    assert require_path_segment(value, field="segment") == value


@pytest.mark.parametrize(
    "value",
    ["", ".", "..", "-bad", "_bad", "a.b", "../a", "a/b", "a\\b", "a\x00b", "\u00e9", "a" * 65, 1],
)
def test_strict_path_segments_reject_traversal_and_ambiguous_components(value: object) -> None:
    with pytest.raises(ContractValueError):
        require_path_segment(value, field="segment")


@pytest.mark.parametrize("value", ["schema.v1", "q02+writer:1", "activity_q02"])
def test_contract_identifiers_allow_bounded_non_path_punctuation(value: str) -> None:
    assert require_contract_id(value, field="identifier") == value


@pytest.mark.parametrize("value", [".", "..", "/bad", "bad/path", "x" * 129, 1])
def test_contract_identifiers_still_reject_traversal_or_wrong_types(value: object) -> None:
    with pytest.raises(ContractValueError):
        require_contract_id(value, field="identifier")


def test_partition_key_derives_the_only_allowed_relative_path() -> None:
    key = _partition_key()
    assert key.relative_partition_path(dataset_id="market", revision_id="r1") == (
        "datasets/market/revisions/r1/partitions/v1/binance/spot/trade/2026-07-12/BTCUSDT.parquet"
    )
    for dataset_id, revision_id in (("..", "r1"), ("market", "../r1"), ("a/b", "r1")):
        with pytest.raises(ContractValueError):
            key.relative_partition_path(dataset_id=dataset_id, revision_id=revision_id)


@pytest.mark.parametrize(
    "utc_date",
    ["2026-7-12", "2026-07-1", "2026-02-29", "2026-07-12T00:00:00", "../2026-07-12", ""],
)
def test_partition_key_rejects_invalid_or_noncanonical_dates(utc_date: str) -> None:
    with pytest.raises(ContractValueError, match="canonical YYYY-MM-DD"):
        replace(_partition_key(), utc_date=utc_date)


def test_partition_key_translates_non_string_date_to_contract_error() -> None:
    with pytest.raises(ContractValueError, match="canonical YYYY-MM-DD"):
        replace(_partition_key(), utc_date=None)  # type: ignore[arg-type]


def test_reference_row_keeps_missing_exact_values_null_without_fabricating_zero() -> None:
    row = replace(_row(), price=None, quantity=None)
    assert row.price is None
    assert row.quantity is None
    assert row.canonical_order_key == (
        row.event_time.normalized_ns,
        0,
        cast(RawTimestampV1, row.receive_wall_time).normalized_ns,
        "session1",
        "stream1",
        0,
        7,
        "record1",
    )


@pytest.mark.parametrize(
    ("sequence_first", "sequence_last"),
    [(None, 1), (1, None), (9, 8), (-1, 1), (0, 2**64), (True, 1)],
)
def test_reference_row_rejects_unpaired_reversed_or_invalid_sequences(
    sequence_first: object,
    sequence_last: object,
) -> None:
    with pytest.raises(ContractValueError):
        replace(
            _row(),
            sequence_first=sequence_first,  # type: ignore[arg-type]
            sequence_last=sequence_last,  # type: ignore[arg-type]
        )


def test_reference_row_allows_both_sequences_to_be_absent_without_inventing_one() -> None:
    row = replace(_row(), sequence_first=None, sequence_last=None)
    assert row.sequence_first is None
    assert row.sequence_last is None


def test_reference_row_requires_quality_and_posture_to_agree() -> None:
    complete_quality = derive_quality(_facts())
    with pytest.raises(ContractValueError, match="synthetic posture"):
        replace(_row(), posture=EvidencePosture.REPLAY)
    with pytest.raises(ContractValueError, match="synthetic posture"):
        replace(_row(), quality=complete_quality)
    synthetic = _row()
    assert synthetic.posture is EvidencePosture.SYNTHETIC
    assert synthetic.quality.state is QualityState.SYNTHETIC


@pytest.mark.parametrize("field_name", ["price", "quantity"])
@pytest.mark.parametrize("value", [0, 1.0, True, {"coefficient": 1}])
def test_reference_row_rejects_non_exact_numeric_objects(field_name: str, value: object) -> None:
    with pytest.raises(ContractValueError, match="ExactScaledValueV1 or null"):
        replace(_row(), **{field_name: value})  # type: ignore[arg-type]


def test_reference_row_rejects_reversed_persistence_or_invalid_observation_fields() -> None:
    with pytest.raises(ContractValueError, match="must not follow"):
        replace(
            _row(),
            normalization_time_ns=AS_OF_NS,
            persistence_time_ns=AS_OF_NS - 1,
        )
    with pytest.raises(ContractValueError):
        replace(_row(), receive_monotonic_ns=-1)
    with pytest.raises(ContractValueError):
        replace(_row(), duplicate=1)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError):
        replace(_row(), raw_payload_digest="f" * 64)  # type: ignore[arg-type]


def test_reference_row_is_frozen() -> None:
    row = _row()
    with pytest.raises(FrozenInstanceError):
        row.record_id = "changed"  # type: ignore[misc]


def test_manifest_roundtrip_is_canonical_content_addressed_and_immutable() -> None:
    manifest = _manifest()
    raw = manifest.to_bytes()
    parsed = DatasetRevisionManifestV1.from_bytes(raw)

    assert raw.endswith(b"\n")
    assert parsed == manifest
    assert parsed.to_bytes() == raw
    assert manifest.manifest_id == _digest_from_bytes(canonical_json_bytes(manifest.core_mapping()))
    assert manifest.digest == _digest_from_bytes(raw)
    assert manifest.manifest_id != manifest.digest
    with pytest.raises(FrozenInstanceError):
        manifest.revision_id = "changed"  # type: ignore[misc]


def _digest_from_bytes(raw: bytes) -> DigestV1:
    return DigestV1(hashlib.sha256(raw).hexdigest())


def test_correction_manifest_roundtrip_pins_exactly_one_prior_revision() -> None:
    manifest = _manifest(revision_id="r2", revision_kind=RevisionKind.CORRECTION)
    parsed = DatasetRevisionManifestV1.from_bytes(manifest.to_bytes())
    assert parsed.parent_revisions == (_parent(),)
    assert parsed.revision_kind is RevisionKind.CORRECTION


@pytest.mark.parametrize("location", ["envelope", "core", "partition", "key", "quality"])
@pytest.mark.parametrize("operation", ["unknown", "missing"])
def test_manifest_parser_rejects_unknown_or_missing_keys(location: str, operation: str) -> None:
    manifest = _manifest()
    envelope, core, partition, key = _mapping_parts(manifest)
    target: dict[str, object]
    known_key: str
    if location == "envelope":
        target, known_key = envelope, "schema"
    elif location == "core":
        target, known_key = core, "schemaId"
    elif location == "partition":
        target, known_key = partition, "rowCount"
    elif location == "key":
        target, known_key = key, "venue"
    else:
        target = cast(dict[str, object], partition["qualityCounts"])
        known_key = QualityState.UNKNOWN.value

    if operation == "unknown":
        target["unexpected"] = "value"
    else:
        del target[known_key]

    with pytest.raises(CanonicalJsonError, match="key mismatch"):
        DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))


def test_manifest_parser_rejects_float_noncanonical_duplicate_and_oversized_json() -> None:
    raw = _manifest().to_bytes()
    float_raw = raw.replace(b'"rowCount":"1"', b'"rowCount":1.0')
    duplicate_raw = raw.replace(
        b'"datasetId":"market"',
        b'"datasetId":"market","datasetId":"market"',
        1,
    )
    for hostile in (
        float_raw,
        raw[:-1],
        b" " + raw,
        duplicate_raw,
        b"x" * (MAX_MANIFEST_BYTES + 1),
    ):
        with pytest.raises(CanonicalJsonError):
            DatasetRevisionManifestV1.from_bytes(hostile)


@pytest.mark.parametrize("replacement", [b'"01"', b'"+1"', b'"-0"', b'"1.0"'])
def test_manifest_parser_rejects_noncanonical_decimal_strings(replacement: bytes) -> None:
    raw = _manifest().to_bytes().replace(b'"rowCount":"1"', b'"rowCount":' + replacement)
    with pytest.raises(CanonicalJsonError, match="canonical decimal integer string"):
        DatasetRevisionManifestV1.from_bytes(raw)


def test_manifest_parser_requires_exact_integer_version_not_boolean_equivalence() -> None:
    manifest = _manifest()
    envelope = manifest.as_mapping()
    envelope["version"] = True
    with pytest.raises(CanonicalJsonError, match="schema or version"):
        DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))


def test_manifest_parser_rejects_unknown_enums_and_manifest_id_tampering() -> None:
    manifest = _manifest()
    envelope, core, partition, _key = _mapping_parts(manifest)
    core["revisionKind"] = "DERIVATION"
    with pytest.raises(CanonicalJsonError, match="contract violation"):
        DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))

    envelope, _core, partition, _key = _mapping_parts(manifest)
    partition["retentionClass"] = "DELETE_ALWAYS"
    with pytest.raises(CanonicalJsonError, match="contract violation"):
        DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))

    envelope = manifest.as_mapping()
    envelope["manifestId"] = "0" * 64
    with pytest.raises(CanonicalJsonError, match="manifestId"):
        DatasetRevisionManifestV1.from_bytes(canonical_json_bytes(envelope))


def test_partition_quality_counts_must_cover_all_states_in_order_and_sum_to_rows() -> None:
    entry = _partition_entry()
    synthetic_index = QUALITY_STATE_ORDER.index(QualityState.SYNTHETIC)
    partial_index = QUALITY_STATE_ORDER.index(QualityState.PARTIAL)
    wrong_sum = list(entry.quality_counts)
    wrong_sum[synthetic_index] = (QualityState.SYNTHETIC, 0)
    reordered = list(entry.quality_counts)
    reordered[synthetic_index], reordered[partial_index] = (
        reordered[partial_index],
        reordered[synthetic_index],
    )
    for counts in (tuple(wrong_sum), tuple(reordered), entry.quality_counts[:-1]):
        with pytest.raises(ContractValueError):
            replace(entry, quality_counts=counts)

    mutable_inner = tuple([state, count] for state, count in entry.quality_counts)
    with pytest.raises(ContractValueError, match="immutable two-item tuples"):
        replace(entry, quality_counts=mutable_inner)  # type: ignore[arg-type]


def test_manifest_collections_are_immutable_and_metadata_bounded() -> None:
    entry = _partition_entry()
    with pytest.raises(ContractValueError, match="quality_counts must be an immutable tuple"):
        replace(entry, quality_counts=list(entry.quality_counts))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="source_sessions must contain"):
        replace(entry, source_sessions=tuple(f"session{index:04}" for index in range(4_097)))
    parent_hashes = tuple(
        sorted(
            (_digest(f"parent-{index}") for index in range(129)),
            key=lambda item: item.hexdigest,
        )
    )
    with pytest.raises(ContractValueError, match="bounded immutable tuple"):
        replace(entry, parent_artifact_digests=parent_hashes)
    correction = _manifest(revision_id="r2", revision_kind=RevisionKind.CORRECTION)
    with pytest.raises(ContractValueError, match="parent_revisions must be an immutable tuple"):
        replace(
            correction,
            parent_revisions=list(correction.parent_revisions),  # type: ignore[arg-type]
        )


def test_partition_rejects_invalid_counts_bounds_sessions_and_parent_hash_order() -> None:
    entry = _partition_entry()
    reverse_sorted_parent_hashes = tuple(
        sorted((_digest("a"), _digest("z")), key=lambda item: item.hexdigest, reverse=True)
    )
    for changes in (
        {"gap_count": 2},
        {"duplicate_count": -1},
        {"late_count": True},
        {"source_sessions": ()},
        {"source_sessions": ("session2", "session1")},
        {"source_sessions": ("session1", "session1")},
        {"parent_artifact_digests": reverse_sorted_parent_hashes},
        {"parent_artifact_digests": (_digest("a"), _digest("a"))},
    ):
        with pytest.raises(ContractValueError):
            replace(entry, **changes)


def test_partition_rejects_unpaired_or_reversed_time_bounds() -> None:
    entry = _partition_entry()
    for changes in (
        {"event_time_min_ns": AS_OF_NS, "event_time_max_ns": AS_OF_NS - 1},
        {"receive_time_min_ns": AS_OF_NS, "receive_time_max_ns": None},
        {"receive_time_min_ns": None, "receive_time_max_ns": AS_OF_NS},
        {"receive_time_min_ns": AS_OF_NS, "receive_time_max_ns": AS_OF_NS - 1},
    ):
        with pytest.raises(ContractValueError):
            replace(entry, **changes)


def test_manifest_rejects_any_relative_path_not_derived_from_typed_key() -> None:
    manifest = _manifest()
    for path in (
        "../escape.parquet",
        "/absolute.parquet",
        manifest.partition.relative_path + "/extra",
        manifest.partition.relative_path.replace("BTCUSDT", "ETHUSDT"),
    ):
        with pytest.raises(ContractValueError, match="derived from its typed key"):
            replace(manifest, partition=replace(manifest.partition, relative_path=path))


def test_manifest_lineage_rules_fail_closed() -> None:
    initial = _manifest()
    with pytest.raises(ContractValueError, match="INITIAL revision cannot have parents"):
        replace(initial, parent_revisions=(_parent(),))

    correction = _manifest(revision_id="r2", revision_kind=RevisionKind.CORRECTION)
    with pytest.raises(ContractValueError, match="exactly one parent"):
        replace(correction, parent_revisions=())
    with pytest.raises(ContractValueError, match="exactly one parent"):
        replace(correction, parent_revisions=(_parent(), _parent(revision_id="other")))
    with pytest.raises(ContractValueError, match="same dataset"):
        replace(correction, parent_revisions=(_parent(dataset_id="other"),))
    with pytest.raises(ContractValueError, match="parent itself"):
        replace(correction, parent_revisions=(_parent(revision_id="r2"),))
    with pytest.raises(ContractValueError, match="ParentRevisionV1"):
        replace(correction, parent_revisions=(object(),))  # type: ignore[arg-type]


def test_preserve_retention_class_cannot_declare_expiry() -> None:
    with pytest.raises(ContractValueError, match="cannot expire"):
        _partition_entry(retention_class=RetentionClass.PRESERVE, expires_at_ns=AS_OF_NS)


def test_retention_plan_is_pure_sorted_and_manifest_preserving() -> None:
    expired = _manifest(
        revision_id="z_expired",
        retention_class=RetentionClass.RAW_EXPIRABLE,
        expires_at_ns=AS_OF_NS,
    )
    future = _manifest(
        revision_id="b_future",
        retention_class=RetentionClass.DERIVED_REBUILDABLE,
        expires_at_ns=AS_OF_NS + 1,
    )
    preserve = _manifest(revision_id="a_preserve")
    inputs = (expired, future, preserve)

    first = plan_retention(
        inputs,
        as_of_ns=AS_OF_NS,
        deletion_permission_known=True,
        dependencies_preserved=True,
    )
    second = plan_retention(
        inputs,
        as_of_ns=AS_OF_NS,
        deletion_permission_known=True,
        dependencies_preserved=True,
    )

    assert first == second
    assert tuple(item.revision_id for item in first) == (
        "a_preserve",
        "b_future",
        "z_expired",
    )
    by_revision = {item.revision_id: item for item in first}
    assert by_revision["z_expired"].action is RetentionAction.EXPIRE_PAYLOAD_PRESERVE_MANIFEST
    assert by_revision["z_expired"].reason == (
        "DECLARED_EXPIRY_REACHED_WITH_PERMISSION_AND_PRESERVED_DEPENDENCIES"
    )
    assert by_revision["a_preserve"].reason == "PRESERVE_CLASS"
    assert by_revision["b_future"].reason == "EXPIRY_NOT_REACHED_OR_UNKNOWN"
    assert all(item.preserve_manifest and item.preserve_lineage for item in first)
    assert inputs == (expired, future, preserve)


@pytest.mark.parametrize(
    ("permission", "dependencies"),
    [(None, True), (False, True), (True, None), (True, False), (None, None)],
)
def test_retention_unknown_or_unproven_authority_fails_closed_to_retain(
    permission: bool | None,
    dependencies: bool | None,
) -> None:
    expired = _manifest(
        retention_class=RetentionClass.RAW_EXPIRABLE,
        expires_at_ns=AS_OF_NS - 1,
    )
    decision = plan_retention(
        (expired,),
        as_of_ns=AS_OF_NS,
        deletion_permission_known=permission,
        dependencies_preserved=dependencies,
    )[0]
    assert decision.action is RetentionAction.RETAIN
    assert decision.reason == "PERMISSION_OR_DEPENDENCY_STATE_NOT_PROVEN"


def test_retention_missing_expiry_is_unknown_and_retained() -> None:
    unknown = _manifest(retention_class=RetentionClass.RAW_EXPIRABLE)
    decision = plan_retention(
        (unknown,),
        as_of_ns=AS_OF_NS,
        deletion_permission_known=True,
        dependencies_preserved=True,
    )[0]
    assert decision.action is RetentionAction.RETAIN
    assert decision.reason == "EXPIRY_NOT_REACHED_OR_UNKNOWN"


@pytest.mark.parametrize("field_name", ["deletion_permission_known", "dependencies_preserved"])
@pytest.mark.parametrize("invalid", [0, 1, "true", object()])
def test_retention_rejects_non_boolean_tristate_inputs(field_name: str, invalid: object) -> None:
    kwargs: dict[str, object] = {
        "deletion_permission_known": True,
        "dependencies_preserved": True,
    }
    kwargs[field_name] = invalid
    with pytest.raises(ContractValueError):
        plan_retention(
            (_manifest(),),
            as_of_ns=AS_OF_NS,
            **kwargs,  # type: ignore[arg-type]
        )


def test_retention_rejects_invalid_time_manifest_types_and_duplicate_revisions() -> None:
    manifest = _manifest()
    for invalid_time in (True, UTC_NS_MIN - 1, UTC_NS_MAX + 1):
        with pytest.raises(ContractValueError):
            plan_retention(
                (manifest,),
                as_of_ns=invalid_time,
                deletion_permission_known=True,
                dependencies_preserved=True,
            )
    with pytest.raises(ContractValueError, match="DatasetRevisionManifestV1"):
        plan_retention(
            (object(),),  # type: ignore[arg-type]
            as_of_ns=AS_OF_NS,
            deletion_permission_known=True,
            dependencies_preserved=True,
        )
    with pytest.raises(ContractValueError, match="duplicate revision identities"):
        plan_retention(
            (manifest, manifest),
            as_of_ns=AS_OF_NS,
            deletion_permission_known=True,
            dependencies_preserved=True,
        )


def test_retention_requires_bounded_immutable_manifest_input() -> None:
    manifest = _manifest()
    with pytest.raises(ContractValueError, match="immutable tuple"):
        plan_retention(
            [manifest],  # type: ignore[arg-type]
            as_of_ns=AS_OF_NS,
            deletion_permission_known=True,
            dependencies_preserved=True,
        )
    with pytest.raises(ContractValueError, match="exceeds"):
        plan_retention(
            (manifest,) * (MAX_RETENTION_REVISIONS + 1),
            as_of_ns=AS_OF_NS,
            deletion_permission_known=True,
            dependencies_preserved=True,
        )


def test_retention_decision_cannot_contradict_preservation_or_identity() -> None:
    decision = plan_retention(
        (_manifest(),),
        as_of_ns=AS_OF_NS,
        deletion_permission_known=True,
        dependencies_preserved=True,
    )[0]

    def rebuild(**changes: object) -> RetentionDecisionV1:
        values: dict[str, object] = {
            "dataset_id": decision.dataset_id,
            "revision_id": decision.revision_id,
            "artifact_digest": decision.artifact_digest,
            "relative_payload_path": decision.relative_payload_path,
            "action": decision.action,
            "reason": decision.reason,
            "preserve_manifest": decision.preserve_manifest,
            "preserve_lineage": decision.preserve_lineage,
        }
        values.update(changes)
        return _derive_retention_decision(**values)  # type: ignore[arg-type]

    invalid_changes: tuple[dict[str, object], ...] = (
        {"dataset_id": ".."},
        {"revision_id": "bad/path"},
        {"artifact_digest": "0" * 64},
        {"relative_payload_path": 1},
        {"relative_payload_path": "../escape.parquet"},
        {
            "relative_payload_path": decision.relative_payload_path.replace(
                "/partitions/", "//partitions/"
            )
        },
        {"relative_payload_path": decision.relative_payload_path.replace("/partitions/", "/a/")},
        {
            "relative_payload_path": decision.relative_payload_path.replace(
                ".parquet", "/extra.parquet"
            )
        },
        {"relative_payload_path": decision.relative_payload_path.replace("/r1/", "/r2/")},
        {"action": "EXPIRE_PAYLOAD_PRESERVE_MANIFEST"},
        {"reason": "ARBITRARY_REASON"},
        {
            "action": RetentionAction.EXPIRE_PAYLOAD_PRESERVE_MANIFEST,
            "reason": "PRESERVE_CLASS",
        },
        {"preserve_manifest": False},
        {"preserve_lineage": False},
        {"preserve_manifest": 1},
    )
    for changes in invalid_changes:
        with pytest.raises(ContractValueError):
            rebuild(**changes)

    with pytest.raises(ContractValueError, match="engine-derived"):
        RetentionDecisionV1(
            dataset_id=decision.dataset_id,
            revision_id=decision.revision_id,
            artifact_digest=decision.artifact_digest,
            relative_payload_path=decision.relative_payload_path,
            action=decision.action,
            reason=decision.reason,
        )
