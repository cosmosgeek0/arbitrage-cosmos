from __future__ import annotations

import hashlib
from pathlib import Path
from typing import cast

from quant_edge.bootstrap.bridge import FORWARD_CAPTURE_SCHEMA_FINGERPRINT
from quant_edge.bootstrap.fixtures import build_q03_forward_fixture_set
from quant_edge.bootstrap.sources import BINANCE_ARCHIVE_SOURCE_ID, TARDIS_REFERENCE_SOURCE_ID
from quant_edge.bootstrap.tardis import build_tardis_capability_interface
from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.lake.contracts import DigestV1

QUANT_ROOT = Path(__file__).resolve().parents[2]
GENERATED = QUANT_ROOT / "generated" / "q03"
EXPECTED_ARTIFACTS = {
    "event_atlas.v1.json",
    "event_atlas.v1.md",
    "forward_fixtures.v1.json",
    "real_sample_campaign.v1.json",
    "real_sample_campaign.v1.md",
    "source_coverage.v1.json",
    "source_coverage.v1.md",
    "source_reviews.v1.json",
    "tardis_capability.v1.json",
}
CODE_PROFILE_PATHS = (
    "scripts/q03_real_sample.py",
    "src/quant_edge/bootstrap/archive.py",
    "src/quant_edge/bootstrap/atlas.py",
    "src/quant_edge/bootstrap/bridge.py",
    "src/quant_edge/bootstrap/campaign.py",
    "src/quant_edge/bootstrap/coverage.py",
    "src/quant_edge/bootstrap/fixtures.py",
    "src/quant_edge/bootstrap/sources.py",
    "src/quant_edge/bootstrap/tardis.py",
)


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return cast(dict[str, object], value)


def _array(value: object) -> list[object]:
    assert isinstance(value, list)
    return value


def test_generated_index_binds_every_hash_only_q03_artifact() -> None:
    index_path = GENERATED / "artifact_index.v1.json"
    index = parse_canonical_object(index_path.read_bytes())
    artifacts = _array(index["artifacts"])

    assert index["schema"] == "Q03GeneratedArtifactIndexV1"
    assert index["rawExternalArtifactsIncluded"] is False
    assert {path.name for path in GENERATED.iterdir()} == EXPECTED_ARTIFACTS | {
        "artifact_index.v1.json"
    }
    assert {str(_object(item)["name"]) for item in artifacts} == EXPECTED_ARTIFACTS
    for item in artifacts:
        record = _object(item)
        path = GENERATED / str(record["name"])
        raw = path.read_bytes()
        assert path.is_file()
        assert not path.is_symlink()
        assert record["byteCount"] == str(len(raw))
        assert record["sha256"] == hashlib.sha256(raw).hexdigest()
        if path.suffix == ".json":
            assert parse_canonical_object(raw)
        else:
            assert raw.endswith(b"\n")
            assert b"\r" not in raw


def test_real_sample_evidence_is_exact_and_contains_no_external_rows() -> None:
    campaign_raw = (GENERATED / "real_sample_campaign.v1.json").read_bytes()
    campaign = parse_canonical_object(campaign_raw)
    archive = _object(campaign["archive"])
    imported = _object(campaign["import"])
    lake = _object(campaign["lakeReplay"])
    review = _object(campaign["sourceReview"])

    assert campaign["authority"] == "RESEARCH_ONLY_NO_ADMISSION"
    assert archive["archiveSha256"] == (
        "2de38a97c23e86d2aafc4edabbd891646210a69a6194cb65d0ab9e8c88fda893"
    )
    assert archive["archiveSha256"] == archive["officialChecksumSha256"]
    assert archive["archiveByteCount"] == "12440"
    assert archive["memberByteCount"] == "49263"
    assert imported["rowCount"] == "832"
    assert imported["invalidRowCount"] == "0"
    assert imported["duplicateRowCount"] == "0"
    assert imported["gapCount"] == "0"
    assert imported["rawTimestampUnit"] == "MILLISECOND"
    assert lake["validatedRowCount"] == "832"
    assert lake["deterministicReplayCount"] == "2"
    assert lake["temporaryLakeState"] == "COMMITTED_THEN_DISPOSABLE"
    assert campaign["rawExternalArtifactsCommitted"] is False
    assert campaign["rowLevelMarketDataCommitted"] is False
    assert {"CAUSAL_INTENT_UNAVAILABLE", "LIVE_LATENCY_UNAVAILABLE"}.issubset(
        set(_array(campaign["knownOmissions"]))
    )
    assert review["status"] == "INELIGIBLE"
    assert review["authorityPosture"] == "REVIEW_ONLY_NO_ADMISSION"
    assert hashlib.sha256(campaign_raw).hexdigest() == (
        "553738c2a7c1aa42e314cc5c1acaab73a5a2db68b49844ef28e36ef7c3590529"
    )
    current_code_profile = hashlib.sha256(
        canonical_json_bytes(
            {
                path: hashlib.sha256((QUANT_ROOT / path).read_bytes()).hexdigest()
                for path in CODE_PROFILE_PATHS
            }
        )
    ).hexdigest()
    assert lake["codeProfileSha256"] == current_code_profile
    serialized = campaign_raw.lower()
    assert b'"rawrows"' not in serialized
    assert b'"csvbytes"' not in serialized
    assert b'"archivepayload"' not in serialized


