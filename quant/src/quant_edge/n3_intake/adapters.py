"""Strict wire adapters for frozen S-META1 and N3 result packets."""

from __future__ import annotations

from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import require_strict_int
from quant_edge.n3_intake.canonical import (
    parse_document,
    require_bool_or_none,
    require_dict,
    require_digest,
    require_git_oid,
    require_int_or_none,
    require_keys,
    require_list,
    require_str,
    semantic_digest,
)
from quant_edge.n3_intake.contracts import (
    MAX_FAMILIES,
    MAX_REASONS,
    MAX_SOURCE_ARTIFACTS,
    MAX_TRIALS,
    ArtifactRole,
    EconomicEvidenceV1,
    EvidenceClass,
    GatePolicyV1,
    GateState,
    GitOidV1,
    HoldoutEvidenceV1,
    MetricState,
    MetricV1,
    PacketRole,
    PinnedDocumentV1,
    ProvenanceV1,
    RegistryFamilyV1,
    RegistryV1,
    ResultPacketV1,
    TrialEvidenceV1,
)

_REGISTRY_SCHEMA: Final = "S_META1_N3_REGISTRY_V1"
_RESULT_SPEC: Final = {
    PacketRole.E1: ("E1_N3_RESULT_V1", "E-1"),
    PacketRole.VE1: ("VE1_N3_RESULT_V1", "V-E1"),
    PacketRole.S1C: ("S1C_N3_RESULT_V1", "S-1C"),
    PacketRole.S1D: ("S1D_N3_RESULT_V1", "S-1D"),
    PacketRole.S1E: ("S1E_N3_RESULT_V1", "S-1E"),
}


def _enum[EnumT: StrEnum](enum_type: type[EnumT], value: object, *, field: str) -> EnumT:
    text = require_str(value, field=field)
    try:
        return enum_type(text)
    except ValueError as error:
        raise ContractValueError(f"{field} has an unsupported value") from error


def _bool(value: object, *, field: str) -> bool:
    parsed = require_bool_or_none(value, field=field)
    if parsed is None:
        raise ContractValueError(f"{field} must be boolean")
    return parsed


def _version(value: object, *, field: str) -> None:
    require_strict_int(value, field=field, minimum=1, maximum=1)


def _git_oid(value: object, *, field: str) -> GitOidV1:
    return GitOidV1(require_git_oid(value, field=field))


def _metric(value: object, *, field: str) -> MetricV1:
    body = require_dict(value, field=field)
    require_keys(body, expected=("state", "value"), field=field)
    return MetricV1(
        state=_enum(MetricState, body["state"], field=f"{field}.state"),
        value=require_int_or_none(body["value"], field=f"{field}.value"),
    )


def _policy(value: object, *, field: str) -> GatePolicyV1:
    body = require_dict(value, field=field)
    require_keys(
        body,
        expected=(
            "actualFeeRequired",
            "makerEntryRequired",
            "pboRequired",
            "globalTestRequired",
            "dsrRequired",
            "requiredEvidenceClass",
            "minimumNetMicrousdPer1000",
            "minimumHoldoutLowerBoundMicrousdPer1000",
            "minimumStressNetMicrousdPer1000",
            "minimumCapacityUsd",
            "maximumDrawdownBps",
        ),
        field=field,
    )
    return GatePolicyV1(
        actual_fee_required=_bool(body["actualFeeRequired"], field=f"{field}.actualFeeRequired"),
        maker_entry_required=_bool(body["makerEntryRequired"], field=f"{field}.makerEntryRequired"),
        pbo_required=_bool(body["pboRequired"], field=f"{field}.pboRequired"),
        global_test_required=_bool(body["globalTestRequired"], field=f"{field}.globalTestRequired"),
        dsr_required=_bool(body["dsrRequired"], field=f"{field}.dsrRequired"),
        required_evidence_class=_enum(
            EvidenceClass,
            body["requiredEvidenceClass"],
            field=f"{field}.requiredEvidenceClass",
        ),
        minimum_net_microusd_per_1000=require_strict_int(
            body["minimumNetMicrousdPer1000"],
            field=f"{field}.minimumNetMicrousdPer1000",
        ),
        minimum_holdout_lower_bound_microusd_per_1000=require_strict_int(
            body["minimumHoldoutLowerBoundMicrousdPer1000"],
            field=f"{field}.minimumHoldoutLowerBoundMicrousdPer1000",
        ),
        minimum_stress_net_microusd_per_1000=require_strict_int(
            body["minimumStressNetMicrousdPer1000"],
            field=f"{field}.minimumStressNetMicrousdPer1000",
        ),
        minimum_capacity_usd=require_strict_int(
            body["minimumCapacityUsd"],
            field=f"{field}.minimumCapacityUsd",
            minimum=0,
        ),
        maximum_drawdown_bps=require_strict_int(
            body["maximumDrawdownBps"],
            field=f"{field}.maximumDrawdownBps",
            minimum=0,
            maximum=1_000_000,
        ),
    )


