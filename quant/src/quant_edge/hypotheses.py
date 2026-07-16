from collections import Counter
from dataclasses import dataclass
from typing import cast

from quant_edge.canonical import parse_canonical_object, require_exact_keys
from quant_edge.errors import CanonicalJsonError, ContractValueError, HypothesisRegistryError
from quant_edge.primitives import require_id, require_utc_millis

ALLOWED_STATUSES = (
    "UNTESTED",
    "DATA_INSUFFICIENT",
    "RESEARCH",
    "SHADOW",
    "REJECTED",
)

_FAMILY_KEYS = {
    "capacityAndCrowdingAssumptions",
    "continuationCriterion",
    "controls",
    "coverageAndMissingness",
    "economicMechanism",
    "economicsFloor",
    "grossOpportunityDefinition",
    "hypothesis",
    "id",
    "killRetirementCriterion",
    "minimumEffectiveEvidence",
    "multipleTestingFamily",
    "nullHypothesis",
    "primaryMetric",
    "promotionCriterion",
    "requiredSources",
    "status",
}

_REGISTRY_KEYS = {
    "allowedStatuses",
    "asOfMs",
    "families",
    "revision",
    "schema",
    "truthPosture",
    "version",
}


def _required_text(value: object, *, field: str) -> str:
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 2_048
        or value.strip() != value
        or "\n" in value
        or "\r" in value
    ):
        raise HypothesisRegistryError(f"{field} must be one normalized non-empty bounded line")
    return value