def test_event_atlas_has_two_truthful_tiers_and_exact_bounded_inventory() -> None:
    atlas = parse_canonical_object((GENERATED / "event_atlas.v1.json").read_bytes())
    tiers = [_object(item) for item in _array(atlas["tiers"])]
    inventory = _object(atlas["inventory"])
    rules = [_object(item) for item in _array(atlas["rules"])]

    assert [tier["tier"] for tier in tiers] == [
        "HISTORICAL_COARSE",
        "FORWARD_HIGH_FIDELITY",
    ]
    assert tiers[0]["evidencePosture"] == "REAL_CHECKSUM_VERIFIED_ARCHIVE"
    assert tiers[0]["realCoverageStatus"] == "OBSERVED"
    assert tiers[1]["evidencePosture"] == "SYNTHETIC_CONTRACT_ONLY"
    assert tiers[1]["realCoverageStatus"] == "MISSING"
    assert tiers[1]["deliveryStatus"] == "BLOCKED"
    assert inventory["historicalRowCount"] == 832
    assert inventory["candidateCount"] == 20
    assert inventory["controlCount"] == 143
    assert inventory["invalidRowCount"] == 0
    assert inventory["knownGapCount"] == 0
    assert inventory["duplicateRowCount"] == 0
    assert len(_array(inventory["candidates"])) == 20
    assert len(_array(inventory["controls"])) == 143
    assert {rule["basis"] for rule in rules} == {
        "ABSOLUTE",
        "PREVIOUS_WINDOW_MAX",
        "PREVIOUS_WINDOW_MEAN",
    }
    assert atlas["laterOutcomesStatus"] == "UNAVAILABLE"
    assert atlas["ruleSemantics"] == "DISCOVERY_ONLY_NOT_EVENT_TRUTH"
    serialized = str(atlas).lower()
    for forbidden in ("p(bait)", "probability", "profitability", "actionability"):
        assert forbidden not in serialized


def test_forward_fixture_and_tardis_artifacts_match_pure_builders() -> None:
    fixture_raw = (GENERATED / "forward_fixtures.v1.json").read_bytes()
    fixtures = parse_canonical_object(fixture_raw)

    assert fixture_raw == build_q03_forward_fixture_set().canonical_bytes()
    assert fixtures["realMarketCoverage"] == "MISSING/BLOCKED"
    assert str(fixtures["notice"]).startswith("SYNTHETIC_ONLY:")

    reviews = parse_canonical_object((GENERATED / "source_reviews.v1.json").read_bytes())
    sources = [_object(item) for item in _array(reviews["sources"])]
    tardis_source = next(
        source
        for source in sources
        if _object(source["card"])["sourceId"] == TARDIS_REFERENCE_SOURCE_ID
    )
    tardis_card = _object(tardis_source["card"])
    card_digest = DigestV1(hashlib.sha256(canonical_json_bytes(tardis_card)).hexdigest())
    expected = build_tardis_capability_interface(source_card_digest=card_digest)
    tardis_raw = (GENERATED / "tardis_capability.v1.json").read_bytes()

    assert tardis_raw == expected.canonical_bytes()
    tardis = parse_canonical_object(tardis_raw)
    assert tardis["accessState"] == "NOT_ACQUIRED"
    assert tardis["adapterState"] == "NOT_IMPLEMENTED"
    assert tardis["dependencyState"] == "NOT_INSTALLED"
    assert tardis["credentialState"] == "NOT_CONFIGURED"
    assert tardis["deliveryPosture"] == "INTERFACE_ONLY"


