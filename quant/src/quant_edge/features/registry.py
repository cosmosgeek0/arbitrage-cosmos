from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.domains import BarDomain
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int

MAX_CARDS: Final = 4_096
MAX_TEXT: Final = 2_000
MAX_LIST_ITEMS: Final = 64
MAX_TOLERANCE_ULP: Final = 10**9


def _require_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT:
        raise ContractValueError(f"{field} must be non-empty bounded text")
    return value


def _require_id_tuple(value: object, *, field: str) -> tuple[str, ...]:
    if not isinstance(value, tuple) or not value or len(value) > MAX_LIST_ITEMS:
        raise ContractValueError(f"{field} must be a non-empty bounded tuple")
    for item in value:
        _require_text(item, field=field)
    if tuple(sorted(value)) != value:
        raise ContractValueError(f"{field} must be sorted")
    return value


@dataclass(frozen=True, slots=True)
class FeatureCardV1:
    """The complete §12 card; a feature without every field does not exist."""

    name: str
    version: str
    economic_hypothesis: str
    inputs: tuple[str, ...]
    window_law: str
    domain: BarDomain
    normalization_cohort: str
    missing_behavior: str
    stale_behavior: str
    unit_id: str
    lower_bound: FixedPointV1 | None
    upper_bound: FixedPointV1 | None
    incremental_update_rule: str
    batch_reference: str
    streaming_implementation: str
    provenance: str
    computational_cost: str
    expected_failure_modes: tuple[str, ...]
    test_binding: str
    equivalence_tolerance_ulp: int

    def __post_init__(self) -> None:
        require_contract_id(self.name, field="name")
        require_contract_id(self.version, field="version")
        _require_text(self.economic_hypothesis, field="economic_hypothesis")
        _require_id_tuple(self.inputs, field="inputs")
        _require_text(self.window_law, field="window_law")
        if not isinstance(self.domain, BarDomain):
            raise ContractValueError("domain must be BarDomain")
        require_contract_id(self.normalization_cohort, field="normalization_cohort")
        _require_text(self.missing_behavior, field="missing_behavior")
        _require_text(self.stale_behavior, field="stale_behavior")
        require_contract_id(self.unit_id, field="unit_id")
        for bound_name in ("lower_bound", "upper_bound"):
            bound = getattr(self, bound_name)
            if bound is not None and not isinstance(bound, FixedPointV1):
                raise ContractValueError(f"{bound_name} must be FixedPointV1 or None")
        if (
            self.lower_bound is not None
            and self.upper_bound is not None
            and self.lower_bound.mantissa > self.upper_bound.mantissa
        ):
            raise ContractValueError("lower_bound must not exceed upper_bound")
        _require_text(self.incremental_update_rule, field="incremental_update_rule")
        require_contract_id(self.batch_reference, field="batch_reference")
        require_contract_id(self.streaming_implementation, field="streaming_implementation")
        _require_text(self.provenance, field="provenance")
        require_contract_id(self.computational_cost, field="computational_cost")
        _require_id_tuple(self.expected_failure_modes, field="expected_failure_modes")
        require_contract_id(self.test_binding, field="test_binding")
        require_strict_int(
            self.equivalence_tolerance_ulp,
            field="equivalence_tolerance_ulp",
            minimum=0,
            maximum=MAX_TOLERANCE_ULP,
        )

    @property
    def feature_id(self) -> str:
        return f"{self.name}:{self.version}"

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchReference": self.batch_reference,
            "computationalCost": self.computational_cost,
            "domain": self.domain.value,
            "economicHypothesis": self.economic_hypothesis,
            "equivalenceToleranceUlp": self.equivalence_tolerance_ulp,
            "expectedFailureModes": list(self.expected_failure_modes),
            "incrementalUpdateRule": self.incremental_update_rule,
            "inputs": list(self.inputs),
            "lowerBound": None if self.lower_bound is None else self.lower_bound.as_mapping(),
            "missingBehavior": self.missing_behavior,
            "name": self.name,
            "normalizationCohort": self.normalization_cohort,
            "provenance": self.provenance,
            "schema": "Q06FeatureCardV1",
            "staleBehavior": self.stale_behavior,
            "streamingImplementation": self.streaming_implementation,
            "testBinding": self.test_binding,
            "unitId": self.unit_id,
            "upperBound": None if self.upper_bound is None else self.upper_bound.as_mapping(),
            "version": self.version,
            "windowLaw": self.window_law,
        }


@dataclass(frozen=True, slots=True)
class FeatureRegistryV1:
    registry_version: str
    cards: tuple[FeatureCardV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.registry_version, field="registry_version")
        if not isinstance(self.cards, tuple) or not self.cards or len(self.cards) > MAX_CARDS:
            raise ContractValueError(f"cards must be a tuple of 1..{MAX_CARDS} feature cards")
        for card in self.cards:
            if not isinstance(card, FeatureCardV1):
                raise ContractValueError("cards must contain FeatureCardV1")
        identities = [card.feature_id for card in self.cards]
        if identities != sorted(set(identities)):
            raise ContractValueError("cards must be sorted by unique feature identity")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cards": [card.as_mapping() for card in self.cards],
            "registryVersion": self.registry_version,
            "schema": "Q06FeatureRegistryV1",
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def content_digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes()).hexdigest())


def render_registry_markdown(registry: FeatureRegistryV1) -> str:
    """Deterministic human projection; `verify_registry_markdown` rejects drift."""

    if not isinstance(registry, FeatureRegistryV1):
        raise ContractValueError("registry must be FeatureRegistryV1")
    lines = [
        "# Q06 feature registry",
        "",
        f"Registry version: `{registry.registry_version}`",
        "",
        f"Content SHA-256: `{registry.content_digest.hexdigest}`",
        "",
        "No feature listed here is claimed to be predictive, validated or economically",
        "valuable; cards are machinery contracts with streaming/batch equivalence law.",
        "",
        "| Feature | Domain | Cohort | Unit | Tolerance (ulp) | Batch | Streaming |",
        "| --- | --- | --- | --- | ---: | --- | --- |",
    ]
    for card in registry.cards:
        lines.append(
            f"| `{card.feature_id}` | {card.domain.value} | {card.normalization_cohort} "
            f"| {card.unit_id} | {card.equivalence_tolerance_ulp} "
            f"| `{card.batch_reference}` | `{card.streaming_implementation}` |"
        )
    lines.append("")
    return "\n".join(lines)


def verify_registry_markdown(markdown: str, registry: FeatureRegistryV1) -> None:
    if markdown != render_registry_markdown(registry):
        raise ContractValueError("registry markdown drifted from the canonical projection")
