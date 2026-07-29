"""Deterministic predictive-family distinctness and multiplicity membership.

DQ-7 validates one explicit, normalized program manifest.  It does not inspect
legacy protocol prose, calculate economic results, open holdouts, or grant
capital authority.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final, NoReturn, cast

SCHEMA_V1: Final = "cosmos.dq7.predictive-family-program.v1"
RECEIPT_SCHEMA_V1: Final = "cosmos.dq7.predictive-family-receipt.v1"
CANONICALIZATION_V1: Final = "RFC8785_ASCII_KEY_SAFE_INTEGER_SUBSET_WITH_LF"

_FAMILY_NODE_DOMAIN: Final = b"cosmos-dq7-family-node-v1\0"
_HYPOTHESIS_NODE_DOMAIN: Final = b"cosmos-dq7-hypothesis-node-v1\0"
_FAMILY_ANCHOR_DOMAIN: Final = b"cosmos-dq7-family-anchor-v1\0"
_FAMILY_FINGERPRINT_DOMAIN: Final = b"cosmos-dq7-family-fingerprint-v1\0"
_HYPOTHESIS_FINGERPRINT_DOMAIN: Final = b"cosmos-dq7-hypothesis-fingerprint-v1\0"
_NUISANCE_FINGERPRINT_DOMAIN: Final = b"cosmos-dq7-nuisance-fingerprint-v1\0"
_ATTEMPT_LEDGER_DOMAIN: Final = b"cosmos-dq7-attempt-ledger-v1\0"
_FAMILY_COMPONENT_DOMAIN: Final = b"cosmos-dq7-family-component-v1\0"
_FAMILY_UNIVERSE_DOMAIN: Final = b"cosmos-dq7-family-universe-v1\0"
_MANIFEST_DOMAIN: Final = b"cosmos-dq7-normalized-manifest-v1\0"
_RECEIPT_DOMAIN: Final = b"cosmos-dq7-receipt-v1\0"

_ID_PATTERN: Final = re.compile(r"^[A-Z0-9][A-Z0-9_.:@+\-/]{0,127}$")
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
_MAX_SAFE_INTEGER: Final = (1 << 53) - 1
_MAX_CANDIDATES: Final = 128
_MAX_NODES: Final = 128
_MAX_ROOTS: Final = 16
_MAX_PARAMETERS: Final = 16
_MAX_INPUTS: Final = 8
_MAX_TEXT_BYTES: Final = 512

_COMMUTATIVE_OPS: Final = frozenset({"INTERACTION", "PRODUCT", "SUM"})
_UNARY_OPS: Final = frozenset(
    {
        "ABS",
        "AUTOCORRELATION",
        "CHANGE",
        "CLIP",
        "ENTROPY",
        "LAG",
        "MEAN",
        "NEGATE",
        "RANK",
        "RETURN",
        "STDDEV",
        "THRESHOLD",
        "ZSCORE",
    }
)
_BINARY_OPS: Final = frozenset({"DIFFERENCE", "RATIO", "RESIDUAL"})
_NARY_OPS: Final = _COMMUTATIVE_OPS
_ALLOWED_OPS: Final = frozenset({"SOURCE"}) | _UNARY_OPS | _BINARY_OPS | _NARY_OPS

_ALLOWED_PROGRAM_METHODS: Final = frozenset(
    {
        "PROGRAM_BONFERRONI_FWER",
        "PROGRAM_HIERARCHICAL_FWER",
        "PROGRAM_HOLM_FWER",
        "PROGRAM_ROMANO_WOLF_STEPDOWN",
        "PROGRAM_WHITE_REALITY_CHECK",
    }
)
_REQUIRED_CONSUMERS: Final = frozenset({"N3_INTAKE", "SCHEDULER"})


class ContractError(ValueError):
    """A stable, fail-closed input-contract error."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


class AttemptStatus(StrEnum):
    PLANNED = "PLANNED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    ABANDONED = "ABANDONED"
    RETIRED_DUPLICATE = "RETIRED_DUPLICATE"


class FindingSeverity(StrEnum):
    BLOCK = "BLOCK"
    DISCLOSE = "DISCLOSE"


class SchedulerDisposition(StrEnum):
    ADMIT = "ADMIT"
    ADMIT_WITH_DISCLOSURES = "ADMIT_WITH_DISCLOSURES"
    REJECT = "REJECT"


class N3IntakeDisposition(StrEnum):
    ADMISSIBLE = "ADMISSIBLE"
    ADMISSIBLE_WITH_DEPENDENCE_DISCLOSURE = "ADMISSIBLE_WITH_DEPENDENCE_DISCLOSURE"
    INADMISSIBLE = "INADMISSIBLE"


class ReasonCode(StrEnum):
    FAMILY_RENAME_DUPLICATE = "FAMILY_RENAME_DUPLICATE"
    RENAMED_VENUE_DUPLICATE = "RENAMED_VENUE_DUPLICATE"
    SIZING_ONLY_DUPLICATE = "SIZING_ONLY_DUPLICATE"
    BOOKKEEPING_ONLY_DUPLICATE = "BOOKKEEPING_ONLY_DUPLICATE"
    NONPREDICTIVE_ONLY_DUPLICATE = "NONPREDICTIVE_ONLY_DUPLICATE"
    SEMANTIC_COLLISION_IMPLEMENTATION_DIVERGENCE = "SEMANTIC_COLLISION_IMPLEMENTATION_DIVERGENCE"
    DECLARED_FAMILY_ALIAS = "DECLARED_FAMILY_ALIAS"
    DECLARED_FAMILY_SPLIT = "DECLARED_FAMILY_SPLIT"
    SHARED_SIGNAL_COMPONENT = "SHARED_SIGNAL_COMPONENT"
    SHARED_SIGNAL_CROSS_TARGET = "SHARED_SIGNAL_CROSS_TARGET"
    SHARED_SOURCE_ONLY = "SHARED_SOURCE_ONLY"
    PREDICTIVE_FAMILY_OVERLAP = "PREDICTIVE_FAMILY_OVERLAP"
    PROGRAM_MULTIPLICITY_PLAN_MISSING = "PROGRAM_MULTIPLICITY_PLAN_MISSING"
    PROGRAM_MULTIPLICITY_SCOPE_INVALID = "PROGRAM_MULTIPLICITY_SCOPE_INVALID"
    PROGRAM_MULTIPLICITY_METHOD_INVALID = "PROGRAM_MULTIPLICITY_METHOD_INVALID"
    PROGRAM_MULTIPLICITY_NOT_PREOUTCOME = "PROGRAM_MULTIPLICITY_NOT_PREOUTCOME"
    PROGRAM_ATTEMPT_LEDGER_INCOMPLETE = "PROGRAM_ATTEMPT_LEDGER_INCOMPLETE"
    PROGRAM_FAMILY_SET_MISMATCH = "PROGRAM_FAMILY_SET_MISMATCH"
    PROGRAM_MULTIPLICITY_DIGEST_MISMATCH = "PROGRAM_MULTIPLICITY_DIGEST_MISMATCH"
    PROGRAM_MULTIPLICITY_CONSUMER_MISMATCH = "PROGRAM_MULTIPLICITY_CONSUMER_MISMATCH"


