"""Closed immutable contracts for the N3-I1 edge-verdict intake."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    INT64_MIN,
    DigestV1,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)

MAX_DOCUMENT_BYTES: Final = 1_048_576
MAX_FAMILIES: Final = 64
MAX_TRIALS: Final = 4_096
MAX_REASONS: Final = 32
MAX_SOURCE_ARTIFACTS: Final = 128
_INTAKE_DECISION_TOKEN: Final = object()

_GIT_OID_PATTERN: Final = re.compile(r"^[0-9a-f]{40}$")
_SAFE_PATH_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$")


class PacketRole(StrEnum):
    E1 = "E1"
    VE1 = "VE1"
    S1C = "S1C"
    S1D = "S1D"
    S1E = "S1E"


PACKET_ROLE_ORDER: Final = tuple(PacketRole)
_PACKET_ROLE_INDEX: Final = {role: index for index, role in enumerate(PACKET_ROLE_ORDER)}


class ArtifactRole(StrEnum):
    S_META1 = "S_META1"
    E1 = "E1"
    VE1 = "VE1"
    S1C = "S1C"
    S1D = "S1D"
    S1E = "S1E"


class AcceptanceState(StrEnum):
    ACCEPTED = "ACCEPTED"
    PENDING = "PENDING"
    REJECTED = "REJECTED"


class GateState(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"
    UNMEASURED = "UNMEASURED"


class DecisionState(StrEnum):
    VERIFIED_POSITIVE = "VERIFIED_POSITIVE"
    NO_GO = "NO_GO"
    UNKNOWN = "UNKNOWN"


class EvidenceClass(StrEnum):
    SEALED_FORWARD = "SEALED_FORWARD"
    HISTORICAL_VALIDATION = "HISTORICAL_VALIDATION"
    PUBLIC_PROXY = "PUBLIC_PROXY"
    CONDITIONAL_PROXY = "CONDITIONAL_PROXY"
    UNMEASURED = "UNMEASURED"


class MetricState(StrEnum):
    MEASURED = "MEASURED"
    UNKNOWN = "UNKNOWN"
    NOT_ESTIMABLE = "NOT_ESTIMABLE"


def _require_exact_bool(value: object, *, field: str) -> bool:
    if type(value) is not bool:
        raise ContractValueError(f"{field} must be boolean")
    return value


def _require_bool_or_none(value: object, *, field: str) -> bool | None:
    if value is not None and type(value) is not bool:
        raise ContractValueError(f"{field} must be boolean or null")
    return value


def _require_safe_path(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _SAFE_PATH_PATTERN.fullmatch(value) is None:
        raise ContractValueError(f"{field} must be a bounded safe relative POSIX path")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or path.as_posix() != value
        or any(part in ("", ".", "..") for part in path.parts)
    ):
        raise ContractValueError(f"{field} must be a bounded safe relative POSIX path")
    return value


def _require_reason_codes(value: object, *, field: str) -> tuple[str, ...]:
    if not isinstance(value, tuple) or len(value) > MAX_REASONS:
        raise ContractValueError(f"{field} must be a tuple with at most {MAX_REASONS} codes")
    checked = tuple(require_reason_code(item, field=field) for item in value)
    if checked != tuple(sorted(set(checked))):
        raise ContractValueError(f"{field} must be sorted and unique")
    return checked


@dataclass(frozen=True, slots=True)
class GitOidV1:
    hexdigest: str

    def __post_init__(self) -> None:
        if (
            not isinstance(self.hexdigest, str)
            or _GIT_OID_PATTERN.fullmatch(self.hexdigest) is None
        ):
            raise ContractValueError("Git object id must be 40 lowercase hexadecimal characters")


@dataclass(frozen=True, slots=True)
class ArtifactPinV1:
    role: ArtifactRole
    raw_sha256: DigestV1
    byte_length: int
    producer_commit: GitOidV1
    producer_tree: GitOidV1
    relative_path: str
    acceptance: AcceptanceState
    acceptance_sha256: DigestV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.role, ArtifactRole):
            raise ContractValueError("artifact pin role must be ArtifactRole")
        if not isinstance(self.raw_sha256, DigestV1):
            raise ContractValueError("artifact pin raw_sha256 must be DigestV1")
        require_strict_int(
            self.byte_length,
            field="artifact pin byte_length",
            minimum=1,
            maximum=MAX_DOCUMENT_BYTES,
        )
        if not isinstance(self.producer_commit, GitOidV1):
            raise ContractValueError("artifact pin producer_commit must be GitOidV1")
        if not isinstance(self.producer_tree, GitOidV1):
            raise ContractValueError("artifact pin producer_tree must be GitOidV1")
        _require_safe_path(self.relative_path, field="artifact pin relative_path")
        if not isinstance(self.acceptance, AcceptanceState):
            raise ContractValueError("artifact pin acceptance must be AcceptanceState")
        if self.acceptance is AcceptanceState.ACCEPTED:
            if not isinstance(self.acceptance_sha256, DigestV1):
                raise ContractValueError("accepted artifact pin requires acceptance_sha256")
        elif self.acceptance_sha256 is not None:
            raise ContractValueError("non-accepted artifact pin cannot carry acceptance_sha256")


@dataclass(frozen=True, slots=True)
class PinnedDocumentV1:
    pin: ArtifactPinV1
    raw: bytes

    def __post_init__(self) -> None:
        if not isinstance(self.pin, ArtifactPinV1):
            raise ContractValueError("pinned document pin must be ArtifactPinV1")
        if type(self.raw) is not bytes:
            raise ContractValueError("pinned document raw must be bytes")
        if len(self.raw) != self.pin.byte_length:
            raise ContractValueError("pinned document byte length does not match its pin")


@dataclass(frozen=True, slots=True)
class MetricV1:
    state: MetricState
    value: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.state, MetricState):
            raise ContractValueError("metric state must be MetricState")
        if self.state is MetricState.MEASURED:
            require_strict_int(
                self.value,
                field="measured metric value",
                minimum=INT64_MIN,
                maximum=INT64_MAX,
            )
        elif self.value is not None:
            raise ContractValueError("unknown or not-estimable metric value must be null")


@dataclass(frozen=True, slots=True)
class GatePolicyV1:
    actual_fee_required: bool
    maker_entry_required: bool
    pbo_required: bool
    global_test_required: bool
    dsr_required: bool
    required_evidence_class: EvidenceClass
    minimum_net_microusd_per_1000: int
    minimum_holdout_lower_bound_microusd_per_1000: int
    minimum_stress_net_microusd_per_1000: int
    minimum_capacity_usd: int
    maximum_drawdown_bps: int

    def __post_init__(self) -> None:
        for field_name in (
            "actual_fee_required",
            "maker_entry_required",
            "pbo_required",
            "global_test_required",
            "dsr_required",
        ):
            _require_exact_bool(getattr(self, field_name), field=field_name)
        for field_name in (
            "actual_fee_required",
            "maker_entry_required",
            "pbo_required",
            "global_test_required",
            "dsr_required",
        ):
            if not getattr(self, field_name):
                raise ContractValueError(f"{field_name} must be true in N3-I1")
        if not isinstance(self.required_evidence_class, EvidenceClass):
            raise ContractValueError("required_evidence_class must be EvidenceClass")
        if self.required_evidence_class is not EvidenceClass.SEALED_FORWARD:
            raise ContractValueError("required_evidence_class must be SEALED_FORWARD")
        for field_name in (
            "minimum_net_microusd_per_1000",
            "minimum_holdout_lower_bound_microusd_per_1000",
            "minimum_stress_net_microusd_per_1000",
        ):
            require_strict_int(getattr(self, field_name), field=field_name, minimum=1)
        require_strict_int(
            self.minimum_capacity_usd,
            field="minimum_capacity_usd",
            minimum=1,
        )
        require_strict_int(
            self.maximum_drawdown_bps,
            field="maximum_drawdown_bps",
            minimum=1,
            maximum=1_000_000,
        )


@dataclass(frozen=True, slots=True)
class RegistryFamilyV1:
    family_id: str
    packet_role: PacketRole
    trial_count: int
    candidate_ids: tuple[str, ...]
    trial_ledger_sha256: DigestV1
    multiplicity_method: str
    alpha_numerator: int
    alpha_denominator: int
    policy: GatePolicyV1

    def __post_init__(self) -> None:
        require_contract_id(self.family_id, field="family_id")
        if not isinstance(self.packet_role, PacketRole):
            raise ContractValueError("packet_role must be PacketRole")
        require_strict_int(self.trial_count, field="trial_count", minimum=1, maximum=MAX_TRIALS)
        if not isinstance(self.candidate_ids, tuple) or len(self.candidate_ids) != self.trial_count:
            raise ContractValueError("candidate_ids must contain exactly trial_count entries")
        checked_candidates = tuple(
            require_contract_id(candidate_id, field="candidate_ids")
            for candidate_id in self.candidate_ids
        )
        if checked_candidates != tuple(sorted(set(checked_candidates))):
            raise ContractValueError("candidate_ids must be sorted and unique")
        if not isinstance(self.trial_ledger_sha256, DigestV1):
            raise ContractValueError("trial_ledger_sha256 must be DigestV1")
        if self.multiplicity_method != "HOLM_BONFERRONI":
            raise ContractValueError("multiplicity_method must be HOLM_BONFERRONI")
        numerator = require_strict_int(
            self.alpha_numerator,
            field="alpha_numerator",
            minimum=1,
            maximum=9_999,
        )
        denominator = require_strict_int(
            self.alpha_denominator,
            field="alpha_denominator",
            minimum=2,
            maximum=1_000_000,
        )
        if numerator >= denominator:
            raise ContractValueError("alpha_numerator must be less than alpha_denominator")
        if not isinstance(self.policy, GatePolicyV1):
            raise ContractValueError("policy must be GatePolicyV1")


@dataclass(frozen=True, slots=True)
class RegistryV1:
    registry_id: str
    base_commit: GitOidV1
    families: tuple[RegistryFamilyV1, ...]
    raw_sha256: DigestV1
    semantic_sha256: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.registry_id, field="registry_id")
        if not isinstance(self.base_commit, GitOidV1):
            raise ContractValueError("base_commit must be GitOidV1")
        if not isinstance(self.families, tuple) or len(self.families) != len(PACKET_ROLE_ORDER):
            raise ContractValueError("families must contain every N3-I1 packet role exactly once")
        if any(not isinstance(family, RegistryFamilyV1) for family in self.families):
            raise ContractValueError("families must contain RegistryFamilyV1 values")
        expected = tuple(
            sorted(self.families, key=lambda item: _PACKET_ROLE_INDEX[item.packet_role])
        )
        if self.families != expected:
            raise ContractValueError("families must follow PACKET_ROLE_ORDER")
        if len({family.family_id for family in self.families}) != len(self.families):
            raise ContractValueError("family_id values must be unique")
        if len({family.packet_role for family in self.families}) != len(self.families):
            raise ContractValueError("packet_role values must be unique")
        if tuple(family.packet_role for family in self.families) != PACKET_ROLE_ORDER:
            raise ContractValueError("families must contain the complete PACKET_ROLE_ORDER")
        if not isinstance(self.raw_sha256, DigestV1) or not isinstance(
            self.semantic_sha256, DigestV1
        ):
            raise ContractValueError("registry hashes must be DigestV1 values")


@dataclass(frozen=True, slots=True)
class ProvenanceV1:
    base_commit: GitOidV1
    producer_commit: GitOidV1
    producer_tree: GitOidV1
    source_artifact_sha256: tuple[DigestV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.base_commit, GitOidV1):
            raise ContractValueError("provenance base_commit must be GitOidV1")
        if not isinstance(self.producer_commit, GitOidV1):
            raise ContractValueError("provenance producer_commit must be GitOidV1")
        if not isinstance(self.producer_tree, GitOidV1):
            raise ContractValueError("provenance producer_tree must be GitOidV1")
        if (
            not isinstance(self.source_artifact_sha256, tuple)
            or not 1 <= len(self.source_artifact_sha256) <= MAX_SOURCE_ARTIFACTS
            or any(not isinstance(item, DigestV1) for item in self.source_artifact_sha256)
        ):
            raise ContractValueError("source_artifact_sha256 must be a nonempty digest tuple")
        values = tuple(item.hexdigest for item in self.source_artifact_sha256)
        if values != tuple(sorted(set(values))):
            raise ContractValueError("source_artifact_sha256 must be sorted and unique")


@dataclass(frozen=True, slots=True)
class TrialEvidenceV1:
    declared_count: int
    observed_count: int
    ledger_sha256: DigestV1
    multiplicity_method: str
    multiplicity_state: GateState
    pbo_state: GateState
    global_test_state: GateState
    dsr_state: GateState

    def __post_init__(self) -> None:
        require_strict_int(
            self.declared_count,
            field="declared_count",
            minimum=1,
            maximum=MAX_TRIALS,
        )
        require_strict_int(
            self.observed_count,
            field="observed_count",
            minimum=0,
            maximum=MAX_TRIALS,
        )
        if self.observed_count > self.declared_count:
            raise ContractValueError("observed_count cannot exceed declared_count")
        if not isinstance(self.ledger_sha256, DigestV1):
            raise ContractValueError("ledger_sha256 must be DigestV1")
        if self.multiplicity_method != "HOLM_BONFERRONI":
            raise ContractValueError("multiplicity_method must be HOLM_BONFERRONI")
        for field_name in (
            "multiplicity_state",
            "pbo_state",
            "global_test_state",
            "dsr_state",
        ):
            if not isinstance(getattr(self, field_name), GateState):
                raise ContractValueError(f"{field_name} must be GateState")


@dataclass(frozen=True, slots=True)
class HoldoutEvidenceV1:
    evidence_class: EvidenceClass
    state: GateState
    single_use: bool | None
    opened_after_freeze: bool | None
    selection_inside_evaluation: bool | None
    reuse_count: int | None
    lower_bound: MetricV1

    def __post_init__(self) -> None:
        if not isinstance(self.evidence_class, EvidenceClass):
            raise ContractValueError("holdout evidence_class must be EvidenceClass")
        if not isinstance(self.state, GateState):
            raise ContractValueError("holdout state must be GateState")
        _require_bool_or_none(self.single_use, field="single_use")
        _require_bool_or_none(self.opened_after_freeze, field="opened_after_freeze")
        _require_bool_or_none(
            self.selection_inside_evaluation,
            field="selection_inside_evaluation",
        )
        if self.reuse_count is not None:
            require_strict_int(self.reuse_count, field="reuse_count", minimum=0, maximum=1_000)
        if not isinstance(self.lower_bound, MetricV1):
            raise ContractValueError("holdout lower_bound must be MetricV1")


@dataclass(frozen=True, slots=True)
class EconomicEvidenceV1:
    net: MetricV1
    stress_net: MetricV1
    capacity_usd: MetricV1
    max_drawdown_bps: MetricV1
    actual_fee_state: GateState
    cost_complete_state: GateState
    maker_entry_state: GateState
    regime_coverage_state: GateState

    def __post_init__(self) -> None:
        for field_name in ("net", "stress_net", "capacity_usd", "max_drawdown_bps"):
            if not isinstance(getattr(self, field_name), MetricV1):
                raise ContractValueError(f"{field_name} must be MetricV1")
        if self.capacity_usd.state is MetricState.MEASURED:
            require_strict_int(
                self.capacity_usd.value,
                field="measured capacity_usd",
                minimum=0,
            )
        if self.max_drawdown_bps.state is MetricState.MEASURED:
            require_strict_int(
                self.max_drawdown_bps.value,
                field="measured max_drawdown_bps",
                minimum=0,
                maximum=1_000_000,
            )
        for field_name in (
            "actual_fee_state",
            "cost_complete_state",
            "maker_entry_state",
            "regime_coverage_state",
        ):
            if not isinstance(getattr(self, field_name), GateState):
                raise ContractValueError(f"{field_name} must be GateState")


@dataclass(frozen=True, slots=True)
class ResultPacketV1:
    schema: str
    role: PacketRole
    milestone: str
    registry_id: str
    registry_sha256: DigestV1
    family_id: str
    candidate_id: str
    terminal_state: GateState
    provenance: ProvenanceV1
    trials: TrialEvidenceV1
    holdout: HoldoutEvidenceV1
    economics: EconomicEvidenceV1
    reason_codes: tuple[str, ...]
    raw_sha256: DigestV1
    semantic_sha256: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.schema, field="result schema")
        if not isinstance(self.role, PacketRole):
            raise ContractValueError("result role must be PacketRole")
        require_contract_id(self.milestone, field="milestone")
        require_contract_id(self.registry_id, field="registry_id")
        if not isinstance(self.registry_sha256, DigestV1):
            raise ContractValueError("registry_sha256 must be DigestV1")
        require_contract_id(self.family_id, field="family_id")
        require_contract_id(self.candidate_id, field="candidate_id")
        if not isinstance(self.terminal_state, GateState):
            raise ContractValueError("terminal_state must be GateState")
        if not isinstance(self.provenance, ProvenanceV1):
            raise ContractValueError("provenance must be ProvenanceV1")
        if not isinstance(self.trials, TrialEvidenceV1):
            raise ContractValueError("trials must be TrialEvidenceV1")
        if not isinstance(self.holdout, HoldoutEvidenceV1):
            raise ContractValueError("holdout must be HoldoutEvidenceV1")
        if not isinstance(self.economics, EconomicEvidenceV1):
            raise ContractValueError("economics must be EconomicEvidenceV1")
        _require_reason_codes(self.reason_codes, field="reason_codes")
        if not isinstance(self.raw_sha256, DigestV1) or not isinstance(
            self.semantic_sha256, DigestV1
        ):
            raise ContractValueError("result hashes must be DigestV1 values")


@dataclass(frozen=True, slots=True)
class CandidateAssessmentV1:
    role: PacketRole
    family_id: str
    candidate_id: str
    status: DecisionState
    reason_codes: tuple[str, ...]
    source_reason_codes: tuple[str, ...]
    raw_sha256: DigestV1
    semantic_sha256: DigestV1
    net: MetricV1
    holdout_lower_bound: MetricV1
    stress_net: MetricV1
    capacity_usd: MetricV1
    max_drawdown_bps: MetricV1

    def __post_init__(self) -> None:
        if not isinstance(self.role, PacketRole):
            raise ContractValueError("assessment role must be PacketRole")
        require_contract_id(self.family_id, field="assessment family_id")
        require_contract_id(self.candidate_id, field="assessment candidate_id")
        if not isinstance(self.status, DecisionState):
            raise ContractValueError("assessment status must be DecisionState")
        _require_reason_codes(self.reason_codes, field="assessment reason_codes")
        _require_reason_codes(
            self.source_reason_codes,
            field="assessment source_reason_codes",
        )
        if not isinstance(self.raw_sha256, DigestV1) or not isinstance(
            self.semantic_sha256, DigestV1
        ):
            raise ContractValueError("assessment hashes must be DigestV1 values")
        for field_name in (
            "net",
            "holdout_lower_bound",
            "stress_net",
            "capacity_usd",
            "max_drawdown_bps",
        ):
            if not isinstance(getattr(self, field_name), MetricV1):
                raise ContractValueError(f"assessment {field_name} must be MetricV1")
        if self.capacity_usd.state is MetricState.MEASURED:
            require_strict_int(
                self.capacity_usd.value,
                field="assessment capacity_usd",
                minimum=0,
            )
        if self.max_drawdown_bps.state is MetricState.MEASURED:
            require_strict_int(
                self.max_drawdown_bps.value,
                field="assessment max_drawdown_bps",
                minimum=0,
                maximum=1_000_000,
            )
        if self.status is DecisionState.VERIFIED_POSITIVE:
            if self.source_reason_codes:
                raise ContractValueError(
                    "VERIFIED_POSITIVE assessment requires empty source_reason_codes"
                )
            for field_name in ("net", "holdout_lower_bound", "stress_net", "capacity_usd"):
                metric = getattr(self, field_name)
                if metric.state is not MetricState.MEASURED or metric.value is None:
                    raise ContractValueError(
                        f"VERIFIED_POSITIVE assessment requires measured {field_name}"
                    )
                if metric.value <= 0:
                    raise ContractValueError(
                        f"VERIFIED_POSITIVE assessment requires positive {field_name}"
                    )
            if self.max_drawdown_bps.state is not MetricState.MEASURED:
                raise ContractValueError(
                    "VERIFIED_POSITIVE assessment requires measured max_drawdown_bps"
                )


@dataclass(frozen=True, slots=True, init=False)
class IntakeDecisionV1:
    registry_raw_sha256: DigestV1
    registry_semantic_sha256: DigestV1
    registry_pin: ArtifactPinV1
    result_pins: tuple[ArtifactPinV1, ...]
    status: DecisionState
    reason_codes: tuple[str, ...]
    assessments: tuple[CandidateAssessmentV1, ...]
    credible_positive_count: int | None
    authority: str = "NONE"

    def __init__(
        self,
        registry_raw_sha256: DigestV1,
        registry_semantic_sha256: DigestV1,
        registry_pin: ArtifactPinV1,
        result_pins: tuple[ArtifactPinV1, ...],
        status: DecisionState,
        reason_codes: tuple[str, ...],
        assessments: tuple[CandidateAssessmentV1, ...],
        credible_positive_count: int | None,
        authority: str = "NONE",
        *,
        _token: object | None = None,
    ) -> None:
        if _token is not _INTAKE_DECISION_TOKEN:
            raise ContractValueError("intake decisions must be engine-derived")
        object.__setattr__(self, "registry_raw_sha256", registry_raw_sha256)
        object.__setattr__(self, "registry_semantic_sha256", registry_semantic_sha256)
        object.__setattr__(self, "registry_pin", registry_pin)
        object.__setattr__(self, "result_pins", result_pins)
        object.__setattr__(self, "status", status)
        object.__setattr__(self, "reason_codes", reason_codes)
        object.__setattr__(self, "assessments", assessments)
        object.__setattr__(self, "credible_positive_count", credible_positive_count)
        object.__setattr__(self, "authority", authority)
        self.__post_init__()

    def __post_init__(self) -> None:
        if not isinstance(self.registry_raw_sha256, DigestV1) or not isinstance(
            self.registry_semantic_sha256, DigestV1
        ):
            raise ContractValueError("decision registry hashes must be DigestV1 values")
        if not isinstance(self.registry_pin, ArtifactPinV1):
            raise ContractValueError("decision registry_pin must be ArtifactPinV1")
        if self.registry_pin.role is not ArtifactRole.S_META1:
            raise ContractValueError("decision registry pin role must be S_META1")
        if self.registry_pin.raw_sha256 != self.registry_raw_sha256:
            raise ContractValueError("decision registry pin raw hash must match registry")
        if self.registry_pin.acceptance is AcceptanceState.REJECTED:
            raise ContractValueError("decision cannot retain a REJECTED registry pin")
        if not isinstance(self.status, DecisionState):
            raise ContractValueError("decision status must be DecisionState")
        _require_reason_codes(self.reason_codes, field="decision reason_codes")
        if not isinstance(self.assessments, tuple) or len(self.assessments) != len(
            PACKET_ROLE_ORDER
        ):
            raise ContractValueError("decision assessments must contain every N3-I1 role")
        if any(not isinstance(item, CandidateAssessmentV1) for item in self.assessments):
            raise ContractValueError("decision assessments must contain CandidateAssessmentV1")
        expected = tuple(sorted(self.assessments, key=lambda item: _PACKET_ROLE_INDEX[item.role]))
        if self.assessments != expected or len({item.role for item in expected}) != len(expected):
            raise ContractValueError("decision assessments must have unique roles in fixed order")
        if tuple(item.role for item in expected) != PACKET_ROLE_ORDER:
            raise ContractValueError("decision assessments must contain PACKET_ROLE_ORDER")
        if not isinstance(self.result_pins, tuple) or len(self.result_pins) != len(
            PACKET_ROLE_ORDER
        ):
            raise ContractValueError("decision result_pins must contain every N3-I1 role")
        if any(not isinstance(pin, ArtifactPinV1) for pin in self.result_pins):
            raise ContractValueError("decision result_pins must contain ArtifactPinV1 values")
        expected_artifact_roles = tuple(ArtifactRole(role.value) for role in PACKET_ROLE_ORDER)
        if tuple(pin.role for pin in self.result_pins) != expected_artifact_roles:
            raise ContractValueError("decision result_pins must have unique roles in fixed order")
        for assessment, pin in zip(self.assessments, self.result_pins, strict=True):
            if pin.raw_sha256 != assessment.raw_sha256:
                raise ContractValueError("decision result pin raw hash must match its assessment")
            if pin.acceptance is AcceptanceState.REJECTED:
                raise ContractValueError("decision cannot retain a REJECTED result pin")
        blockers: list[str] = []
        if self.registry_pin.acceptance is AcceptanceState.PENDING:
            blockers.append("REGISTRY_ACCEPTANCE_PENDING")
        for role, assessment, pin in zip(
            PACKET_ROLE_ORDER,
            self.assessments,
            self.result_pins,
            strict=True,
        ):
            if pin.acceptance is AcceptanceState.PENDING:
                blockers.append(f"{role.value}_ACCEPTANCE_PENDING")
            if assessment.status is DecisionState.UNKNOWN:
                blockers.append(f"{role.value}_ASSESSMENT_UNKNOWN")
        expected_blockers = tuple(sorted(set(blockers)))
        if expected_blockers:
            if self.status is not DecisionState.UNKNOWN:
                raise ContractValueError("unresolved custody or assessment requires UNKNOWN")
            if self.credible_positive_count is not None:
                raise ContractValueError("UNKNOWN decision requires null credible_positive_count")
            if self.reason_codes != expected_blockers:
                raise ContractValueError(
                    "UNKNOWN decision reasons must equal its unresolved blockers"
                )
        else:
            if self.status is DecisionState.UNKNOWN:
                raise ContractValueError("UNKNOWN decision requires an unresolved blocker")
            count = require_strict_int(
                self.credible_positive_count,
                field="credible_positive_count",
                minimum=0,
                maximum=len(self.assessments),
            )
            observed_count = sum(
                item.status is DecisionState.VERIFIED_POSITIVE for item in self.assessments
            )
            if count != observed_count:
                raise ContractValueError(
                    "credible_positive_count must equal VERIFIED_POSITIVE assessments"
                )
            expected_status = DecisionState.VERIFIED_POSITIVE if count > 0 else DecisionState.NO_GO
            expected_reasons = (
                ("CREDIBLE_POSITIVE_PRESENT",) if count > 0 else ("NO_CREDIBLE_POSITIVE",)
            )
            if self.status is not expected_status:
                raise ContractValueError("decision status must match its credible positive count")
            if self.reason_codes != expected_reasons:
                raise ContractValueError("decision reasons must match its determinate status")
        if self.authority != "NONE":
            raise ContractValueError("N3-I1 authority must be NONE")


def _derive_intake_decision(
    *,
    registry_raw_sha256: DigestV1,
    registry_semantic_sha256: DigestV1,
    registry_pin: ArtifactPinV1,
    result_pins: tuple[ArtifactPinV1, ...],
    status: DecisionState,
    reason_codes: tuple[str, ...],
    assessments: tuple[CandidateAssessmentV1, ...],
    credible_positive_count: int | None,
) -> IntakeDecisionV1:
    """Construct an engine-derived decision after byte intake and assessment."""

    return IntakeDecisionV1(
        registry_raw_sha256=registry_raw_sha256,
        registry_semantic_sha256=registry_semantic_sha256,
        registry_pin=registry_pin,
        result_pins=result_pins,
        status=status,
        reason_codes=reason_codes,
        assessments=assessments,
        credible_positive_count=credible_positive_count,
        authority="NONE",
        _token=_INTAKE_DECISION_TOKEN,
    )
