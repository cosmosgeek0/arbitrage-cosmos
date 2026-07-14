from __future__ import annotations

import copy
import hashlib
from typing import cast

import pytest
from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import CanonicalJsonError, ContractValueError
from quant_edge.lake.contracts import (
    MAX_DECIMAL_COEFFICIENT,
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    PartitionKeyV1,
    QualityFactsV1,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
)
from quant_edge.lake.manifest import DatasetRevisionManifestV1
from quant_edge.lake.parquet import RevisionBuildSpecV1, build_partition_bundle

BASE_TIME_MS = 1_783_814_400_000
BASE_TIME_NS = BASE_TIME_MS * 1_000_000
TIMESTAMP_MULTIPLIERS: dict[TimestampUnit, int] = {
    TimestampUnit.MILLISECOND: 1_000_000,
    TimestampUnit.MICROSECOND: 1_000,
    TimestampUnit.NANOSECOND: 1,
}
ALL_ROW_INDICES = (0, 1, 2, 3, 4)


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _synthetic_row(index: int) -> ReferenceMarketEvidenceRowV1:
    event_time_ms = BASE_TIME_MS + index
    receive_time_ms = event_time_ms + 100
    return ReferenceMarketEvidenceRowV1(
        record_id=f"row-{index}",
        source_id="q02-fixture",
        source_endpoint="synthetic",
        venue="fixture",
        product="spot",
        event_kind="trade",
        symbol="BTCUSDT",
        base_asset_id="BTC",
        quote_asset_id="USDT",
        instrument_version="v1",
        stream_id="trade-stream",
        event_time=RawTimestampV1(
            raw=event_time_ms,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
        ),
        trade_time=None,
        receive_wall_time=RawTimestampV1(
            raw=receive_time_ms,
            unit=TimestampUnit.MILLISECOND,
            basis=TimestampBasis.DECLARED,
        ),
        receive_monotonic_ns=10_000 + index,
        normalization_time_ns=(event_time_ms + 200) * 1_000_000,
        persistence_time_ns=(event_time_ms + 300) * 1_000_000,
        session_id="session-1",
        sequence_first=index,
        sequence_last=index,
        raw_payload_digest=_digest(f"payload-{index}"),
        posture=EvidencePosture.SYNTHETIC,
        duplicate=False,
        late=False,
        quality=derive_quality(
            QualityFactsV1(
                available=True,
                synthetic=True,
                gap=False,
                stale=False,
                reconstructing=False,
                sampled=False,
                partial=False,
                complete_proven=False,
            )
        ),
        price=ExactScaledValueV1(coefficient=100_000 + index, scale=2, unit_id="USDT"),
        quantity=ExactScaledValueV1(coefficient=1_000 + index, scale=3, unit_id="BTC"),
    )


def _partition_key() -> PartitionKeyV1:
    return PartitionKeyV1(
        schema_version="v1",
        venue="fixture",
        product="spot",
        event_kind="trade",
        utc_date="2026-07-12",
        symbol_shard="BTCUSDT",
    )


def _revision() -> RevisionBuildSpecV1:
    return RevisionBuildSpecV1(
        dataset_id="q02-fixture",
        revision_id="r1",
        published_at_ns=BASE_TIME_NS + 1_000_000_000,
        dependency_lock_digest=_digest("dependency-lock"),
        code_profile_digest=_digest("code-profile"),
        config_digest=_digest("config"),
        producer_activity_id="q02.property-test",
        truth_posture=EvidencePosture.SYNTHETIC,
    )


@settings(max_examples=32, deadline=None)
@seed(20260712)
@given(
    coefficient=st.one_of(
        st.sampled_from((-MAX_DECIMAL_COEFFICIENT, MAX_DECIMAL_COEFFICIENT)),
        st.integers(
            min_value=-MAX_DECIMAL_COEFFICIENT,
            max_value=MAX_DECIMAL_COEFFICIENT,
        ),
    ),
    scale=st.one_of(st.sampled_from((0, 38)), st.integers(min_value=0, max_value=38)),
)
def test_exact_scaled_value_preserves_every_accepted_integer(
    coefficient: int,
    scale: int,
) -> None:
    value = ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")

    assert value.coefficient == coefficient
    assert value.scale == scale


@settings(max_examples=8, deadline=None)
@seed(20260712)
@given(
    coefficient=st.sampled_from((-MAX_DECIMAL_COEFFICIENT - 1, MAX_DECIMAL_COEFFICIENT + 1)),
    scale=st.integers(min_value=0, max_value=38),
)
def test_exact_scaled_value_rejects_coefficients_just_beyond_bounds(
    coefficient: int,
    scale: int,
) -> None:
    with pytest.raises(ContractValueError):
        ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