_REASON_ORDER: Final = {code: ordinal for ordinal, code in enumerate(ReasonCode)}
_BLOCKING_CODES: Final = frozenset(
    {
        ReasonCode.FAMILY_RENAME_DUPLICATE,
        ReasonCode.RENAMED_VENUE_DUPLICATE,
        ReasonCode.SIZING_ONLY_DUPLICATE,
        ReasonCode.BOOKKEEPING_ONLY_DUPLICATE,
        ReasonCode.NONPREDICTIVE_ONLY_DUPLICATE,
        ReasonCode.SEMANTIC_COLLISION_IMPLEMENTATION_DIVERGENCE,
        ReasonCode.DECLARED_FAMILY_ALIAS,
        ReasonCode.DECLARED_FAMILY_SPLIT,
        ReasonCode.PREDICTIVE_FAMILY_OVERLAP,
        ReasonCode.PROGRAM_MULTIPLICITY_PLAN_MISSING,
        ReasonCode.PROGRAM_MULTIPLICITY_SCOPE_INVALID,
        ReasonCode.PROGRAM_MULTIPLICITY_METHOD_INVALID,
        ReasonCode.PROGRAM_MULTIPLICITY_NOT_PREOUTCOME,
        ReasonCode.PROGRAM_ATTEMPT_LEDGER_INCOMPLETE,
        ReasonCode.PROGRAM_FAMILY_SET_MISMATCH,
        ReasonCode.PROGRAM_MULTIPLICITY_DIGEST_MISMATCH,
        ReasonCode.PROGRAM_MULTIPLICITY_CONSUMER_MISMATCH,
    }
)


@dataclass(frozen=True, slots=True)
class ParameterBindingV1:
    role_id: str
    value_id: str

    def as_dict(self) -> dict[str, str]:
        return {"roleId": self.role_id, "valueId": self.value_id}


@dataclass(frozen=True, slots=True)
class FeatureNodeV1:
    node_id: str
    op_id: str
    input_node_ids: tuple[str, ...]
    source_role_id: str | None
    parameter_bindings: tuple[ParameterBindingV1, ...]


@dataclass(frozen=True, slots=True)
class PredictionV1:
    outcome_id: str
    instrument_topology_id: str
    forecast_clock_id: str
    population_topology_id: str
    target_role_id: str
    target_value_id: str
    polarity_id: str
    action_mapping_id: str

    def family_anchor_dict(self) -> dict[str, str]:
        return {
            "forecastClockId": self.forecast_clock_id,
            "instrumentTopologyId": self.instrument_topology_id,
            "outcomeId": self.outcome_id,
            "populationTopologyId": self.population_topology_id,
            "targetRoleId": self.target_role_id,
        }

    def hypothesis_dict(self) -> dict[str, str]:
        return {
            **self.family_anchor_dict(),
            "actionMappingId": self.action_mapping_id,
            "polarityId": self.polarity_id,
            "targetValueId": self.target_value_id,
        }


@dataclass(frozen=True, slots=True)
class NuisanceV1:
    venue_provider_ids: tuple[str, ...]
    sizing_policy_id: str
    bookkeeping_policy_id: str
    universe_id: str
    data_window_id: str
    implementation_digest: str
    result_digest: str | None

    def as_dict(self) -> dict[str, object]:
        return {
            "bookkeepingPolicyId": self.bookkeeping_policy_id,
            "dataWindowId": self.data_window_id,
            "implementationDigest": self.implementation_digest,
            "resultDigest": self.result_digest,
            "sizingPolicyId": self.sizing_policy_id,
            "universeId": self.universe_id,
            "venueProviderIds": list(self.venue_provider_ids),
        }


@dataclass(frozen=True, slots=True)
class CandidateV1:
    attempt_id: str
    declared_family_id: str
    display_name: str
    attempt_status: AttemptStatus
    outcome_accessed: bool
    nodes: tuple[FeatureNodeV1, ...]
    root_node_ids: tuple[str, ...]
    prediction: PredictionV1
    nuisance: NuisanceV1


@dataclass(frozen=True, slots=True)
class MultiplicityPlanV1:
    scope_id: str
    method_id: str
    alpha_numerator: int
    alpha_denominator: int
    frozen_before_any_outcome: bool
    attempt_ids: tuple[str, ...]
    family_component_ids: tuple[str, ...]
    attempt_ledger_digest: str
    family_universe_digest: str
    consumer_ids: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "alpha": {
                "denominator": self.alpha_denominator,
                "numerator": self.alpha_numerator,
            },
            "attemptIds": list(self.attempt_ids),
            "attemptLedgerDigest": self.attempt_ledger_digest,
            "consumerIds": list(self.consumer_ids),
            "familyComponentIds": list(self.family_component_ids),
            "familyUniverseDigest": self.family_universe_digest,
            "frozenBeforeAnyOutcome": self.frozen_before_any_outcome,
            "methodId": self.method_id,
            "scopeId": self.scope_id,
        }


@dataclass(frozen=True, slots=True)
class ProgramManifestV1:
    program_id: str
    candidates: tuple[CandidateV1, ...]
    multiplicity_plan: MultiplicityPlanV1 | None


@dataclass(frozen=True, slots=True)
class _NodeIdentityV1:
    family_fingerprint: str
    hypothesis_fingerprint: str
    non_source_family_fingerprints: frozenset[str]
    source_role_ids: frozenset[str]


@dataclass(frozen=True, slots=True)
class CandidateIdentityV1:
    attempt_id: str
    declared_family_id: str
    attempt_status: AttemptStatus
    outcome_accessed: bool
    family_anchor_fingerprint: str
    family_fingerprint: str
    hypothesis_fingerprint: str
    signal_root_fingerprints: tuple[str, ...]
    non_source_family_fingerprints: frozenset[str]
    source_role_ids: tuple[str, ...]
    nuisance_fingerprint: str
    nuisance: NuisanceV1

    def as_dict(self) -> dict[str, object]:
        return {
            "attemptId": self.attempt_id,
            "attemptStatus": self.attempt_status.value,
            "declaredFamilyId": self.declared_family_id,
            "familyAnchorFingerprint": self.family_anchor_fingerprint,
            "familyFingerprint": self.family_fingerprint,
            "hypothesisFingerprint": self.hypothesis_fingerprint,
            "nonSourceFamilyFingerprints": sorted(self.non_source_family_fingerprints),
            "nuisanceFingerprint": self.nuisance_fingerprint,
            "outcomeAccessed": self.outcome_accessed,
            "signalRootFingerprints": list(self.signal_root_fingerprints),
            "sourceRoleIds": list(self.source_role_ids),
        }


@dataclass(frozen=True, slots=True)
class FindingV1:
    code: ReasonCode
    severity: FindingSeverity
    attempt_ids: tuple[str, ...]
    declared_family_ids: tuple[str, ...]
    evidence_ids: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "attemptIds": list(self.attempt_ids),
            "declaredFamilyIds": list(self.declared_family_ids),
            "evidenceIds": list(self.evidence_ids),
            "reasonCode": self.code.value,
            "severity": self.severity.value,
        }


