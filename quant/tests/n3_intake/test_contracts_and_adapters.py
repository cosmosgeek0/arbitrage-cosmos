from __future__ import annotations

import hashlib
from copy import deepcopy
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import CanonicalJsonError, ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.n3_intake.adapters import adapt_registry, adapt_result
from quant_edge.n3_intake.canonical import semantic_digest
from quant_edge.n3_intake.contracts import (
    PACKET_ROLE_ORDER,
    AcceptanceState,
    ArtifactPinV1,
    ArtifactRole,
    GitOidV1,
    MetricState,
    PacketRole,
    PinnedDocumentV1,
)
from quant_edge.n3_intake.decision import assess_candidate

JsonObject = dict[str, object]

BASE_COMMIT = "1" * 40
PRODUCER_COMMIT = "2" * 40
PRODUCER_TREE = "3" * 40
OTHER_COMMIT = "4" * 40
OTHER_TREE = "5" * 40
ACCEPTANCE_SHA256 = "a" * 64
REGISTRY_ID = "s-meta1-n3-v1"

RESULT_SPEC = {
    PacketRole.E1: ("E1_N3_RESULT_V1", "E-1"),
    PacketRole.VE1: ("VE1_N3_RESULT_V1", "V-E1"),
    PacketRole.S1C: ("S1C_N3_RESULT_V1", "S-1C"),
    PacketRole.S1D: ("S1D_N3_RESULT_V1", "S-1D"),
    PacketRole.S1E: ("S1E_N3_RESULT_V1", "S-1E"),
}
LEDGER_BY_ROLE = {role: f"{index + 1:x}" * 64 for index, role in enumerate(PACKET_ROLE_ORDER)}
TRIAL_COUNT_BY_ROLE = {role: index + 1 for index, role in enumerate(PACKET_ROLE_ORDER)}


def _mapping(value: object) -> JsonObject:
    assert isinstance(value, dict)
    return cast(JsonObject, value)


def _metric(state: str = "MEASURED", value: int | None = 1) -> JsonObject:
    return {"state": state, "value": value}


def _policy() -> JsonObject:
    return {
        "actualFeeRequired": True,
        "makerEntryRequired": True,
        "pboRequired": True,
        "globalTestRequired": True,
        "dsrRequired": True,
        "requiredEvidenceClass": "SEALED_FORWARD",
        "minimumNetMicrousdPer1000": 1,
        "minimumHoldoutLowerBoundMicrousdPer1000": 1,
        "minimumStressNetMicrousdPer1000": 1,
        "minimumCapacityUsd": 1,
        "maximumDrawdownBps": 4_000,
    }


def _registry_body() -> JsonObject:
    return {
        "schema": "S_META1_N3_REGISTRY_V1",
        "version": 1,
        "registryId": REGISTRY_ID,
        "baseCommit": BASE_COMMIT,
        "families": [
            {
                "familyId": f"family-{role.value.lower()}",
                "packetRole": role.value,
                "trialCount": TRIAL_COUNT_BY_ROLE[role],
                "candidateIds": [
                    f"candidate-{role.value.lower()}",
                    *[
                        f"candidate-{role.value.lower()}-{index:03d}"
                        for index in range(1, TRIAL_COUNT_BY_ROLE[role])
                    ],
                ],
                "trialLedgerSha256": LEDGER_BY_ROLE[role],
                "multiplicityMethod": "HOLM_BONFERRONI",
                "alphaNumerator": 1,
                "alphaDenominator": 40,
                "policy": _policy(),
            }
            for role in PACKET_ROLE_ORDER
        ],
    }


def _result_body(
    role: PacketRole,
    *,
    registry_sha256: str = "b" * 64,
) -> JsonObject:
    schema, milestone = RESULT_SPEC[role]
    trial_count = TRIAL_COUNT_BY_ROLE[role]
    return {
        "schema": schema,
        "version": 1,
        "packetRole": role.value,
        "milestone": milestone,
        "registryId": REGISTRY_ID,
        "registrySha256": registry_sha256,
        "familyId": f"family-{role.value.lower()}",
        "candidateId": f"candidate-{role.value.lower()}",
        "terminalState": "PASS",
        "provenance": {
            "baseCommit": BASE_COMMIT,
            "producerCommit": PRODUCER_COMMIT,
            "producerTree": PRODUCER_TREE,
            "sourceArtifactSha256": [
                LEDGER_BY_ROLE[role],
                "6" * 64,
                "7" * 64,
            ],
        },
        "trials": {
            "declaredCount": trial_count,
            "observedCount": trial_count,
            "ledgerSha256": LEDGER_BY_ROLE[role],
            "multiplicityMethod": "HOLM_BONFERRONI",
            "multiplicityState": "PASS",
            "pboState": "PASS",
            "globalTestState": "PASS",
            "dsrState": "PASS",
        },
        "holdout": {
            "evidenceClass": "SEALED_FORWARD",
            "state": "PASS",
            "singleUse": True,
            "openedAfterFreeze": True,
            "selectionInsideEvaluation": True,
            "reuseCount": 1,
            "lowerBound": _metric(),
        },
        "economics": {
            "net": _metric(),
            "stressNet": _metric(),
            "capacityUsd": _metric(value=1_000),
            "maxDrawdownBps": _metric(value=1_000),
            "actualFeeState": "PASS",
            "costCompleteState": "PASS",
            "makerEntryState": "PASS",
            "regimeCoverageState": "PASS",
        },
        "reasonCodes": [],
    }