def _registry_family(value: object, *, field: str) -> RegistryFamilyV1:
    body = require_dict(value, field=field)
    require_keys(
        body,
        expected=(
            "familyId",
            "packetRole",
            "trialCount",
            "candidateIds",
            "trialLedgerSha256",
            "multiplicityMethod",
            "alphaNumerator",
            "alphaDenominator",
            "policy",
        ),
        field=field,
    )
    candidate_values = require_list(body["candidateIds"], field=f"{field}.candidateIds")
    if not 1 <= len(candidate_values) <= MAX_TRIALS:
        raise ContractValueError(f"{field}.candidateIds must contain 1..{MAX_TRIALS} identifiers")
    return RegistryFamilyV1(
        family_id=require_str(body["familyId"], field=f"{field}.familyId"),
        packet_role=_enum(PacketRole, body["packetRole"], field=f"{field}.packetRole"),
        trial_count=require_strict_int(
            body["trialCount"],
            field=f"{field}.trialCount",
            minimum=1,
            maximum=MAX_TRIALS,
        ),
        candidate_ids=tuple(
            require_str(
                candidate_id,
                field=f"{field}.candidateIds[{index}]",
            )
            for index, candidate_id in enumerate(candidate_values)
        ),
        trial_ledger_sha256=require_digest(
            body["trialLedgerSha256"], field=f"{field}.trialLedgerSha256"
        ),
        multiplicity_method=require_str(
            body["multiplicityMethod"], field=f"{field}.multiplicityMethod"
        ),
        alpha_numerator=require_strict_int(
            body["alphaNumerator"],
            field=f"{field}.alphaNumerator",
            minimum=1,
            maximum=9_999,
        ),
        alpha_denominator=require_strict_int(
            body["alphaDenominator"],
            field=f"{field}.alphaDenominator",
            minimum=2,
            maximum=1_000_000,
        ),
        policy=_policy(body["policy"], field=f"{field}.policy"),
    )


def adapt_registry(document: PinnedDocumentV1) -> RegistryV1:
    """Parse one exact S-META1 registry document without filesystem access."""

    body = parse_document(document)
    if document.pin.role is not ArtifactRole.S_META1:
        raise ContractValueError("registry pin role must be S_META1")
    require_keys(
        body,
        expected=("schema", "version", "registryId", "baseCommit", "families"),
        field="registry",
    )
    if require_str(body["schema"], field="registry.schema") != _REGISTRY_SCHEMA:
        raise ContractValueError(f"registry.schema must be {_REGISTRY_SCHEMA}")
    _version(body["version"], field="registry.version")
    family_values = require_list(body["families"], field="registry.families")
    if not 1 <= len(family_values) <= MAX_FAMILIES:
        raise ContractValueError(f"registry.families must contain 1..{MAX_FAMILIES} families")
    families = tuple(
        _registry_family(value, field=f"registry.families[{index}]")
        for index, value in enumerate(family_values)
    )
    return RegistryV1(
        registry_id=require_str(body["registryId"], field="registry.registryId"),
        base_commit=_git_oid(body["baseCommit"], field="registry.baseCommit"),
        families=families,
        raw_sha256=document.pin.raw_sha256,
        semantic_sha256=semantic_digest("REGISTRY:S_META1", body),
    )


