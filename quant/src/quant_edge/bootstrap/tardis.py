"""Reference-only Tardis historical capability interface; no client implementation."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from quant_edge.bootstrap.sources import (
    TARDIS_BINANCE_FUTURES_DOC_SHA256,
    TARDIS_BINANCE_SPOT_DOC_SHA256,
    TARDIS_DATA_FAQ_SHA256,
    TARDIS_TERMS_SHA256,
)
from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1


@dataclass(frozen=True, slots=True)
class TardisHistoricalCapabilityInterfaceV1:
    source_card_digest: DigestV1
    document_digests: tuple[DigestV1, ...]
    products: tuple[str, ...]
    evidence_kinds: tuple[str, ...]
    known_limitations: tuple[str, ...]
    access_state: str = "NOT_ACQUIRED"
    adapter_state: str = "NOT_IMPLEMENTED"
    dependency_state: str = "NOT_INSTALLED"
    credential_state: str = "NOT_CONFIGURED"
    delivery_posture: str = "INTERFACE_ONLY"
    authority: str = "REFERENCE_ONLY_NO_ACQUISITION"

    def __post_init__(self) -> None:
        if not isinstance(self.source_card_digest, DigestV1):
            raise ContractValueError("source_card_digest must be DigestV1")
        if not isinstance(self.document_digests, tuple) or len(self.document_digests) != 4:
            raise ContractValueError("Tardis interface requires four immutable document digests")
        if any(not isinstance(item, DigestV1) for item in self.document_digests):
            raise ContractValueError("document_digests must contain DigestV1")
        digest_text = tuple(item.hexdigest for item in self.document_digests)
        if digest_text != tuple(sorted(set(digest_text))):
            raise ContractValueError("document_digests must be sorted and unique")
        for field_name, expected_values in (
            ("products", ("BINANCE_SPOT", "BINANCE_USD_M")),
            ("evidence_kinds", ("DEPTH_DELTA", "DEPTH_SNAPSHOT", "TRADE")),
            (
                "known_limitations",
                (
                    "COLLECTOR_RESTART_GAPS_POSSIBLE",
                    "GENERATED_SNAPSHOTS",
                    "RAW_REDISTRIBUTION_RESTRICTED",
                ),
            ),
        ):
            value = getattr(self, field_name)
            if value != expected_values:
                raise ContractValueError(f"{field_name} must remain the exact Q03 interface set")
        for field_name, expected_state in (
            ("access_state", "NOT_ACQUIRED"),
            ("adapter_state", "NOT_IMPLEMENTED"),
            ("dependency_state", "NOT_INSTALLED"),
            ("credential_state", "NOT_CONFIGURED"),
            ("delivery_posture", "INTERFACE_ONLY"),
            ("authority", "REFERENCE_ONLY_NO_ACQUISITION"),
        ):
            if getattr(self, field_name) != expected_state:
                raise ContractValueError(f"{field_name} cannot claim an implemented capability")

    def as_mapping(self) -> dict[str, object]:
        return {
            "accessState": self.access_state,
            "adapterState": self.adapter_state,
            "authority": self.authority,
            "collectorTimestamp": "DOCUMENTED_INTERFACE_FIELD_ONLY",
            "credentialState": self.credential_state,
            "deliveryPosture": self.delivery_posture,
            "dependencyState": self.dependency_state,
            "documentSha256": [item.hexdigest for item in self.document_digests],
            "evidenceKinds": list(self.evidence_kinds),
            "knownLimitations": list(self.known_limitations),
            "products": list(self.products),
            "rawRedistribution": "PROHIBITED_WITH_LIMITED_AGGREGATED_EXCEPTIONS",
            "schema": "TardisHistoricalCapabilityInterfaceV1",
            "sourceCardSha256": self.source_card_digest.hexdigest,
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def sha256(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes()).hexdigest())


def build_tardis_capability_interface(
    *, source_card_digest: DigestV1
) -> TardisHistoricalCapabilityInterfaceV1:
    documents = tuple(
        sorted(
            (
                DigestV1(TARDIS_BINANCE_FUTURES_DOC_SHA256),
                DigestV1(TARDIS_BINANCE_SPOT_DOC_SHA256),
                DigestV1(TARDIS_DATA_FAQ_SHA256),
                DigestV1(TARDIS_TERMS_SHA256),
            ),
            key=lambda item: item.hexdigest,
        )
    )
    return TardisHistoricalCapabilityInterfaceV1(
        source_card_digest=source_card_digest,
        document_digests=documents,
        products=("BINANCE_SPOT", "BINANCE_USD_M"),
        evidence_kinds=("DEPTH_DELTA", "DEPTH_SNAPSHOT", "TRADE"),
        known_limitations=(
            "COLLECTOR_RESTART_GAPS_POSSIBLE",
            "GENERATED_SNAPSHOTS",
            "RAW_REDISTRIBUTION_RESTRICTED",
        ),
    )