def _document(
    body: JsonObject,
    role: ArtifactRole,
    *,
    producer_commit: str = PRODUCER_COMMIT,
    producer_tree: str = PRODUCER_TREE,
    raw_sha256: str | None = None,
) -> PinnedDocumentV1:
    raw = canonical_json_bytes(body)
    observed_sha256 = hashlib.sha256(raw).hexdigest()
    return PinnedDocumentV1(
        pin=ArtifactPinV1(
            role=role,
            raw_sha256=DigestV1(observed_sha256 if raw_sha256 is None else raw_sha256),
            byte_length=len(raw),
            producer_commit=GitOidV1(producer_commit),
            producer_tree=GitOidV1(producer_tree),
            relative_path=f"quant/fixtures/n3/{role.value.lower()}.json",
            acceptance=AcceptanceState.ACCEPTED,
            acceptance_sha256=DigestV1(ACCEPTANCE_SHA256),
        ),
        raw=raw,
    )


def _result_document(
    body: JsonObject,
    role: PacketRole,
    **pin_overrides: str,
) -> PinnedDocumentV1:
    return _document(
        body,
        ArtifactRole(role.value),
        **pin_overrides,
    )


def _reversed_mappings(value: object) -> object:
    if isinstance(value, dict):
        return {key: _reversed_mappings(item) for key, item in reversed(tuple(value.items()))}
    if isinstance(value, list):
        return [_reversed_mappings(item) for item in value]
    return value


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("schema", "result role E1 requires schema"),
        ("version", "result.version"),
        ("extra", "key mismatch"),
        ("missing", "key mismatch"),
        ("bool-int", "declaredCount must be an integer"),
    ],
)
def test_result_adapter_rejects_schema_version_key_and_bool_int_drift(
    mutation: str,
    expected: str,
) -> None:
    body = _result_body(PacketRole.E1)
    if mutation == "schema":
        body["schema"] = "E1_N3_RESULT_V2"
    elif mutation == "version":
        body["version"] = 2
    elif mutation == "extra":
        body["extra"] = True
    elif mutation == "missing":
        del body["candidateId"]
    else:
        _mapping(body["trials"])["declaredCount"] = True

    with pytest.raises(
        (CanonicalJsonError, ContractValueError),
        match=expected,
    ):
        adapt_result(_result_document(body, PacketRole.E1))


def test_canonical_raw_hash_mismatch_is_rejected_before_adaptation() -> None:
    body = _result_body(PacketRole.E1)
    document = _result_document(
        body,
        PacketRole.E1,
        raw_sha256="0" * 64,
    )

    with pytest.raises(ContractValueError, match="raw SHA-256"):
        adapt_result(document)


@pytest.mark.parametrize(
    ("pin_field", "pin_value", "expected"),
    [
        ("producer_commit", OTHER_COMMIT, "producerCommit does not match"),
        ("producer_tree", OTHER_TREE, "producerTree does not match"),
    ],
)
def test_declared_producer_identity_must_match_independent_pin(
    pin_field: str,
    pin_value: str,
    expected: str,
) -> None:
    body = _result_body(PacketRole.E1)

    with pytest.raises(ContractValueError, match=expected):
        adapt_result(
            _result_document(
                body,
                PacketRole.E1,
                **{pin_field: pin_value},
            )
        )


@pytest.mark.parametrize(
    ("role", "schema", "milestone"),
    [(role, *RESULT_SPEC[role]) for role in PACKET_ROLE_ORDER],
)
def test_all_five_result_schema_role_pairs_are_exact(
    role: PacketRole,
    schema: str,
    milestone: str,
) -> None:
    body = _result_body(role)
    packet = adapt_result(_result_document(body, role))

    assert packet.role is role
    assert packet.schema == schema
    assert packet.milestone == milestone
    assert packet.semantic_sha256 == semantic_digest(f"RESULT:{role.value}", body)

    wrong_body = deepcopy(body)
    wrong_body["schema"] = next(
        other_schema
        for other_role, (other_schema, _) in RESULT_SPEC.items()
        if other_role is not role
    )
    with pytest.raises(ContractValueError, match=f"result role {role.value} requires"):
        adapt_result(_result_document(wrong_body, role))

    wrong_pin_role = next(other for other in PACKET_ROLE_ORDER if other is not role)
    with pytest.raises(ContractValueError, match="packetRole does not match"):
        adapt_result(_result_document(body, wrong_pin_role))