@settings(max_examples=8, deadline=None)
@seed(20260712)
@given(
    coefficient=st.integers(
        min_value=-MAX_DECIMAL_COEFFICIENT,
        max_value=MAX_DECIMAL_COEFFICIENT,
    ),
    scale=st.sampled_from((-1, 39)),
)
def test_exact_scaled_value_rejects_scales_just_beyond_bounds(
    coefficient: int,
    scale: int,
) -> None:
    with pytest.raises(ContractValueError):
        ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


@settings(max_examples=32, deadline=None)
@seed(20260712)
@given(
    unit=st.sampled_from(tuple(TimestampUnit)),
    offset=st.integers(min_value=0, max_value=10**18),
    basis=st.sampled_from(tuple(TimestampBasis)),
)
def test_raw_timestamp_normalization_is_exact_and_unit_lossless(
    unit: TimestampUnit,
    offset: int,
    basis: TimestampBasis,
) -> None:
    multiplier = TIMESTAMP_MULTIPLIERS[unit]
    minimum_raw = (UTC_NS_MIN + multiplier - 1) // multiplier
    maximum_raw = UTC_NS_MAX // multiplier
    raw = minimum_raw + offset % (maximum_raw - minimum_raw + 1)

    timestamp = RawTimestampV1(raw=raw, unit=unit, basis=basis)

    assert timestamp.raw == raw
    assert timestamp.unit is unit
    assert timestamp.basis is basis
    assert timestamp.normalized_ns == raw * multiplier
    assert timestamp.normalized_ns % multiplier == 0


@settings(max_examples=12, deadline=None)
@seed(20260712)
@given(
    row_count=st.sampled_from((2, 3, 4, 5)),
    permutation=st.permutations(ALL_ROW_INDICES),
)
def test_partition_and_manifest_bytes_are_invariant_to_input_permutation(
    row_count: int,
    permutation: list[int],
) -> None:
    rows = tuple(_synthetic_row(index) for index in range(row_count))
    order = tuple(index for index in permutation if index < row_count)
    permuted_rows = tuple(rows[index] for index in order)

    canonical = build_partition_bundle(rows, key=_partition_key(), revision=_revision())
    permuted = build_partition_bundle(
        permuted_rows,
        key=_partition_key(),
        revision=_revision(),
    )

    assert permuted.partition_bytes == canonical.partition_bytes
    assert permuted.manifest_bytes == canonical.manifest_bytes
    assert permuted.expected_manifest_digest == canonical.expected_manifest_digest


@settings(max_examples=12, deadline=None)
@seed(20260712)
@given(
    mutation=st.sampled_from(
        (
            "bad-artifact-digest",
            "bad-decimal-integer",
            "bad-derived-path",
            "bad-manifest-id",
            "extra-core-key",
            "extra-envelope-key",
            "missing-envelope-key",
            "noncanonical-whitespace",
            "unsupported-schema",
            "unsupported-version",
        )
    )
)
def test_manifest_parser_rejects_canonical_and_envelope_mutations(mutation: str) -> None:
    bundle = build_partition_bundle(
        tuple(_synthetic_row(index) for index in range(2)),
        key=_partition_key(),
        revision=_revision(),
    )
    envelope = copy.deepcopy(parse_canonical_object(bundle.manifest_bytes))
    core = cast(dict[str, object], envelope["core"])
    partition = cast(dict[str, object], core["partition"])
    raw: bytes

    if mutation == "bad-artifact-digest":
        partition["artifactSha256"] = "F" * 64
    elif mutation == "bad-decimal-integer":
        partition["rowCount"] = "02"
    elif mutation == "bad-derived-path":
        partition["relativePath"] = "../escape.parquet"
    elif mutation == "bad-manifest-id":
        envelope["manifestId"] = "0" * 64
    elif mutation == "extra-core-key":
        core["unexpected"] = "value"
    elif mutation == "extra-envelope-key":
        envelope["unexpected"] = "value"
    elif mutation == "missing-envelope-key":
        del envelope["schema"]
    elif mutation == "noncanonical-whitespace":
        raw = bundle.manifest_bytes[:-1] + b" \n"
        with pytest.raises(CanonicalJsonError):
            DatasetRevisionManifestV1.from_bytes(raw)
        return
    elif mutation == "unsupported-schema":
        envelope["schema"] = "DatasetRevisionManifestV2"
    elif mutation == "unsupported-version":
        envelope["version"] = 2
    else:
        raise AssertionError(f"unhandled mutation: {mutation}")

    if mutation in {
        "bad-artifact-digest",
        "bad-decimal-integer",
        "bad-derived-path",
        "extra-core-key",
    }:
        envelope["manifestId"] = hashlib.sha256(canonical_json_bytes(core)).hexdigest()
    raw = canonical_json_bytes(envelope)

    with pytest.raises(CanonicalJsonError):
        DatasetRevisionManifestV1.from_bytes(raw)
