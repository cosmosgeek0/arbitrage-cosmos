from __future__ import annotations

import hashlib
from dataclasses import replace
from typing import cast

import pytest

from quant_edge.bootstrap.campaign import (
    RealSampleCampaignEvidenceV1,
    render_campaign_markdown,
)
from quant_edge.bootstrap.coverage import ARCHIVE_GAP_COUNT_BASIS
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, TimestampUnit
from quant_edge.lake.governance import SourceGateCode


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _evidence() -> RealSampleCampaignEvidenceV1:
    return RealSampleCampaignEvidenceV1(
        archive_url="https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/BNBUSDT-aggTrades-2017-11-06.zip",
        sidecar_url="https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/BNBUSDT-aggTrades-2017-11-06.zip.CHECKSUM",
        source_card_digest=_digest("card"),
        source_review_failed_gates=(
            SourceGateCode.STABLE_IDENTITY_MAPPING,
            SourceGateCode.RETENTION_PERMISSION,
        ),
        retrieved_at_ns=1_783_814_400_000_000_000,
        archive_digest=_digest("archive"),
        sidecar_digest=_digest("sidecar"),
        member_digest=_digest("member"),
        official_checksum=_digest("archive"),
        member_name="BNBUSDT-aggTrades-2017-11-06.csv",
        archive_byte_count=12_440,
        member_byte_count=49_263,
        row_count=832,
        first_source_time_ns=1_509_940_463_590_000_000,
        last_source_time_ns=1_510_012_550_791_000_000,
        raw_timestamp_unit=TimestampUnit.MILLISECOND,
        invalid_row_count=0,
        duplicate_row_count=0,
        gap_count=0,
        schema_fingerprint=_digest("schema"),
        dependency_lock_digest=_digest("lock"),
        code_profile_digest=_digest("code"),
        config_digest=_digest("config"),
        dataset_id="binance_spot_aggtrades",
        revision_id="r_2de38a97c23e86d2",
        partition_digest=_digest("partition"),
        manifest_digest=_digest("manifest"),
        q02_schema_fingerprint=_digest("q02-schema"),
        validated_row_count=832,
        deterministic_replay_count=2,
        coverage_digest=_digest("coverage"),
        atlas_digest=_digest("atlas"),
        known_omissions=("BORROW_UNAVAILABLE", "L2_UNAVAILABLE", "RECEIVE_CLOCK_UNAVAILABLE"),
    )


def test_campaign_evidence_is_canonical_bounded_and_non_authoritative() -> None:
    evidence = _evidence()
    parsed = parse_canonical_object(evidence.canonical_bytes())
    import_record = cast(dict[str, object], parsed["import"])

    assert parsed == evidence.as_mapping()
    assert evidence.sha256 == DigestV1(hashlib.sha256(evidence.canonical_bytes()).hexdigest())
    assert parsed["rawExternalArtifactsCommitted"] is False
    assert parsed["rowLevelMarketDataCommitted"] is False
    assert import_record["gapCountBasis"] == ARCHIVE_GAP_COUNT_BASIS
    assert "REVIEW_ONLY_NO_ADMISSION" in str(parsed)
    markdown = render_campaign_markdown(evidence)
    assert markdown.endswith("\n")
    assert "MISSING/BLOCKED" in markdown
    assert "UNAVAILABLE" in markdown
    assert "Observed internal ID discontinuities" in markdown


@pytest.mark.parametrize(
    "change",
    [
        {"archive_url": object()},
        {"archive_url": " https://data.binance.vision/data/spot/daily/aggTrades/x.zip"},
        {"archive_url": "https://data.binance.vision/data/spot/daily/aggTrades/x.zip\x00"},
        {"archive_url": "http://data.binance.vision/data/spot/daily/aggTrades/x.zip"},
        {"archive_url": "https://example.com/data/spot/daily/aggTrades/x.zip"},
        {"archive_url": "https://user@data.binance.vision/data/spot/daily/aggTrades/x.zip"},
        {"archive_url": "https://user:pass@data.binance.vision/data/spot/daily/aggTrades/x.zip"},
        {"archive_url": "https://data.binance.vision:443/data/spot/daily/aggTrades/x.zip"},
        {"archive_url": "https://data.binance.vision/data/spot/daily/aggTrades/x.zip?q=1"},
        {"archive_url": "https://data.binance.vision/data/spot/daily/aggTrades/x.zip#x"},
        {"archive_url": "https://data.binance.vision/data/spot/daily/trades/x.zip"},
        {
            "archive_url": "https://data.binance.vision/data/spot/daily/aggTrades/x.csv",
            "sidecar_url": "https://data.binance.vision/data/spot/daily/aggTrades/x.csv.CHECKSUM",
        },
        {"sidecar_url": object()},
        {"sidecar_url": "https://data.binance.vision/data/spot/daily/aggTrades/x.zip.CHECKSUM"},
        {"member_name": "wrong.csv"},
        {"source_card_digest": "bad"},
        {"official_checksum": _digest("wrong")},
        {"source_review_failed_gates": ()},
        {"source_review_failed_gates": (SourceGateCode.RETENTION_PERMISSION,)},
        {
            "source_review_failed_gates": (
                SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
                SourceGateCode.STABLE_IDENTITY_MAPPING,
                SourceGateCode.RETENTION_PERMISSION,
            )
        },
        {
            "source_review_failed_gates": (
                SourceGateCode.RETENTION_PERMISSION,
                SourceGateCode.STABLE_IDENTITY_MAPPING,
            )
        },
        {"archive_byte_count": 0},
        {"member_byte_count": 67_108_865},
        {"row_count": 0},
        {"first_source_time_ns": 1_510_012_550_792_000_000},
        {"raw_timestamp_unit": "MILLISECOND"},
        {"invalid_row_count": -1},
        {"dataset_id": "../bad"},
        {"validated_row_count": 831},
        {"deterministic_replay_count": 1},
        {"known_omissions": []},
        {"known_omissions": ()},
        {"known_omissions": ("bad",)},
        {"known_omissions": ("L2_UNAVAILABLE", "L2_UNAVAILABLE")},
    ],
)
def test_campaign_evidence_rejects_ambiguous_or_false_green_states(
    change: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(_evidence(), **change)  # type: ignore[arg-type]


def test_campaign_markdown_rejects_untyped_input() -> None:
    with pytest.raises(ContractValueError):
        render_campaign_markdown(object())  # type: ignore[arg-type]
