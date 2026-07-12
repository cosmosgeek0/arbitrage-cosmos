from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

from quant_edge.canonical import parse_canonical_object
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    PartitionKeyV1,
    QualityFactsV1,
    QualityState,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
)
from quant_edge.lake.parquet import (
    SCHEMA_FINGERPRINT,
    WRITER_PROFILE_ID,
    PartitionBundleV1,
    RevisionBuildSpecV1,
    build_partition_bundle,
    validate_partition_bundle,
)

pytestmark = pytest.mark.contract

QUANT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = QUANT_ROOT / "fixtures" / "q02_partition_golden_v1.json"
LOCK_PATH = QUANT_ROOT / "uv.lock"


def _object(value: object, *, field: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise AssertionError(f"{field} must be an object")
    return value


def _array(value: object, *, field: str) -> list[object]:
    if not isinstance(value, list):
        raise AssertionError(f"{field} must be an array")
    return value


def _string(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise AssertionError(f"{field} must be a string")
    return value


def _integer(value: object, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise AssertionError(f"{field} must be an integer")
    return value


def _optional_integer(value: object, *, field: str) -> int | None:
    if value is None:
        return None
    return _integer(value, field=field)


def _boolean(value: object, *, field: str) -> bool:
    if not isinstance(value, bool):
        raise AssertionError(f"{field} must be boolean")
    return value


def _timestamp(value: object, *, field: str) -> RawTimestampV1 | None:
    if value is None:
        return None
    raw = _object(value, field=field)
    return RawTimestampV1(
        raw=_integer(raw.get("raw"), field=f"{field}.raw"),
        unit=TimestampUnit(_string(raw.get("unit"), field=f"{field}.unit")),
        basis=TimestampBasis(_string(raw.get("basis"), field=f"{field}.basis")),
    )


def _scaled(value: object, *, field: str) -> ExactScaledValueV1 | None:
    if value is None:
        return None
    raw = _object(value, field=field)
    return ExactScaledValueV1(
        coefficient=_integer(raw.get("coefficient"), field=f"{field}.coefficient"),
        scale=_integer(raw.get("scale"), field=f"{field}.scale"),
        unit_id=_string(raw.get("unitId"), field=f"{field}.unitId"),
    )


def _row(value: object) -> ReferenceMarketEvidenceRowV1:
    raw = _object(value, field="row")
    quality_raw = _object(raw.get("quality"), field="row.quality")
    reasons = tuple(
        _string(item, field="row.quality.reasonCodes[]")
        for item in _array(quality_raw.get("reasonCodes"), field="row.quality.reasonCodes")
    )
    event_time = _timestamp(raw.get("eventTime"), field="row.eventTime")
    if event_time is None:
        raise AssertionError("row.eventTime cannot be null")
    quality = derive_quality(
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
    )
    expected_quality_state = QualityState(
        _string(quality_raw.get("state"), field="row.quality.state")
    )
    if quality.state is not expected_quality_state:
        raise AssertionError("golden quality state is not engine-derived")
    if quality.reason_codes != reasons:
        raise AssertionError("golden quality reasons are not engine-derived")
    return ReferenceMarketEvidenceRowV1(
        record_id=_string(raw.get("recordId"), field="row.recordId"),
        source_id=_string(raw.get("sourceId"), field="row.sourceId"),
        source_endpoint=_string(raw.get("sourceEndpoint"), field="row.sourceEndpoint"),
        venue=_string(raw.get("venue"), field="row.venue"),
        product=_string(raw.get("product"), field="row.product"),
        event_kind=_string(raw.get("eventKind"), field="row.eventKind"),
        symbol=_string(raw.get("symbol"), field="row.symbol"),
        base_asset_id=_string(raw.get("baseAssetId"), field="row.baseAssetId"),
        quote_asset_id=_string(raw.get("quoteAssetId"), field="row.quoteAssetId"),
        instrument_version=_string(raw.get("instrumentVersion"), field="row.instrumentVersion"),
        stream_id=_string(raw.get("streamId"), field="row.streamId"),
        event_time=event_time,
        trade_time=_timestamp(raw.get("tradeTime"), field="row.tradeTime"),
        receive_wall_time=_timestamp(raw.get("receiveWallTime"), field="row.receiveWallTime"),
        receive_monotonic_ns=_optional_integer(
            raw.get("receiveMonotonicNs"), field="row.receiveMonotonicNs"
        ),
        normalization_time_ns=_integer(
            raw.get("normalizationTimeNs"), field="row.normalizationTimeNs"
        ),
        persistence_time_ns=_integer(raw.get("persistenceTimeNs"), field="row.persistenceTimeNs"),
        session_id=_string(raw.get("sessionId"), field="row.sessionId"),
        sequence_first=_optional_integer(raw.get("sequenceFirst"), field="row.sequenceFirst"),
        sequence_last=_optional_integer(raw.get("sequenceLast"), field="row.sequenceLast"),
        raw_payload_digest=DigestV1(
            _string(raw.get("rawPayloadSha256"), field="row.rawPayloadSha256")
        ),
        posture=EvidencePosture(_string(raw.get("posture"), field="row.posture")),
        duplicate=_boolean(raw.get("duplicate"), field="row.duplicate"),
        late=_boolean(raw.get("late"), field="row.late"),
        quality=quality,
        price=_scaled(raw.get("price"), field="row.price"),
        quantity=_scaled(raw.get("quantity"), field="row.quantity"),
    )


def _build_from_fixture() -> tuple[
    PartitionBundleV1,
    tuple[ReferenceMarketEvidenceRowV1, ...],
    dict[str, object],
]:
    fixture = parse_canonical_object(FIXTURE_PATH.read_bytes())
    if fixture.get("schema") != "Q02PartitionGoldenFixtureV1" or fixture.get("version") != 1:
        raise AssertionError("unsupported Q02 golden fixture")
    notice = _string(fixture.get("notice"), field="notice")
    if not notice.startswith("SYNTHETIC_ONLY:"):
        raise AssertionError("golden fixture must remain explicitly synthetic")
    expected = _object(fixture.get("expected"), field="expected")
    input_data = _object(fixture.get("input"), field="input")
    key_raw = _object(input_data.get("partitionKey"), field="input.partitionKey")
    revision_raw = _object(input_data.get("revision"), field="input.revision")
    rows = tuple(_row(item) for item in _array(input_data.get("rows"), field="input.rows"))
    key = PartitionKeyV1(
        schema_version=_string(key_raw.get("schemaVersion"), field="key.schemaVersion"),
        venue=_string(key_raw.get("venue"), field="key.venue"),
        product=_string(key_raw.get("product"), field="key.product"),
        event_kind=_string(key_raw.get("eventKind"), field="key.eventKind"),
        utc_date=_string(key_raw.get("utcDate"), field="key.utcDate"),
        symbol_shard=_string(key_raw.get("symbolShard"), field="key.symbolShard"),
    )
    revision = RevisionBuildSpecV1(
        dataset_id=_string(revision_raw.get("datasetId"), field="revision.datasetId"),
        revision_id=_string(revision_raw.get("revisionId"), field="revision.revisionId"),
        published_at_ns=_integer(revision_raw.get("publishedAtNs"), field="revision.publishedAtNs"),
        dependency_lock_digest=DigestV1(
            _string(
                revision_raw.get("dependencyLockSha256"),
                field="revision.dependencyLockSha256",
            )
        ),
        code_profile_digest=DigestV1(
            _string(revision_raw.get("codeProfileSha256"), field="revision.codeProfileSha256")
        ),
        config_digest=DigestV1(
            _string(revision_raw.get("configSha256"), field="revision.configSha256")
        ),
        producer_activity_id=_string(
            revision_raw.get("producerActivityId"), field="revision.producerActivityId"
        ),
        truth_posture=EvidencePosture(
            _string(revision_raw.get("truthPosture"), field="revision.truthPosture")
        ),
    )
    return build_partition_bundle(rows, key=key, revision=revision), rows, expected


def _golden_hashes_from_fixture() -> str:
    bundle, _rows, _expected = _build_from_fixture()
    return ":".join(
        (
            hashlib.sha256(bundle.partition_bytes).hexdigest(),
            hashlib.sha256(bundle.manifest_bytes).hexdigest(),
        )
    )


def test_golden_partition_bytes_and_exact_decode_match_frozen_contract() -> None:
    bundle, rows, expected = _build_from_fixture()
    expected_partition = _string(expected.get("partitionSha256"), field="partitionSha256")
    expected_manifest = _string(expected.get("manifestSha256"), field="manifestSha256")
    expected_schema = _string(
        expected.get("schemaFingerprintSha256"), field="schemaFingerprintSha256"
    )
    expected_writer = _string(expected.get("writerProfileId"), field="writerProfileId")
    expected_lock = _string(expected.get("dependencyLockSha256"), field="dependencyLockSha256")

    assert hashlib.sha256(bundle.partition_bytes).hexdigest() == expected_partition
    assert hashlib.sha256(bundle.manifest_bytes).hexdigest() == expected_manifest
    assert bundle.manifest.partition.artifact_digest == DigestV1(expected_partition)
    assert bundle.manifest.schema_fingerprint == SCHEMA_FINGERPRINT == DigestV1(expected_schema)
    assert bundle.manifest.writer_profile_id == WRITER_PROFILE_ID == expected_writer
    assert hashlib.sha256(LOCK_PATH.read_bytes()).hexdigest() == expected_lock
    assert bundle.manifest.dependency_lock_digest == DigestV1(expected_lock)

    validated = validate_partition_bundle(
        bundle.partition_bytes,
        bundle.manifest_bytes,
        expected_manifest_digest=DigestV1(expected_manifest),
    )
    assert validated.manifest == bundle.manifest
    assert validated.rows == rows
    assert tuple(row.price for row in validated.rows) == tuple(row.price for row in rows)
    assert tuple(row.quantity for row in validated.rows) == tuple(row.quantity for row in rows)


def test_golden_hashes_ignore_cwd_timezone_and_python_hash_seed(tmp_path: Path) -> None:
    expected = _golden_hashes_from_fixture()
    script = (
        "import runpy,sys; "
        "namespace=runpy.run_path(sys.argv[1]); "
        "print(namespace['_golden_hashes_from_fixture']())"
    )
    cases = (("UTC", "1"), ("Pacific/Kiritimati", "987654321"))
    observed: list[str] = []
    for index, (timezone, hash_seed) in enumerate(cases):
        cwd = tmp_path / f"isolated-{index}"
        cwd.mkdir()
        result = subprocess.run(
            [sys.executable, "-c", script, str(Path(__file__).resolve())],
            check=False,
            capture_output=True,
            text=True,
            cwd=cwd,
            env={
                "LANG": "C",
                "LC_ALL": "C",
                "PYTHONHASHSEED": hash_seed,
                "TZ": timezone,
            },
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        assert result.stderr == ""
        observed.append(result.stdout.strip())

    assert observed == [expected, expected]