@dataclass(frozen=True, slots=True)
class FamilyComponentV1:
    component_id: str
    attempt_ids: tuple[str, ...]
    declared_family_ids: tuple[str, ...]
    family_fingerprints: tuple[str, ...]
    hypothesis_fingerprints: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "attemptIds": list(self.attempt_ids),
            "componentId": self.component_id,
            "declaredFamilyIds": list(self.declared_family_ids),
            "familyFingerprints": list(self.family_fingerprints),
            "hypothesisFingerprints": list(self.hypothesis_fingerprints),
        }


@dataclass(frozen=True, slots=True)
class ValidationReceiptV1:
    schema: str
    program_id: str
    canonicalization: str
    manifest_digest: str
    attempt_ledger_digest: str
    family_universe_digest: str
    candidate_count: int
    declared_family_count: int
    predictive_family_count: int
    family_component_count: int
    candidates: tuple[CandidateIdentityV1, ...]
    family_components: tuple[FamilyComponentV1, ...]
    findings: tuple[FindingV1, ...]
    reason_codes: tuple[str, ...]
    multiplicity_status: str
    scheduler_disposition: SchedulerDisposition
    n3_intake_disposition: N3IntakeDisposition
    verified_positive_structurally_eligible: bool
    authority: str
    receipt_digest: str

    def as_dict(self) -> dict[str, object]:
        return {
            "attemptLedgerDigest": self.attempt_ledger_digest,
            "authority": self.authority,
            "candidateCount": self.candidate_count,
            "candidates": [candidate.as_dict() for candidate in self.candidates],
            "canonicalization": self.canonicalization,
            "declaredFamilyCount": self.declared_family_count,
            "familyComponentCount": self.family_component_count,
            "familyComponents": [component.as_dict() for component in self.family_components],
            "familyUniverseDigest": self.family_universe_digest,
            "findings": [finding.as_dict() for finding in self.findings],
            "manifestDigest": self.manifest_digest,
            "multiplicityStatus": self.multiplicity_status,
            "n3IntakeDisposition": self.n3_intake_disposition.value,
            "predictiveFamilyCount": self.predictive_family_count,
            "programId": self.program_id,
            "reasonCodes": list(self.reason_codes),
            "receiptDigest": self.receipt_digest,
            "schedulerDisposition": self.scheduler_disposition.value,
            "schema": self.schema,
            "verifiedPositiveStructurallyEligible": (self.verified_positive_structurally_eligible),
        }

    def canonical_bytes(self) -> bytes:
        return _canonical_json_bytes(self.as_dict())


def _fail(code: str, detail: str) -> NoReturn:
    raise ContractError(code, detail)


def _canonical_json_bytes(value: object) -> bytes:
    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return f"{encoded}\n".encode("utf-8", errors="strict")
    except (TypeError, UnicodeEncodeError, ValueError) as error:
        raise ContractError(
            "CANONICAL_JSON_INVALID",
            "value is outside the canonical JSON subset",
        ) from error


def _digest(domain: bytes, value: object) -> str:
    return hashlib.sha256(domain + _canonical_json_bytes(value)).hexdigest()


def _mapping(value: object, *, field: str) -> dict[str, object]:
    if type(value) is not dict:
        _fail("OBJECT_REQUIRED", f"{field} must be an exact object")
    return cast(dict[str, object], value)


def _array(value: object, *, field: str) -> list[object]:
    if type(value) is not list:
        _fail("ARRAY_REQUIRED", f"{field} must be an exact array")
    return cast(list[object], value)


def _exact_keys(value: dict[str, object], *, expected: frozenset[str], field: str) -> None:
    actual = frozenset(value)
    if actual != expected:
        _fail("KEY_SET_INVALID", f"{field} keys must match the v1 contract exactly")


def _text(value: object, *, field: str) -> str:
    if type(value) is not str:
        _fail("STRING_REQUIRED", f"{field} must be an exact string")
    text = value
    try:
        encoded = text.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ContractError("STRING_UNICODE_INVALID", f"{field} must be valid UTF-8") from error
    if not encoded or len(encoded) > _MAX_TEXT_BYTES:
        _fail("STRING_LENGTH_INVALID", f"{field} byte length is outside the v1 bound")
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in text):
        _fail("STRING_CONTROL_INVALID", f"{field} contains a control character")
    return text


def _identifier(value: object, *, field: str) -> str:
    identifier = _text(value, field=field)
    if _ID_PATTERN.fullmatch(identifier) is None:
        _fail("IDENTIFIER_INVALID", f"{field} must match the canonical ASCII identifier law")
    return identifier


def _digest_value(value: object, *, field: str) -> str:
    digest = _text(value, field=field)
    if _SHA256_PATTERN.fullmatch(digest) is None:
        _fail("DIGEST_INVALID", f"{field} must be lowercase SHA-256 hex")
    return digest


def _boolean(value: object, *, field: str) -> bool:
    if type(value) is not bool:
        _fail("BOOLEAN_REQUIRED", f"{field} must be an exact boolean")
    return value


def _integer(value: object, *, field: str, minimum: int, maximum: int) -> int:
    if type(value) is not int:
        _fail("INTEGER_REQUIRED", f"{field} must be an exact integer")
    integer = value
    if not minimum <= integer <= maximum:
        _fail("INTEGER_RANGE_INVALID", f"{field} is outside the v1 bound")
    return integer


def _identifiers(
    value: object,
    *,
    field: str,
    minimum: int,
    maximum: int,
    sort_values: bool = True,
) -> tuple[str, ...]:
    entries = _array(value, field=field)
    if not minimum <= len(entries) <= maximum:
        _fail("CARDINALITY_INVALID", f"{field} cardinality is outside the v1 bound")
    identifiers = tuple(
        _identifier(entry, field=f"{field}[{index}]") for index, entry in enumerate(entries)
    )
    if len(set(identifiers)) != len(identifiers):
        _fail("DUPLICATE_IDENTIFIER", f"{field} contains a duplicate identifier")
    return tuple(sorted(identifiers)) if sort_values else identifiers


def _digests(
    value: object,
    *,
    field: str,
    minimum: int,
    maximum: int,
) -> tuple[str, ...]:
    entries = _array(value, field=field)
    if not minimum <= len(entries) <= maximum:
        _fail("CARDINALITY_INVALID", f"{field} cardinality is outside the v1 bound")
    digests = tuple(
        _digest_value(entry, field=f"{field}[{index}]") for index, entry in enumerate(entries)
    )
    if len(set(digests)) != len(digests):
        _fail("DUPLICATE_DIGEST", f"{field} contains a duplicate digest")
    return tuple(sorted(digests))


def _parse_parameter(value: object, *, field: str) -> ParameterBindingV1:
    mapping = _mapping(value, field=field)
    _exact_keys(
        mapping,
        expected=frozenset({"roleId", "valueId"}),
        field=field,
    )
    return ParameterBindingV1(
        role_id=_identifier(mapping["roleId"], field=f"{field}.roleId"),
        value_id=_identifier(mapping["valueId"], field=f"{field}.valueId"),
    )


