from __future__ import annotations

import hashlib
from dataclasses import replace

import pytest

from quant_edge.bootstrap.bridge import (
    FORWARD_CAPTURE_SCHEMA_FINGERPRINT,
    SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY,
    adapt_runtime_evidence_fixture,
)
from quant_edge.bootstrap.fixtures import ForwardFixtureSetV1, build_q03_forward_fixture_set
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1


def test_forward_fixture_set_is_canonical_two_product_synthetic_evidence() -> None:
    fixtures = build_q03_forward_fixture_set()
    parsed = parse_canonical_object(fixtures.canonical_bytes())

    assert parsed == fixtures.as_mapping()
    assert fixtures.sha256 == DigestV1(hashlib.sha256(fixtures.canonical_bytes()).hexdigest())
    assert parsed["realMarketCoverage"] == "MISSING/BLOCKED"
    assert str(parsed).count("SYNTHETIC") >= 4
    assert [item.evidence.kind for item in fixtures.envelopes] == [
        "BOOK_TICKER",
        "TRADE",
        "DEPTH_DELTA",
    ]
    book = fixtures.envelopes[0]
    assert book.runtime.source_event_time_ms is None
    assert book.runtime.source_transaction_time_ms is None
    assert book.partition_order_basis.value == "RECEIVE_WALL_TIME_AND_ORDINAL"
    depth = fixtures.envelopes[2]
    assert depth.usd_m_sequence is not None
    assert depth.usd_m_sequence.previous_update_last == "199"
    assert depth.quality.reason_codes == (
        "CAPTURE_DROP",
        "CONNECTION_RESTART",
        "SEQUENCE_GAP",
        "SYNTHETIC_FIXTURE_ONLY",
    )


def test_forward_fixture_set_replays_identically() -> None:
    first = build_q03_forward_fixture_set()
    second = build_q03_forward_fixture_set()

    assert first == second
    assert first.canonical_bytes() == second.canonical_bytes()
    assert first.sha256 == second.sha256


@pytest.mark.parametrize(
    "change",
    [
        {"envelopes": []},
        {"envelopes": ()},
        {"envelopes": (object(), object(), object())},
        {"envelopes": tuple(reversed(build_q03_forward_fixture_set().envelopes))},
        {
            "envelopes": (
                build_q03_forward_fixture_set().envelopes[0],
                build_q03_forward_fixture_set().envelopes[0],
                build_q03_forward_fixture_set().envelopes[2],
            )
        },
        {"schema_fingerprint": DigestV1("0" * 64)},
        {"compatibility": object()},
    ],
)
def test_forward_fixture_set_rejects_mutable_incomplete_or_forged_sets(
    change: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(build_q03_forward_fixture_set(), **change)  # type: ignore[arg-type]


def test_unsupported_payload_family_fails_before_fixture_set_construction() -> None:
    depth = build_q03_forward_fixture_set().envelopes[2]

    with pytest.raises(ContractValueError, match="unsupported Q03 payload schema"):
        replace(depth, evidence=replace(depth.evidence, kind="MARK_PRICE"))


def test_fixture_set_rejects_unique_supported_envelopes_with_wrong_family_inventory() -> None:
    book, trade, _depth = build_q03_forward_fixture_set().envelopes
    duplicate_trade = adapt_runtime_evidence_fixture(
        trade.runtime,
        trade.evidence,
        replace(trade.sidecar, receive_ordinal=trade.sidecar.receive_ordinal + 1),
        raw_payload_bytes=b"second-supported-trade-raw",
        normalized_evidence_bytes=b"second-supported-trade-normalized",
    )
    wrong_families = (book, trade, duplicate_trade)

    assert tuple(item.canonical_order_key for item in wrong_families) == tuple(
        sorted(item.canonical_order_key for item in wrong_families)
    )
    with pytest.raises(ContractValueError, match="fixed Q03 product/event set"):
        ForwardFixtureSetV1(envelopes=wrong_families)


def test_fixture_defaults_bind_exact_bridge_contracts() -> None:
    fixture_set = ForwardFixtureSetV1(envelopes=build_q03_forward_fixture_set().envelopes)

    assert fixture_set.schema_fingerprint == FORWARD_CAPTURE_SCHEMA_FINGERPRINT
    assert fixture_set.compatibility == SPOT_BOOK_TICKER_BRIDGE_COMPATIBILITY