def _required_text_list(value: object, *, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not 1 <= len(value) <= 64:
        raise HypothesisRegistryError(f"{field} must be a non-empty bounded array")
    items = tuple(_required_text(item, field=f"{field}[]") for item in value)
    if len(set(items)) != len(items):
        raise HypothesisRegistryError(f"{field} contains duplicates")
    return items


@dataclass(frozen=True, slots=True)
class HypothesisFamily:
    family_id: str
    status: str
    hypothesis: str
    null_hypothesis: str
    economic_mechanism: str
    required_sources: tuple[str, ...]
    coverage_and_missingness: str
    gross_opportunity_definition: str
    economics_floor: tuple[str, ...]
    capacity_and_crowding_assumptions: str
    primary_metric: str
    controls: tuple[str, ...]
    multiple_testing_family: str
    minimum_effective_evidence: str
    promotion_criterion: str
    continuation_criterion: str
    kill_retirement_criterion: str

    @classmethod
    def from_object(cls, value: object, *, index: int) -> "HypothesisFamily":
        if not isinstance(value, dict):
            raise HypothesisRegistryError(f"families[{index}] must be an object")
        family = cast(dict[str, object], value)
        try:
            require_exact_keys(family, expected=_FAMILY_KEYS, path=f"families[{index}]")
            family_id = require_id(family["id"], field=f"families[{index}].id")
        except (CanonicalJsonError, KeyError, ContractValueError) as error:
            raise HypothesisRegistryError(str(error)) from error
        if not family_id.startswith("H"):
            raise HypothesisRegistryError(f"{family_id}: family ID must start with H")
        status = _required_text(family["status"], field=f"{family_id}.status")
        if status not in ALLOWED_STATUSES:
            raise HypothesisRegistryError(f"{family_id}: unsupported status {status}")
        return cls(
            family_id=family_id,
            status=status,
            hypothesis=_required_text(family["hypothesis"], field=f"{family_id}.hypothesis"),
            null_hypothesis=_required_text(
                family["nullHypothesis"], field=f"{family_id}.nullHypothesis"
            ),
            economic_mechanism=_required_text(
                family["economicMechanism"], field=f"{family_id}.economicMechanism"
            ),
            required_sources=_required_text_list(
                family["requiredSources"], field=f"{family_id}.requiredSources"
            ),
            coverage_and_missingness=_required_text(
                family["coverageAndMissingness"], field=f"{family_id}.coverageAndMissingness"
            ),
            gross_opportunity_definition=_required_text(
                family["grossOpportunityDefinition"],
                field=f"{family_id}.grossOpportunityDefinition",
            ),
            economics_floor=_required_text_list(
                family["economicsFloor"], field=f"{family_id}.economicsFloor"
            ),
            capacity_and_crowding_assumptions=_required_text(
                family["capacityAndCrowdingAssumptions"],
                field=f"{family_id}.capacityAndCrowdingAssumptions",
            ),
            primary_metric=_required_text(
                family["primaryMetric"], field=f"{family_id}.primaryMetric"
            ),
            controls=_required_text_list(family["controls"], field=f"{family_id}.controls"),
            multiple_testing_family=_required_text(
                family["multipleTestingFamily"], field=f"{family_id}.multipleTestingFamily"
            ),
            minimum_effective_evidence=_required_text(
                family["minimumEffectiveEvidence"],
                field=f"{family_id}.minimumEffectiveEvidence",
            ),
            promotion_criterion=_required_text(
                family["promotionCriterion"], field=f"{family_id}.promotionCriterion"
            ),
            continuation_criterion=_required_text(
                family["continuationCriterion"], field=f"{family_id}.continuationCriterion"
            ),
            kill_retirement_criterion=_required_text(
                family["killRetirementCriterion"],
                field=f"{family_id}.killRetirementCriterion",
            ),
        )


@dataclass(frozen=True, slots=True)
class HypothesisRegistry:
    revision: str
    as_of_ms: int
    families: tuple[HypothesisFamily, ...]

    @classmethod
    def from_canonical_bytes(cls, raw: bytes) -> "HypothesisRegistry":
        try:
            value = parse_canonical_object(raw)
            require_exact_keys(value, expected=_REGISTRY_KEYS, path="$")
            if value["schema"] != "EdgeHypothesisRegistryV1" or value["version"] != 1:
                raise HypothesisRegistryError("unsupported hypothesis registry schema/version")
            if value["truthPosture"] != "RESEARCH_PORTFOLIO_ONLY":
                raise HypothesisRegistryError("registry truth posture must remain research-only")
            statuses = value["allowedStatuses"]
            if statuses != list(ALLOWED_STATUSES):
                raise HypothesisRegistryError("allowedStatuses differs from the frozen status set")
            revision = require_id(value["revision"], field="revision")
            as_of_ms = require_utc_millis(value["asOfMs"], field="asOfMs")
        except (CanonicalJsonError, KeyError, ContractValueError) as error:
            raise HypothesisRegistryError(str(error)) from error
        families_value = value["families"]
        if not isinstance(families_value, list) or not 1 <= len(families_value) <= 64:
            raise HypothesisRegistryError("families must be a non-empty bounded array")
        families = tuple(
            HypothesisFamily.from_object(item, index=index)
            for index, item in enumerate(families_value)
        )
        ids = [family.family_id for family in families]
        if ids != sorted(ids):
            raise HypothesisRegistryError("families must be sorted by ID")
        if len(ids) != len(set(ids)):
            raise HypothesisRegistryError("family IDs must be unique")
        return cls(revision=revision, as_of_ms=as_of_ms, families=families)

    def verification_summary(self) -> dict[str, object]:
        counts = Counter(family.status for family in self.families)
        return {
            "familyCount": len(self.families),
            "registryRevision": self.revision,
            "schema": "HypothesisRegistryVerificationV1",
            "statusCounts": dict(sorted(counts.items())),
            "version": 1,
        }


def render_hypothesis_map(registry: HypothesisRegistry) -> str:
    lines = [
        "# Edge/Hypothesis Map",
        "",
        f"Registry revision: `{registry.revision}`",
        f"Registry as-of UTC milliseconds: `{registry.as_of_ms}`",
        "",
        (
            "Truth posture: `RESEARCH_PORTFOLIO_ONLY`. This deterministic projection is a "
            "falsification portfolio, not evidence that edge exists, a calibrated probability, "
            "or an actionable recommendation."
        ),
        "",
        (
            "Every substantive line below is rendered from the canonical machine registry. "
            "Manual prose or status edits fail verification."
        ),
    ]
    for family in registry.families:
        lines.extend(
            [
                "",
                f"### `{family.family_id}` — `{family.status}`",
                "",
                f"- **Hypothesis:** {family.hypothesis}",
                f"- **Null hypothesis:** {family.null_hypothesis}",
                f"- **Economic mechanism:** {family.economic_mechanism}",
                f"- **Required sources:** {'; '.join(family.required_sources)}",
                f"- **Coverage and missingness:** {family.coverage_and_missingness}",
                f"- **Gross opportunity definition:** {family.gross_opportunity_definition}",
                f"- **Economics floor:** {'; '.join(family.economics_floor)}",
                f"- **Capacity and crowding:** {family.capacity_and_crowding_assumptions}",
                f"- **Primary metric:** {family.primary_metric}",
                f"- **Controls:** {'; '.join(family.controls)}",
                f"- **Multiple-testing family:** {family.multiple_testing_family}",
                f"- **Minimum effective evidence:** {family.minimum_effective_evidence}",
                f"- **Promotion criterion:** {family.promotion_criterion}",
                f"- **Continuation criterion:** {family.continuation_criterion}",
                f"- **Kill/retirement criterion:** {family.kill_retirement_criterion}",
            ]
        )
    return "\n".join(lines) + "\n"


def verify_hypothesis_map(markdown: str, registry: HypothesisRegistry) -> None:
    if markdown != render_hypothesis_map(registry):
        raise HypothesisRegistryError(
            "Markdown differs from the exact deterministic registry projection"
        )