def _parse_node(value: object, *, field: str) -> FeatureNodeV1:
    mapping = _mapping(value, field=field)
    _exact_keys(
        mapping,
        expected=frozenset(
            {
                "inputNodeIds",
                "nodeId",
                "opId",
                "parameterBindings",
                "sourceRoleId",
            }
        ),
        field=field,
    )
    node_id = _identifier(mapping["nodeId"], field=f"{field}.nodeId")
    op_id = _identifier(mapping["opId"], field=f"{field}.opId")
    if op_id not in _ALLOWED_OPS:
        _fail("FEATURE_OP_INVALID", f"{field}.opId is not in the closed v1 operation set")
    input_node_ids = _identifiers(
        mapping["inputNodeIds"],
        field=f"{field}.inputNodeIds",
        minimum=0,
        maximum=_MAX_INPUTS,
        sort_values=False,
    )
    parameter_values = _array(
        mapping["parameterBindings"],
        field=f"{field}.parameterBindings",
    )
    if len(parameter_values) > _MAX_PARAMETERS:
        _fail("CARDINALITY_INVALID", f"{field}.parameterBindings exceeds the v1 bound")
    parameters = tuple(
        _parse_parameter(parameter, field=f"{field}.parameterBindings[{index}]")
        for index, parameter in enumerate(parameter_values)
    )
    if len({parameter.role_id for parameter in parameters}) != len(parameters):
        _fail(
            "DUPLICATE_PARAMETER_ROLE",
            f"{field}.parameterBindings contains a duplicate role",
        )
    parameters = tuple(sorted(parameters, key=lambda parameter: parameter.role_id))
    source_raw = mapping["sourceRoleId"]
    source_role_id = (
        None if source_raw is None else _identifier(source_raw, field=f"{field}.sourceRoleId")
    )
    if op_id == "SOURCE":
        if input_node_ids or parameters or source_role_id is None:
            _fail(
                "SOURCE_NODE_INVALID",
                f"{field} SOURCE requires one role and no inputs or parameters",
            )
    else:
        if source_role_id is not None:
            _fail("NON_SOURCE_ROLE_INVALID", f"{field} non-SOURCE role must be null")
        if op_id in _UNARY_OPS and len(input_node_ids) != 1:
            _fail("FEATURE_ARITY_INVALID", f"{field} unary operation requires one input")
        if op_id in _BINARY_OPS and len(input_node_ids) != 2:
            _fail("FEATURE_ARITY_INVALID", f"{field} binary operation requires two inputs")
        if op_id in _NARY_OPS and not 2 <= len(input_node_ids) <= _MAX_INPUTS:
            _fail(
                "FEATURE_ARITY_INVALID",
                f"{field} n-ary operation requires two to {_MAX_INPUTS} inputs",
            )
    return FeatureNodeV1(
        node_id=node_id,
        op_id=op_id,
        input_node_ids=input_node_ids,
        source_role_id=source_role_id,
        parameter_bindings=parameters,
    )


def _parse_prediction(value: object, *, field: str) -> PredictionV1:
    mapping = _mapping(value, field=field)
    _exact_keys(
        mapping,
        expected=frozenset(
            {
                "actionMappingId",
                "forecastClockId",
                "instrumentTopologyId",
                "outcomeId",
                "polarityId",
                "populationTopologyId",
                "targetRoleId",
                "targetValueId",
            }
        ),
        field=field,
    )
    return PredictionV1(
        outcome_id=_identifier(mapping["outcomeId"], field=f"{field}.outcomeId"),
        instrument_topology_id=_identifier(
            mapping["instrumentTopologyId"],
            field=f"{field}.instrumentTopologyId",
        ),
        forecast_clock_id=_identifier(
            mapping["forecastClockId"],
            field=f"{field}.forecastClockId",
        ),
        population_topology_id=_identifier(
            mapping["populationTopologyId"],
            field=f"{field}.populationTopologyId",
        ),
        target_role_id=_identifier(
            mapping["targetRoleId"],
            field=f"{field}.targetRoleId",
        ),
        target_value_id=_identifier(
            mapping["targetValueId"],
            field=f"{field}.targetValueId",
        ),
        polarity_id=_identifier(mapping["polarityId"], field=f"{field}.polarityId"),
        action_mapping_id=_identifier(
            mapping["actionMappingId"],
            field=f"{field}.actionMappingId",
        ),
    )


def _parse_nuisance(value: object, *, field: str) -> NuisanceV1:
    mapping = _mapping(value, field=field)
    _exact_keys(
        mapping,
        expected=frozenset(
            {
                "bookkeepingPolicyId",
                "dataWindowId",
                "implementationDigest",
                "resultDigest",
                "sizingPolicyId",
                "universeId",
                "venueProviderIds",
            }
        ),
        field=field,
    )
    result_raw = mapping["resultDigest"]
    result_digest = (
        None if result_raw is None else _digest_value(result_raw, field=f"{field}.resultDigest")
    )
    return NuisanceV1(
        venue_provider_ids=_identifiers(
            mapping["venueProviderIds"],
            field=f"{field}.venueProviderIds",
            minimum=1,
            maximum=16,
        ),
        sizing_policy_id=_identifier(
            mapping["sizingPolicyId"],
            field=f"{field}.sizingPolicyId",
        ),
        bookkeeping_policy_id=_identifier(
            mapping["bookkeepingPolicyId"],
            field=f"{field}.bookkeepingPolicyId",
        ),
        universe_id=_identifier(mapping["universeId"], field=f"{field}.universeId"),
        data_window_id=_identifier(
            mapping["dataWindowId"],
            field=f"{field}.dataWindowId",
        ),
        implementation_digest=_digest_value(
            mapping["implementationDigest"],
            field=f"{field}.implementationDigest",
        ),
        result_digest=result_digest,
    )