def _provenance(
    value: object,
    *,
    document: PinnedDocumentV1,
    field: str,
) -> ProvenanceV1:
    body = require_dict(value, field=field)
    require_keys(
        body,
        expected=(
            "baseCommit",
            "producerCommit",
            "producerTree",
            "sourceArtifactSha256",
        ),
        field=field,
    )
    producer_commit = _git_oid(body["producerCommit"], field=f"{field}.producerCommit")
    producer_tree = _git_oid(body["producerTree"], field=f"{field}.producerTree")
    if producer_commit != document.pin.producer_commit:
        raise ContractValueError("result producerCommit does not match its pin")
    if producer_tree != document.pin.producer_tree:
        raise ContractValueError("result producerTree does not match its pin")
    source_values = require_list(
        body["sourceArtifactSha256"], field=f"{field}.sourceArtifactSha256"
    )
    if not 1 <= len(source_values) <= MAX_SOURCE_ARTIFACTS:
        raise ContractValueError(
            "result provenance sourceArtifactSha256 must be nonempty and bounded"
        )
    return ProvenanceV1(
        base_commit=_git_oid(body["baseCommit"], field=f"{field}.baseCommit"),
        producer_commit=producer_commit,
        producer_tree=producer_tree,
        source_artifact_sha256=tuple(
            require_digest(item, field=f"{field}.sourceArtifactSha256[{index}]")
            for index, item in enumerate(source_values)
        ),
    )


def _trials(value: object, *, field: str) -> TrialEvidenceV1:
    body = require_dict(value, field=field)
    require_keys(
        body,
        expected=(
            "declaredCount",
            "observedCount",
            "ledgerSha256",
            "multiplicityMethod",
            "multiplicityState",
            "pboState",
            "globalTestState",
            "dsrState",
        ),
        field=field,
    )
    return TrialEvidenceV1(
        declared_count=require_strict_int(
            body["declaredCount"],
            field=f"{field}.declaredCount",
            minimum=1,
            maximum=MAX_TRIALS,
        ),
        observed_count=require_strict_int(
            body["observedCount"],
            field=f"{field}.observedCount",
            minimum=0,
            maximum=MAX_TRIALS,
        ),
        ledger_sha256=require_digest(body["ledgerSha256"], field=f"{field}.ledgerSha256"),
        multiplicity_method=require_str(
            body["multiplicityMethod"], field=f"{field}.multiplicityMethod"
        ),
        multiplicity_state=_enum(
            GateState,
            body["multiplicityState"],
            field=f"{field}.multiplicityState",
        ),
        pbo_state=_enum(GateState, body["pboState"], field=f"{field}.pboState"),
        global_test_state=_enum(
            GateState, body["globalTestState"], field=f"{field}.globalTestState"
        ),
        dsr_state=_enum(GateState, body["dsrState"], field=f"{field}.dsrState"),
    )


def _holdout(value: object, *, field: str) -> HoldoutEvidenceV1:
    body = require_dict(value, field=field)
    require_keys(
        body,
        expected=(
            "evidenceClass",
            "state",
            "singleUse",
            "openedAfterFreeze",
            "selectionInsideEvaluation",
            "reuseCount",
            "lowerBound",
        ),
        field=field,
    )
    return HoldoutEvidenceV1(
        evidence_class=_enum(EvidenceClass, body["evidenceClass"], field=f"{field}.evidenceClass"),
        state=_enum(GateState, body["state"], field=f"{field}.state"),
        single_use=require_bool_or_none(body["singleUse"], field=f"{field}.singleUse"),
        opened_after_freeze=require_bool_or_none(
            body["openedAfterFreeze"], field=f"{field}.openedAfterFreeze"
        ),
        selection_inside_evaluation=require_bool_or_none(
            body["selectionInsideEvaluation"],
            field=f"{field}.selectionInsideEvaluation",
        ),
        reuse_count=require_int_or_none(
            body["reuseCount"], field=f"{field}.reuseCount", minimum=0, maximum=1_000
        ),
        lower_bound=_metric(body["lowerBound"], field=f"{field}.lowerBound"),
    )


