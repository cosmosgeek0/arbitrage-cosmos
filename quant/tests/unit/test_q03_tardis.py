from __future__ import annotations

import hashlib
from dataclasses import replace

import pytest

from quant_edge.bootstrap.tardis import (
    TardisHistoricalCapabilityInterfaceV1,
    build_tardis_capability_interface,
)
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def test_tardis_interface_is_canonical_reference_only_and_dependency_free() -> None:
    interface = build_tardis_capability_interface(source_card_digest=_digest("card"))
    parsed = parse_canonical_object(interface.canonical_bytes())

    assert parsed == interface.as_mapping()
    assert interface.sha256 == DigestV1(hashlib.sha256(interface.canonical_bytes()).hexdigest())
    assert parsed["accessState"] == "NOT_ACQUIRED"
    assert parsed["adapterState"] == "NOT_IMPLEMENTED"
    assert parsed["dependencyState"] == "NOT_INSTALLED"
    assert parsed["credentialState"] == "NOT_CONFIGURED"
    assert parsed["deliveryPosture"] == "INTERFACE_ONLY"
    assert "REFERENCE_ONLY_NO_ACQUISITION" in str(parsed)
    assert not hasattr(interface, "download")
    assert not hasattr(interface, "connect")


@pytest.mark.parametrize(
    "change",
    [
        {"source_card_digest": "bad"},
        {"document_digests": ()},
        {"document_digests": (object(), object(), object(), object())},
        {"document_digests": (_digest("x"),) * 4},
        {"products": ("BINANCE_SPOT",)},
        {"evidence_kinds": ("TRADE",)},
        {"known_limitations": ("NONE",)},
        {"access_state": "ACQUIRED"},
        {"adapter_state": "IMPLEMENTED"},
        {"dependency_state": "INSTALLED"},
        {"credential_state": "CONFIGURED"},
        {"delivery_posture": "LIVE"},
        {"authority": "ACQUISITION"},
    ],
)
def test_tardis_interface_rejects_implemented_or_mutable_claims(
    change: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(
            build_tardis_capability_interface(source_card_digest=_digest("card")),
            **change,  # type: ignore[arg-type]
        )


def test_tardis_interface_rejects_unordered_document_digests() -> None:
    interface = build_tardis_capability_interface(source_card_digest=_digest("card"))

    with pytest.raises(ContractValueError):
        TardisHistoricalCapabilityInterfaceV1(
            source_card_digest=interface.source_card_digest,
            document_digests=tuple(reversed(interface.document_digests)),
            products=interface.products,
            evidence_kinds=interface.evidence_kinds,
            known_limitations=interface.known_limitations,
        )