def test_missing_null_and_numeric_zero_remain_distinct() -> None:
    missing = _result_body(PacketRole.E1)
    del _mapping(_mapping(missing["economics"])["net"])["value"]
    with pytest.raises(CanonicalJsonError, match="key mismatch"):
        adapt_result(_result_document(missing, PacketRole.E1))

    unknown = _result_body(PacketRole.E1)
    _mapping(unknown["economics"])["net"] = _metric("UNKNOWN", None)
    unknown_packet = adapt_result(_result_document(unknown, PacketRole.E1))
    assert unknown_packet.economics.net.state is MetricState.UNKNOWN
    assert unknown_packet.economics.net.value is None

    measured_zero = _result_body(PacketRole.E1)
    _mapping(measured_zero["economics"])["net"] = _metric("MEASURED", 0)
    zero_packet = adapt_result(_result_document(measured_zero, PacketRole.E1))
    assert zero_packet.economics.net.state is MetricState.MEASURED
    assert zero_packet.economics.net.value == 0

    unknown_zero = _result_body(PacketRole.E1)
    _mapping(unknown_zero["economics"])["net"] = _metric("UNKNOWN", 0)
    with pytest.raises(ContractValueError, match="must be null"):
        adapt_result(_result_document(unknown_zero, PacketRole.E1))

    measured_null = _result_body(PacketRole.E1)
    _mapping(measured_null["economics"])["net"] = _metric("MEASURED", None)
    with pytest.raises(ContractValueError, match="must be an integer"):
        adapt_result(_result_document(measured_null, PacketRole.E1))


def test_observed_trial_count_cannot_exceed_declared_count() -> None:
    body = _result_body(PacketRole.E1)
    trials = _mapping(body["trials"])
    trials["declaredCount"] = 2
    trials["observedCount"] = 3

    with pytest.raises(ContractValueError, match="cannot exceed declared_count"):
        adapt_result(_result_document(body, PacketRole.E1))


def test_registry_trial_and_ledger_mismatch_reach_bound_decision_as_invalid() -> None:
    registry_body = _registry_body()
    registry = adapt_registry(_document(registry_body, ArtifactRole.S_META1))
    assert tuple(family.packet_role for family in registry.families) == PACKET_ROLE_ORDER

    family = next(item for item in registry.families if item.packet_role is PacketRole.E1)
    body = _result_body(PacketRole.E1, registry_sha256=registry.raw_sha256.hexdigest)
    trials = _mapping(body["trials"])
    trials["declaredCount"] = family.trial_count + 2
    trials["observedCount"] = family.trial_count
    trials["ledgerSha256"] = "f" * 64

    packet = adapt_result(_result_document(body, PacketRole.E1))
    assert packet.trials.declared_count == family.trial_count + 2
    assert packet.trials.observed_count == family.trial_count
    assert packet.trials.ledger_sha256 != family.trial_ledger_sha256

    with pytest.raises(ContractValueError, match="declared trial count"):
        assess_candidate(registry, family, packet)

    ledger_only_body = _result_body(
        PacketRole.E1,
        registry_sha256=registry.raw_sha256.hexdigest,
    )
    _mapping(ledger_only_body["trials"])["ledgerSha256"] = "f" * 64
    ledger_only_packet = adapt_result(_result_document(ledger_only_body, PacketRole.E1))
    assert ledger_only_packet.trials.ledger_sha256 != family.trial_ledger_sha256
    with pytest.raises(ContractValueError, match="trial ledger"):
        assess_candidate(registry, family, ledger_only_packet)


def test_semantic_digest_is_stable_under_mapping_insertion_permutations() -> None:
    cases = [("REGISTRY:S_META1", _registry_body())]
    cases.extend((f"RESULT:{role.value}", _result_body(role)) for role in PACKET_ROLE_ORDER)

    for domain, body in cases:
        permuted = _reversed_mappings(body)
        assert isinstance(permuted, dict)
        assert tuple(permuted) == tuple(reversed(tuple(body)))
        assert semantic_digest(domain, body) == semantic_digest(domain, permuted)
        assert canonical_json_bytes(body) == canonical_json_bytes(permuted)