def _economics(value: object, *, field: str) -> EconomicEvidenceV1:
    body = require_dict(value, field=field)
    require_keys(
        body,
        expected=(
            "net",
            "stressNet",
            "capacityUsd",
            "maxDrawdownBps",
            "actualFeeState",
            "costCompleteState",
            "makerEntryState",
            "regimeCoverageState",
        ),
        field=field,
    )
    return EconomicEvidenceV1(
        net=_metric(body["net"], field=f"{field}.net"),
        stress_net=_metric(body["stressNet"], field=f"{field}.stressNet"),
        capacity_usd=_metric(body["capacityUsd"], field=f"{field}.capacityUsd"),
        max_drawdown_bps=_metric(body["maxDrawdownBps"], field=f"{field}.maxDrawdownBps"),
        actual_fee_state=_enum(GateState, body["actualFeeState"], field=f"{field}.actualFeeState"),
        cost_complete_state=_enum(
            GateState,
            body["costCompleteState"],
            field=f"{field}.costCompleteState",
        ),
        maker_entry_state=_enum(
            GateState, body["makerEntryState"], field=f"{field}.makerEntryState"
        ),
        regime_coverage_state=_enum(
            GateState,
            body["regimeCoverageState"],
            field=f"{field}.regimeCoverageState",
        ),
    )


def adapt_result(document: PinnedDocumentV1) -> ResultPacketV1:
    """Parse one exact terminal result packet without inferring unavailable facts."""

    body = parse_document(document)
    require_keys(
        body,
        expected=(
            "schema",
            "version",
            "packetRole",
            "milestone",
            "registryId",
            "registrySha256",
            "familyId",
            "candidateId",
            "terminalState",
            "provenance",
            "trials",
            "holdout",
            "economics",
            "reasonCodes",
        ),
        field="result",
    )
    _version(body["version"], field="result.version")
    role = _enum(PacketRole, body["packetRole"], field="result.packetRole")
    if document.pin.role is not ArtifactRole(role.value):
        raise ContractValueError("result packetRole does not match its pin role")
    expected_schema, expected_milestone = _RESULT_SPEC[role]
    schema = require_str(body["schema"], field="result.schema")
    milestone = require_str(body["milestone"], field="result.milestone")
    if schema != expected_schema or milestone != expected_milestone:
        raise ContractValueError(
            f"result role {role.value} requires schema {expected_schema} "
            f"and milestone {expected_milestone}"
        )
    reason_values = require_list(body["reasonCodes"], field="result.reasonCodes")
    if len(reason_values) > MAX_REASONS:
        raise ContractValueError(f"result.reasonCodes must contain at most {MAX_REASONS} codes")
    reason_codes = tuple(
        require_str(value, field=f"result.reasonCodes[{index}]")
        for index, value in enumerate(reason_values)
    )
    return ResultPacketV1(
        schema=schema,
        role=role,
        milestone=milestone,
        registry_id=require_str(body["registryId"], field="result.registryId"),
        registry_sha256=require_digest(body["registrySha256"], field="result.registrySha256"),
        family_id=require_str(body["familyId"], field="result.familyId"),
        candidate_id=require_str(body["candidateId"], field="result.candidateId"),
        terminal_state=_enum(GateState, body["terminalState"], field="result.terminalState"),
        provenance=_provenance(body["provenance"], document=document, field="result.provenance"),
        trials=_trials(body["trials"], field="result.trials"),
        holdout=_holdout(body["holdout"], field="result.holdout"),
        economics=_economics(body["economics"], field="result.economics"),
        reason_codes=reason_codes,
        raw_sha256=document.pin.raw_sha256,
        semantic_sha256=semantic_digest(f"RESULT:{role.value}", body),
    )
