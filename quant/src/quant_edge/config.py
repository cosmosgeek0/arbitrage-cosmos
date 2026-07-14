from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.clock import Clock
from quant_edge.errors import ContractValueError
from quant_edge.primitives import UINT128_MAX, require_id, require_seed, require_utc_millis

TruthPosture = Literal["RESEARCH", "SYNTHETIC"]

_CONFIG_KEYS = {
    "asOfMs",
    "datasetRevision",
    "runId",
    "schema",
    "seed",
    "truthPosture",
    "version",
}


@dataclass(frozen=True, slots=True)
class ResearchConfig:
    run_id: str
    as_of_ms: int
    seed: int
    truth_posture: TruthPosture
    dataset_revision: str | None = None

    def __post_init__(self) -> None:
        require_id(self.run_id, field="run_id")
        require_utc_millis(self.as_of_ms, field="as_of_ms")
        require_seed(self.seed)
        if self.truth_posture not in ("RESEARCH", "SYNTHETIC"):
            raise ContractValueError("truth_posture must be RESEARCH or SYNTHETIC")
        if self.dataset_revision is not None:
            require_id(self.dataset_revision, field="dataset_revision")

    def as_mapping(self) -> dict[str, object]:
        return {
            "asOfMs": self.as_of_ms,
            "datasetRevision": self.dataset_revision,
            "runId": self.run_id,
            "schema": "QuantResearchConfigV1",
            "seed": str(self.seed),
            "truthPosture": self.truth_posture,
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "ResearchConfig":
        actual_keys = set(value)
        if actual_keys != _CONFIG_KEYS:
            missing = sorted(_CONFIG_KEYS - actual_keys)
            extra = sorted(actual_keys - _CONFIG_KEYS)
            raise ContractValueError(f"config keys differ; missing={missing}, extra={extra}")
        if value["schema"] != "QuantResearchConfigV1" or value["version"] != 1:
            raise ContractValueError("unsupported research config schema/version")
        seed_text = value["seed"]
        if (
            not isinstance(seed_text, str)
            or not seed_text.isascii()
            or not seed_text.isdecimal()
            or len(seed_text) > len(str(UINT128_MAX))
        ):
            raise ContractValueError("seed must be an unsigned decimal string")
        dataset_revision = value["datasetRevision"]
        if dataset_revision is not None and not isinstance(dataset_revision, str):
            raise ContractValueError("datasetRevision must be an IdString or null")
        posture = value["truthPosture"]
        if posture not in ("RESEARCH", "SYNTHETIC"):
            raise ContractValueError("truthPosture must be RESEARCH or SYNTHETIC")
        return cls(
            run_id=cast(str, value["runId"]),
            as_of_ms=require_utc_millis(value["asOfMs"], field="asOfMs"),
            seed=require_seed(int(seed_text)),
            truth_posture=posture,
            dataset_revision=dataset_revision,
        )


def make_research_config(
    *,
    clock: Clock,
    run_id: str,
    seed: int,
    truth_posture: TruthPosture,
    dataset_revision: str | None = None,
) -> ResearchConfig:
    return ResearchConfig(
        run_id=run_id,
        as_of_ms=clock.now_ms(),
        seed=seed,
        truth_posture=truth_posture,
        dataset_revision=dataset_revision,
    )