def test_source_coverage_preserves_missingness_and_review_only_authority() -> None:
    coverage = parse_canonical_object((GENERATED / "source_coverage.v1.json").read_bytes())
    entries = [_object(item) for item in _array(coverage["entries"])]
    observed = entries[0]

    assert coverage["authorityPosture"] == "RESEARCH_EVIDENCE_ONLY"
    assert observed["availability"] == "OBSERVED"
    assert _object(observed["rowCount"])["value"] == "832"
    assert _object(observed["gapCount"])["value"] == "0"
    assert {"CAUSAL_INTENT_UNAVAILABLE", "LIVE_LATENCY_UNAVAILABLE"}.issubset(
        set(_array(observed["knownOmissions"]))
    )
    for missing in entries[1:]:
        assert missing["availability"] == "UNAVAILABLE"
        for field in ("rowCount", "gapCount", "invalidCount", "duplicateCount"):
            count = _object(missing[field])
            assert count["availability"] == "UNAVAILABLE"
            assert count["value"] is None

    reviews = parse_canonical_object((GENERATED / "source_reviews.v1.json").read_bytes())
    assert reviews["authorityPosture"] == "REVIEW_ONLY_NO_ADMISSION"
    for item in _array(reviews["sources"]):
        source = _object(item)
        review = _object(source["review"])
        assert review["authorityPosture"] == "REVIEW_ONLY_NO_ADMISSION"
        assert review["status"] == "INELIGIBLE"
        assert _array(review["failedGateCodes"])


def test_generated_cross_artifact_lineage_is_exact_and_current() -> None:
    campaign_raw = (GENERATED / "real_sample_campaign.v1.json").read_bytes()
    atlas_raw = (GENERATED / "event_atlas.v1.json").read_bytes()
    coverage_raw = (GENERATED / "source_coverage.v1.json").read_bytes()
    fixture_raw = (GENERATED / "forward_fixtures.v1.json").read_bytes()
    reviews_raw = (GENERATED / "source_reviews.v1.json").read_bytes()

    campaign = parse_canonical_object(campaign_raw)
    atlas = parse_canonical_object(atlas_raw)
    reviews = parse_canonical_object(reviews_raw)
    lake = _object(campaign["lakeReplay"])
    tiers = [_object(item) for item in _array(atlas["tiers"])]
    archive_source = next(
        _object(item)
        for item in _array(reviews["sources"])
        if _object(_object(item)["card"])["sourceId"] == BINANCE_ARCHIVE_SOURCE_ID
    )
    archive_card = _object(archive_source["card"])

    atlas_sha256 = hashlib.sha256(atlas_raw).hexdigest()
    coverage_sha256 = hashlib.sha256(coverage_raw).hexdigest()
    fixture_sha256 = hashlib.sha256(fixture_raw).hexdigest()
    archive_card_sha256 = hashlib.sha256(canonical_json_bytes(archive_card)).hexdigest()

    assert campaign["eventAtlasSha256"] == atlas_sha256
    assert campaign["sourceCoverageSha256"] == coverage_sha256
    assert campaign["sourceCardSha256"] == archive_card_sha256
    assert tiers[0]["coverageSha256"] == coverage_sha256
    assert tiers[0]["manifestSha256"] == lake["manifestSha256"]
    assert tiers[1]["coverageSha256"] == coverage_sha256
    assert tiers[1]["syntheticFixtureSha256"] == fixture_sha256
    assert tiers[1]["syntheticSchemaSha256"] == FORWARD_CAPTURE_SCHEMA_FINGERPRINT.hexdigest

    current_code_profile = hashlib.sha256(
        canonical_json_bytes(
            {
                path: hashlib.sha256((QUANT_ROOT / path).read_bytes()).hexdigest()
                for path in CODE_PROFILE_PATHS
            }
        )
    ).hexdigest()
    assert lake["codeProfileSha256"] == current_code_profile