def _parse_candidate(value: object, *, field: str) -> CandidateV1:
    mapping = _mapping(value, field=field)
    _exact_keys(
        mapping,
        expected=frozenset(
            {
                "attemptId",
                "attemptStatus",
                "declaredFamilyId",
                "displayName",
                "featureGraph",
                "nuisance",
                "outcomeAccessed",
                "prediction",
            }
        ),
        field=field,
    )
    graph = _mapping(mapping["featureGraph"], field=f"{field}.featureGraph")
    _exact_keys(
        graph,
        expected=frozenset({"nodes", "rootNodeIds"}),
        field=f"{field}.featureGraph",
    )
    node_values = _array(graph["nodes"], field=f"{field}.featureGraph.nodes")
    if not 1 <= len(node_values) <= _MAX_NODES:
        _fail("CARDINALITY_INVALID", f"{field}.featureGraph.nodes is outside the v1 bound")
    nodes = tuple(
        _parse_node(node, field=f"{field}.featureGraph.nodes[{index}]")
        for index, node in enumerate(node_values)
    )
    if len({node.node_id for node in nodes}) != len(nodes):
        _fail("DUPLICATE_NODE_ID", f"{field}.featureGraph has duplicate node IDs")
    root_node_ids = _identifiers(
        graph["rootNodeIds"],
        field=f"{field}.featureGraph.rootNodeIds",
        minimum=1,
        maximum=_MAX_ROOTS,
    )
    status_raw = _identifier(mapping["attemptStatus"], field=f"{field}.attemptStatus")
    try:
        status = AttemptStatus(status_raw)
    except ValueError as error:
        raise ContractError(
            "ATTEMPT_STATUS_INVALID",
            f"{field}.attemptStatus is outside the v1 set",
        ) from error
    return CandidateV1(
        attempt_id=_identifier(mapping["attemptId"], field=f"{field}.attemptId"),
        declared_family_id=_identifier(
            mapping["declaredFamilyId"],
            field=f"{field}.declaredFamilyId",
        ),
        display_name=_text(mapping["displayName"], field=f"{field}.displayName"),
        attempt_status=status,
        outcome_accessed=_boolean(
            mapping["outcomeAccessed"],
            field=f"{field}.outcomeAccessed",
        ),
        nodes=nodes,
        root_node_ids=root_node_ids,
        prediction=_parse_prediction(mapping["prediction"], field=f"{field}.prediction"),
        nuisance=_parse_nuisance(mapping["nuisance"], field=f"{field}.nuisance"),
    )


def _parse_multiplicity_plan(value: object, *, field: str) -> MultiplicityPlanV1:
    mapping = _mapping(value, field=field)
    _exact_keys(
        mapping,
        expected=frozenset(
            {
                "alpha",
                "attemptIds",
                "attemptLedgerDigest",
                "consumerIds",
                "familyComponentIds",
                "familyUniverseDigest",
                "frozenBeforeAnyOutcome",
                "methodId",
                "scopeId",
            }
        ),
        field=field,
    )
    alpha = _mapping(mapping["alpha"], field=f"{field}.alpha")
    _exact_keys(
        alpha,
        expected=frozenset({"denominator", "numerator"}),
        field=f"{field}.alpha",
    )
    numerator = _integer(
        alpha["numerator"],
        field=f"{field}.alpha.numerator",
        minimum=1,
        maximum=_MAX_SAFE_INTEGER,
    )
    denominator = _integer(
        alpha["denominator"],
        field=f"{field}.alpha.denominator",
        minimum=2,
        maximum=_MAX_SAFE_INTEGER,
    )
    if numerator >= denominator:
        _fail("ALPHA_INVALID", f"{field}.alpha must lie strictly between zero and one")
    return MultiplicityPlanV1(
        scope_id=_identifier(mapping["scopeId"], field=f"{field}.scopeId"),
        method_id=_identifier(mapping["methodId"], field=f"{field}.methodId"),
        alpha_numerator=numerator,
        alpha_denominator=denominator,
        frozen_before_any_outcome=_boolean(
            mapping["frozenBeforeAnyOutcome"],
            field=f"{field}.frozenBeforeAnyOutcome",
        ),
        attempt_ids=_identifiers(
            mapping["attemptIds"],
            field=f"{field}.attemptIds",
            minimum=1,
            maximum=_MAX_CANDIDATES,
        ),
        family_component_ids=_digests(
            mapping["familyComponentIds"],
            field=f"{field}.familyComponentIds",
            minimum=1,
            maximum=_MAX_CANDIDATES,
        ),
        attempt_ledger_digest=_digest_value(
            mapping["attemptLedgerDigest"],
            field=f"{field}.attemptLedgerDigest",
        ),
        family_universe_digest=_digest_value(
            mapping["familyUniverseDigest"],
            field=f"{field}.familyUniverseDigest",
        ),
        consumer_ids=_identifiers(
            mapping["consumerIds"],
            field=f"{field}.consumerIds",
            minimum=1,
            maximum=16,
        ),
    )


def parse_program_manifest_v1(value: object) -> ProgramManifestV1:
    """Parse the closed v1 manifest without inferring any free-text semantics."""

    mapping = _mapping(value, field="manifest")
    _exact_keys(
        mapping,
        expected=frozenset(
            {
                "candidates",
                "globalMultiplicity",
                "programId",
                "schema",
                "version",
            }
        ),
        field="manifest",
    )
    if _text(mapping["schema"], field="manifest.schema") != SCHEMA_V1:
        _fail("SCHEMA_INVALID", "manifest.schema does not identify DQ-7 v1")
    if (
        _integer(
            mapping["version"],
            field="manifest.version",
            minimum=1,
            maximum=1,
        )
        != 1
    ):
        _fail("VERSION_INVALID", "manifest.version must be one")
    candidate_values = _array(mapping["candidates"], field="manifest.candidates")
    if not 1 <= len(candidate_values) <= _MAX_CANDIDATES:
        _fail("CARDINALITY_INVALID", "manifest.candidates is outside the v1 bound")
    candidates = tuple(
        _parse_candidate(candidate, field=f"manifest.candidates[{index}]")
        for index, candidate in enumerate(candidate_values)
    )
    if len({candidate.attempt_id for candidate in candidates}) != len(candidates):
        _fail("DUPLICATE_ATTEMPT_ID", "manifest.candidates repeats an attempt ID")
    candidates = tuple(sorted(candidates, key=lambda candidate: candidate.attempt_id))
    multiplicity_raw = mapping["globalMultiplicity"]
    multiplicity_plan = (
        None
        if multiplicity_raw is None
        else _parse_multiplicity_plan(
            multiplicity_raw,
            field="manifest.globalMultiplicity",
        )
    )
    return ProgramManifestV1(
        program_id=_identifier(mapping["programId"], field="manifest.programId"),
        candidates=candidates,
        multiplicity_plan=multiplicity_plan,
    )


def _reject_duplicate_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _fail("DUPLICATE_JSON_KEY", f"JSON object repeats key {key!r}")
        result[key] = value
    return result


