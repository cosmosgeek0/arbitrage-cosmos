from __future__ import annotations

from pathlib import Path

import pytest

from quant_edge.canonical import parse_canonical_object
from quant_edge.inference.artifacts import (
    ServingManifestV1,
    build_serving_manifest,
    load_serving_lineage,
)
from quant_edge.inference.contracts import InferenceLimitsV1, ServingLineageV1
from quant_edge.inference.pipeline import PipelineResultV1, run_inference_pipeline
from quant_edge.inference.protocol import ProtocolContractV1
from quant_edge.inference.service import LocalInferenceServiceV1

QUANT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = QUANT_ROOT.parent


@pytest.fixture(scope="session")
def protocol() -> ProtocolContractV1:
    return ProtocolContractV1.load(REPO_ROOT)


@pytest.fixture(scope="session")
def serving_manifest() -> ServingManifestV1:
    return build_serving_manifest(QUANT_ROOT)


@pytest.fixture(scope="session")
def lineage(serving_manifest: ServingManifestV1) -> ServingLineageV1:
    return load_serving_lineage(QUANT_ROOT, serving_manifest)


@pytest.fixture(scope="session")
def raw_fixture() -> dict[str, object]:
    return parse_canonical_object(
        (QUANT_ROOT / "fixtures" / "q16_raw_fixture_v1.json").read_bytes()
    )


@pytest.fixture(scope="session")
def pipeline_result(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> PipelineResultV1:
    return run_inference_pipeline(raw_fixture, lineage=lineage, protocol=protocol)


@pytest.fixture
def service(
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> LocalInferenceServiceV1:
    return LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=2),
        lineage=lineage,
        protocol=protocol,
    )