def load_program_manifest_v1(path: Path) -> dict[str, object]:
    """Load strict UTF-8 JSON while rejecting duplicate object keys."""

    try:
        raw = path.read_bytes()
        value = json.loads(
            raw.decode("utf-8", errors="strict"),
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=lambda constant: _fail(
                "NONFINITE_JSON_NUMBER",
                f"JSON contains {constant}",
            ),
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ContractError("JSON_INVALID", f"{path.name} is not strict UTF-8 JSON") from error
    return _mapping(value, field=path.name)


def _candidate_identity(candidate: CandidateV1) -> CandidateIdentityV1:
    node_by_id = {node.node_id: node for node in candidate.nodes}
    for root_id in candidate.root_node_ids:
        if root_id not in node_by_id:
            _fail(
                "FEATURE_ROOT_DANGLING",
                f"{candidate.attempt_id} root {root_id} is absent",
            )
        if node_by_id[root_id].op_id == "SOURCE":
            _fail(
                "FEATURE_ROOT_SOURCE_ONLY",
                f"{candidate.attempt_id} roots must contain a predictive transform",
            )
    for node in candidate.nodes:
        for input_id in node.input_node_ids:
            if input_id not in node_by_id:
                _fail(
                    "FEATURE_INPUT_DANGLING",
                    f"{candidate.attempt_id} node {node.node_id} references {input_id}",
                )

    visiting: set[str] = set()
    memo: dict[str, _NodeIdentityV1] = {}

    def visit(node_id: str) -> _NodeIdentityV1:
        if node_id in memo:
            return memo[node_id]
        if node_id in visiting:
            _fail(
                "FEATURE_GRAPH_CYCLE",
                f"{candidate.attempt_id} graph contains a cycle at {node_id}",
            )
        visiting.add(node_id)
        node = node_by_id[node_id]
        children = tuple(visit(input_id) for input_id in node.input_node_ids)
        family_inputs = tuple(child.family_fingerprint for child in children)
        hypothesis_inputs = tuple(child.hypothesis_fingerprint for child in children)
        if node.op_id in _COMMUTATIVE_OPS:
            family_inputs = tuple(sorted(family_inputs))
            hypothesis_inputs = tuple(sorted(hypothesis_inputs))
        family_payload: dict[str, object] = {
            "inputFingerprints": list(family_inputs),
            "opId": node.op_id,
            "parameterRoleIds": [parameter.role_id for parameter in node.parameter_bindings],
            "sourceRoleId": node.source_role_id,
        }
        hypothesis_payload: dict[str, object] = {
            "inputFingerprints": list(hypothesis_inputs),
            "opId": node.op_id,
            "parameterBindings": [parameter.as_dict() for parameter in node.parameter_bindings],
            "sourceRoleId": node.source_role_id,
        }
        family_fingerprint = _digest(_FAMILY_NODE_DOMAIN, family_payload)
        hypothesis_fingerprint = _digest(_HYPOTHESIS_NODE_DOMAIN, hypothesis_payload)
        non_source = set().union(*(child.non_source_family_fingerprints for child in children))
        source_roles = set().union(*(child.source_role_ids for child in children))
        if node.op_id == "SOURCE":
            if node.source_role_id is None:
                _fail("SOURCE_NODE_INVALID", "source role disappeared after parsing")
            source_roles.add(node.source_role_id)
        else:
            non_source.add(family_fingerprint)
        identity = _NodeIdentityV1(
            family_fingerprint=family_fingerprint,
            hypothesis_fingerprint=hypothesis_fingerprint,
            non_source_family_fingerprints=frozenset(non_source),
            source_role_ids=frozenset(source_roles),
        )
        visiting.remove(node_id)
        memo[node_id] = identity
        return identity

    roots = tuple(visit(root_id) for root_id in candidate.root_node_ids)
    unreachable_node_ids = tuple(sorted(set(node_by_id) - set(memo)))
    if unreachable_node_ids:
        _fail(
            "FEATURE_NODE_UNREACHABLE",
            (
                f"{candidate.attempt_id} graph contains nodes outside every root: "
                f"{','.join(unreachable_node_ids)}"
            ),
        )
    root_family_fingerprints = tuple(sorted(root.family_fingerprint for root in roots))
    if len(set(root_family_fingerprints)) != len(root_family_fingerprints):
        _fail(
            "SIGNAL_ROOT_SEMANTIC_DUPLICATE",
            f"{candidate.attempt_id} repeats an identical signal root",
        )
    root_hypothesis_fingerprints = tuple(sorted(root.hypothesis_fingerprint for root in roots))
    family_anchor = candidate.prediction.family_anchor_dict()
    family_anchor_fingerprint = _digest(_FAMILY_ANCHOR_DOMAIN, family_anchor)
    family_fingerprint = _digest(
        _FAMILY_FINGERPRINT_DOMAIN,
        {
            "familyAnchor": family_anchor,
            "signalRootFingerprints": list(root_family_fingerprints),
        },
    )
    hypothesis_fingerprint = _digest(
        _HYPOTHESIS_FINGERPRINT_DOMAIN,
        {
            "prediction": candidate.prediction.hypothesis_dict(),
            "signalRootFingerprints": list(root_hypothesis_fingerprints),
        },
    )
    all_non_source = frozenset().union(*(root.non_source_family_fingerprints for root in roots))
    all_source_roles = frozenset().union(*(root.source_role_ids for root in roots))
    return CandidateIdentityV1(
        attempt_id=candidate.attempt_id,
        declared_family_id=candidate.declared_family_id,
        attempt_status=candidate.attempt_status,
        outcome_accessed=candidate.outcome_accessed,
        family_anchor_fingerprint=family_anchor_fingerprint,
        family_fingerprint=family_fingerprint,
        hypothesis_fingerprint=hypothesis_fingerprint,
        signal_root_fingerprints=root_family_fingerprints,
        non_source_family_fingerprints=all_non_source,
        source_role_ids=tuple(sorted(all_source_roles)),
        nuisance_fingerprint=_digest(
            _NUISANCE_FINGERPRINT_DOMAIN,
            candidate.nuisance.as_dict(),
        ),
        nuisance=candidate.nuisance,
    )


def _proper_signal_subgraph(left: CandidateIdentityV1, right: CandidateIdentityV1) -> bool:
    left_roots = frozenset(left.signal_root_fingerprints)
    return (
        bool(left_roots)
        and left_roots.issubset(right.non_source_family_fingerprints)
        and left.family_fingerprint != right.family_fingerprint
    )


def _nuisance_changed(left: NuisanceV1, right: NuisanceV1) -> frozenset[str]:
    fields: tuple[tuple[str, object, object], ...] = (
        ("VENUE", left.venue_provider_ids, right.venue_provider_ids),
        ("SIZING", left.sizing_policy_id, right.sizing_policy_id),
        ("BOOKKEEPING", left.bookkeeping_policy_id, right.bookkeeping_policy_id),
        ("UNIVERSE", left.universe_id, right.universe_id),
        ("DATA_WINDOW", left.data_window_id, right.data_window_id),
        ("IMPLEMENTATION", left.implementation_digest, right.implementation_digest),
        ("RESULT", left.result_digest, right.result_digest),
    )
    return frozenset(name for name, left_value, right_value in fields if left_value != right_value)


def _severity(code: ReasonCode) -> FindingSeverity:
    return FindingSeverity.BLOCK if code in _BLOCKING_CODES else FindingSeverity.DISCLOSE


def _finding(
    code: ReasonCode,
    candidates: tuple[CandidateIdentityV1, ...],
    evidence_ids: tuple[str, ...] = (),
) -> FindingV1:
    return FindingV1(
        code=code,
        severity=_severity(code),
        attempt_ids=tuple(sorted(candidate.attempt_id for candidate in candidates)),
        declared_family_ids=tuple(
            sorted({candidate.declared_family_id for candidate in candidates})
        ),
        evidence_ids=tuple(sorted(set(evidence_ids))),
    )


class _UnionFind:
    def __init__(self, size: int) -> None:
        self._parents = list(range(size))

    def find(self, value: int) -> int:
        parent = self._parents[value]
        if parent != value:
            self._parents[value] = self.find(parent)
        return self._parents[value]

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self._parents[max(left_root, right_root)] = min(left_root, right_root)


def _pair_findings_and_components(
    candidates: tuple[CandidateIdentityV1, ...],
) -> tuple[tuple[FindingV1, ...], tuple[FamilyComponentV1, ...]]:
    findings: set[FindingV1] = set()
    union_find = _UnionFind(len(candidates))
    for left_index, left in enumerate(candidates):
        for right_index in range(left_index + 1, len(candidates)):
            right = candidates[right_index]
            pair = (left, right)
            same_anchor = left.family_anchor_fingerprint == right.family_anchor_fingerprint
            same_family = left.family_fingerprint == right.family_fingerprint
            same_hypothesis = left.hypothesis_fingerprint == right.hypothesis_fingerprint
            same_declared_family = left.declared_family_id == right.declared_family_id
            left_subgraph = same_anchor and _proper_signal_subgraph(left, right)
            right_subgraph = same_anchor and _proper_signal_subgraph(right, left)

            if same_family or left_subgraph or right_subgraph or same_declared_family:
                union_find.union(left_index, right_index)

            if same_declared_family and not same_family:
                findings.add(
                    _finding(
                        ReasonCode.DECLARED_FAMILY_SPLIT,
                        pair,
                        (left.family_fingerprint, right.family_fingerprint),
                    )
                )
            if not same_declared_family and same_family:
                findings.add(
                    _finding(
                        ReasonCode.DECLARED_FAMILY_ALIAS,
                        pair,
                        (left.family_fingerprint,),
                    )
                )

            shared_non_source = tuple(
                sorted(left.non_source_family_fingerprints & right.non_source_family_fingerprints)
            )
            if shared_non_source:
                shared_code = (
                    ReasonCode.SHARED_SIGNAL_COMPONENT
                    if same_anchor
                    else ReasonCode.SHARED_SIGNAL_CROSS_TARGET
                )
                findings.add(_finding(shared_code, pair, shared_non_source))
            else:
                shared_sources = tuple(
                    sorted(set(left.source_role_ids) & set(right.source_role_ids))
                )
                if shared_sources:
                    findings.add(
                        _finding(
                            ReasonCode.SHARED_SOURCE_ONLY,
                            pair,
                            shared_sources,
                        )
                    )

            if not same_declared_family and (left_subgraph or right_subgraph):
                subgraph_evidence = tuple(
                    sorted(
                        (set(left.signal_root_fingerprints) & right.non_source_family_fingerprints)
                        | (
                            set(right.signal_root_fingerprints)
                            & left.non_source_family_fingerprints
                        )
                    )
                )
                findings.add(
                    _finding(
                        ReasonCode.PREDICTIVE_FAMILY_OVERLAP,
                        pair,
                        subgraph_evidence,
                    )
                )

            if same_hypothesis:
                changed = _nuisance_changed(left.nuisance, right.nuisance)
                if not changed:
                    duplicate_code = ReasonCode.FAMILY_RENAME_DUPLICATE
                elif changed == {"VENUE"}:
                    duplicate_code = ReasonCode.RENAMED_VENUE_DUPLICATE
                elif changed == {"SIZING"}:
                    duplicate_code = ReasonCode.SIZING_ONLY_DUPLICATE
                elif changed == {"BOOKKEEPING"}:
                    duplicate_code = ReasonCode.BOOKKEEPING_ONLY_DUPLICATE
                else:
                    duplicate_code = ReasonCode.NONPREDICTIVE_ONLY_DUPLICATE
                findings.add(
                    _finding(
                        duplicate_code,
                        pair,
                        (left.hypothesis_fingerprint,),
                    )
                )
                if changed & {"IMPLEMENTATION", "RESULT"}:
                    findings.add(
                        _finding(
                            ReasonCode.SEMANTIC_COLLISION_IMPLEMENTATION_DIVERGENCE,
                            pair,
                            (left.hypothesis_fingerprint,),
                        )
                    )

    grouped: dict[int, list[CandidateIdentityV1]] = {}
    for index, candidate in enumerate(candidates):
        grouped.setdefault(union_find.find(index), []).append(candidate)
    components: list[FamilyComponentV1] = []
    for members in grouped.values():
        family_fingerprints = tuple(sorted({member.family_fingerprint for member in members}))
        component_id = _digest(
            _FAMILY_COMPONENT_DOMAIN,
            {"familyFingerprints": list(family_fingerprints)},
        )
        components.append(
            FamilyComponentV1(
                component_id=component_id,
                attempt_ids=tuple(sorted(member.attempt_id for member in members)),
                declared_family_ids=tuple(
                    sorted({member.declared_family_id for member in members})
                ),
                family_fingerprints=family_fingerprints,
                hypothesis_fingerprints=tuple(
                    sorted({member.hypothesis_fingerprint for member in members})
                ),
            )
        )
    components.sort(key=lambda component: component.component_id)
    ordered_findings = tuple(
        sorted(
            findings,
            key=lambda finding: (
                _REASON_ORDER[finding.code],
                finding.attempt_ids,
                finding.declared_family_ids,
                finding.evidence_ids,
            ),
        )
    )
    return ordered_findings, tuple(components)


def _attempt_ledger_digest(candidates: tuple[CandidateIdentityV1, ...]) -> str:
    return _digest(
        _ATTEMPT_LEDGER_DOMAIN,
        {
            "attempts": [
                {
                    "attemptId": candidate.attempt_id,
                    "attemptStatus": candidate.attempt_status.value,
                    "familyFingerprint": candidate.family_fingerprint,
                    "hypothesisFingerprint": candidate.hypothesis_fingerprint,
                    "outcomeAccessed": candidate.outcome_accessed,
                }
                for candidate in candidates
            ]
        },
    )


def _family_universe_digest(components: tuple[FamilyComponentV1, ...]) -> str:
    return _digest(
        _FAMILY_UNIVERSE_DOMAIN,
        {
            "components": [
                {
                    "componentId": component.component_id,
                    "familyFingerprints": list(component.family_fingerprints),
                }
                for component in components
            ]
        },
    )


def _multiplicity_findings(
    plan: MultiplicityPlanV1 | None,
    candidates: tuple[CandidateIdentityV1, ...],
    components: tuple[FamilyComponentV1, ...],
    attempt_ledger_digest: str,
    family_universe_digest: str,
) -> tuple[tuple[FindingV1, ...], str]:
    if plan is None:
        if len(candidates) == 1:
            return (), "NOT_REQUIRED_SINGLE_ATTEMPT"
        return (
            (
                _finding(
                    ReasonCode.PROGRAM_MULTIPLICITY_PLAN_MISSING,
                    candidates,
                    (attempt_ledger_digest, family_universe_digest),
                ),
            ),
            "MISSING",
        )
    findings: list[FindingV1] = []
    all_candidates = candidates
    if plan.scope_id != "PROGRAM_WIDE":
        findings.append(
            _finding(
                ReasonCode.PROGRAM_MULTIPLICITY_SCOPE_INVALID,
                all_candidates,
                (plan.scope_id,),
            )
        )
    if plan.method_id not in _ALLOWED_PROGRAM_METHODS:
        findings.append(
            _finding(
                ReasonCode.PROGRAM_MULTIPLICITY_METHOD_INVALID,
                all_candidates,
                (plan.method_id,),
            )
        )
    if not plan.frozen_before_any_outcome:
        findings.append(
            _finding(
                ReasonCode.PROGRAM_MULTIPLICITY_NOT_PREOUTCOME,
                all_candidates,
            )
        )
    expected_attempt_ids = tuple(candidate.attempt_id for candidate in candidates)
    if plan.attempt_ids != expected_attempt_ids:
        findings.append(
            _finding(
                ReasonCode.PROGRAM_ATTEMPT_LEDGER_INCOMPLETE,
                all_candidates,
                tuple(sorted(set(expected_attempt_ids).symmetric_difference(plan.attempt_ids))),
            )
        )
    expected_component_ids = tuple(component.component_id for component in components)
    if plan.family_component_ids != expected_component_ids:
        findings.append(
            _finding(
                ReasonCode.PROGRAM_FAMILY_SET_MISMATCH,
                all_candidates,
                tuple(
                    sorted(
                        set(expected_component_ids).symmetric_difference(plan.family_component_ids)
                    )
                ),
            )
        )
    mismatched_digests: list[str] = []
    if plan.attempt_ledger_digest != attempt_ledger_digest:
        mismatched_digests.extend((plan.attempt_ledger_digest, attempt_ledger_digest))
    if plan.family_universe_digest != family_universe_digest:
        mismatched_digests.extend((plan.family_universe_digest, family_universe_digest))
    if mismatched_digests:
        findings.append(
            _finding(
                ReasonCode.PROGRAM_MULTIPLICITY_DIGEST_MISMATCH,
                all_candidates,
                tuple(mismatched_digests),
            )
        )
    if not _REQUIRED_CONSUMERS.issubset(plan.consumer_ids):
        findings.append(
            _finding(
                ReasonCode.PROGRAM_MULTIPLICITY_CONSUMER_MISMATCH,
                all_candidates,
                tuple(sorted(_REQUIRED_CONSUMERS - set(plan.consumer_ids))),
            )
        )
    return tuple(findings), ("COVERED" if not findings else "INVALID")


def _normalized_manifest_payload(
    program_id: str,
    candidates: tuple[CandidateIdentityV1, ...],
    plan: MultiplicityPlanV1 | None,
) -> dict[str, object]:
    return {
        "candidates": [
            {
                **candidate.as_dict(),
                "nuisance": candidate.nuisance.as_dict(),
            }
            for candidate in candidates
        ],
        "globalMultiplicity": None if plan is None else plan.as_dict(),
        "programId": program_id,
        "schema": SCHEMA_V1,
        "version": 1,
    }


def validate_program_v1(value: object) -> ValidationReceiptV1:
    """Validate distinctness and exact program-level multiplicity membership."""

    manifest = parse_program_manifest_v1(value)
    identities = tuple(_candidate_identity(candidate) for candidate in manifest.candidates)
    pair_findings, components = _pair_findings_and_components(identities)
    attempt_ledger_digest = _attempt_ledger_digest(identities)
    family_universe_digest = _family_universe_digest(components)
    multiplicity_findings, multiplicity_status = _multiplicity_findings(
        manifest.multiplicity_plan,
        identities,
        components,
        attempt_ledger_digest,
        family_universe_digest,
    )
    findings = tuple(
        sorted(
            (*pair_findings, *multiplicity_findings),
            key=lambda finding: (
                _REASON_ORDER[finding.code],
                finding.attempt_ids,
                finding.declared_family_ids,
                finding.evidence_ids,
            ),
        )
    )
    reason_codes = tuple(
        code.value for code in ReasonCode if any(finding.code == code for finding in findings)
    )
    blocked = any(finding.severity is FindingSeverity.BLOCK for finding in findings)
    disclosed = any(finding.severity is FindingSeverity.DISCLOSE for finding in findings)
    scheduler_disposition = (
        SchedulerDisposition.REJECT
        if blocked
        else (
            SchedulerDisposition.ADMIT_WITH_DISCLOSURES if disclosed else SchedulerDisposition.ADMIT
        )
    )
    n3_disposition = (
        N3IntakeDisposition.INADMISSIBLE
        if blocked
        else (
            N3IntakeDisposition.ADMISSIBLE_WITH_DEPENDENCE_DISCLOSURE
            if disclosed
            else N3IntakeDisposition.ADMISSIBLE
        )
    )
    manifest_digest = _digest(
        _MANIFEST_DOMAIN,
        _normalized_manifest_payload(
            manifest.program_id,
            identities,
            manifest.multiplicity_plan,
        ),
    )
    receipt_without_digest: dict[str, object] = {
        "attemptLedgerDigest": attempt_ledger_digest,
        "authority": "NONE",
        "candidateCount": len(identities),
        "candidates": [candidate.as_dict() for candidate in identities],
        "canonicalization": CANONICALIZATION_V1,
        "declaredFamilyCount": len({candidate.declared_family_id for candidate in identities}),
        "familyComponentCount": len(components),
        "familyComponents": [component.as_dict() for component in components],
        "familyUniverseDigest": family_universe_digest,
        "findings": [finding.as_dict() for finding in findings],
        "manifestDigest": manifest_digest,
        "multiplicityStatus": multiplicity_status,
        "n3IntakeDisposition": n3_disposition.value,
        "predictiveFamilyCount": len({candidate.family_fingerprint for candidate in identities}),
        "programId": manifest.program_id,
        "reasonCodes": list(reason_codes),
        "schedulerDisposition": scheduler_disposition.value,
        "schema": RECEIPT_SCHEMA_V1,
        "verifiedPositiveStructurallyEligible": not blocked,
    }
    receipt_digest = _digest(_RECEIPT_DOMAIN, receipt_without_digest)
    return ValidationReceiptV1(
        schema=RECEIPT_SCHEMA_V1,
        program_id=manifest.program_id,
        canonicalization=CANONICALIZATION_V1,
        manifest_digest=manifest_digest,
        attempt_ledger_digest=attempt_ledger_digest,
        family_universe_digest=family_universe_digest,
        candidate_count=len(identities),
        declared_family_count=len({candidate.declared_family_id for candidate in identities}),
        predictive_family_count=len({candidate.family_fingerprint for candidate in identities}),
        family_component_count=len(components),
        candidates=identities,
        family_components=components,
        findings=findings,
        reason_codes=reason_codes,
        multiplicity_status=multiplicity_status,
        scheduler_disposition=scheduler_disposition,
        n3_intake_disposition=n3_disposition,
        verified_positive_structurally_eligible=not blocked,
        authority="NONE",
        receipt_digest=receipt_digest,
    )


def validate_program_file_v1(path: Path) -> ValidationReceiptV1:
    """Load and validate one program manifest."""

    return validate_program_v1(load_program_manifest_v1(path))
