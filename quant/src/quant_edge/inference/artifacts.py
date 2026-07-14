"""Hash-pinned, JSON-only Q16 serving lineage over accepted artifacts."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object, require_exact_keys
from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.inference.contracts import (
    ModelAvailability,
    ServingLineageV1,
    _seal_serving_lineage,
)
from quant_edge.lake.contracts import DigestV1, require_contract_id
from quant_edge.registry_ops.artifacts import ArtifactIntegrityError, read_verified_artifact
from quant_edge.registry_ops.contracts import ArtifactKind, ArtifactRefV1

SERVING_ARTIFACTS: Final[tuple[tuple[str, ArtifactKind, str, int, str, str], ...]] = (
    (
        "q04.replay-golden.v1",
        ArtifactKind.DATASET,
        "Q04ReplayGoldenFixtureV1",
        1,
        "fixtures/q04_replay_golden_v1.json",
        "application/json",
    ),
    (
        "q06.feature-golden.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureGoldenFixtureV1",
        1,
        "fixtures/q06_feature_golden_v1.json",
        "application/json",
    ),
    (
        "q06.source.baselines.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureBaselinesSourceV1",
        1,
        "src/quant_edge/features/baselines.py",
        "text/x-python",
    ),
    (
        "q06.source.diagnostics.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureDiagnosticsSourceV1",
        1,
        "src/quant_edge/features/diagnostics.py",
        "text/x-python",
    ),
    (
        "q06.source.domains.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureDomainsSourceV1",
        1,
        "src/quant_edge/features/domains.py",
        "text/x-python",
    ),
    (
        "q06.source.fixedpoint.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureFixedpointSourceV1",
        1,
        "src/quant_edge/features/fixedpoint.py",
        "text/x-python",
    ),
    (
        "q06.source.harness.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureHarnessSourceV1",
        1,
        "src/quant_edge/features/harness.py",
        "text/x-python",
    ),
    (
        "q06.source.init.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureInitSourceV1",
        1,
        "src/quant_edge/features/__init__.py",
        "text/x-python",
    ),
    (
        "q06.source.primitives.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeaturePrimitivesSourceV1",
        1,
        "src/quant_edge/features/primitives.py",
        "text/x-python",
    ),
    (
        "q06.source.registry.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureRegistrySourceV1",
        1,
        "src/quant_edge/features/registry.py",
        "text/x-python",
    ),
    (
        "q06.source.values.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q06FeatureValuesSourceV1",
        1,
        "src/quant_edge/features/values.py",
        "text/x-python",
    ),
    (
        "q07.micro-golden.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroGoldenFixtureV1",
        1,
        "fixtures/q07_micro_golden_v1.json",
        "application/json",
    ),
    (
        "q07.source.bookfeat.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroBookfeatSourceV1",
        1,
        "src/quant_edge/micro/bookfeat.py",
        "text/x-python",
    ),
    (
        "q07.source.equivalence.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroEquivalenceSourceV1",
        1,
        "src/quant_edge/micro/equivalence.py",
        "text/x-python",
    ),
    (
        "q07.source.families.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroFamiliesSourceV1",
        1,
        "src/quant_edge/micro/families.py",
        "text/x-python",
    ),
    (
        "q07.source.flow.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroFlowSourceV1",
        1,
        "src/quant_edge/micro/flow.py",
        "text/x-python",
    ),
    (
        "q07.source.init.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroInitSourceV1",
        1,
        "src/quant_edge/micro/__init__.py",
        "text/x-python",
    ),
    (
        "q07.source.inputs.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroInputsSourceV1",
        1,
        "src/quant_edge/micro/inputs.py",
        "text/x-python",
    ),
    (
        "q07.source.l1.v1",
        ArtifactKind.FEATURE_REGISTRY,
        "Q07MicroL1SourceV1",
        1,
        "src/quant_edge/micro/l1.py",
        "text/x-python",
    ),
    (
        "q12.ensemble-golden.v1",
        ArtifactKind.MODEL_EVIDENCE,
        "Q12EnsembleGoldenFixtureV1",
        1,
        "fixtures/q12_ensemble_golden_v1.json",
        "application/json",
    ),
    (
        "q13.data-sufficiency.v1",
        ArtifactKind.VALIDATION_REPORT,
        "Q13DeepDataSufficiencyReportV1",
        1,
        "generated/q13/data_sufficiency.v1.json",
        "application/json",
    ),
    (
        "q15.registry-campaign.v1",
        ArtifactKind.EXPERIMENT,
        "Q15RegistryCampaignV1",
        1,
        "generated/q15/registry_campaign.v1.json",
        "application/json",
    ),
    (
        "q15.registry-cards.v1",
        ArtifactKind.MODEL_EVIDENCE,
        "Q15RegistryCardsV1",
        1,
        "generated/q15/registry_cards.v1.json",
        "application/json",
    ),
    (
        "q16.dependency-lock.v1",
        ArtifactKind.DEPENDENCY_LOCK,
        "UvLockV1",
        1,
        "uv.lock",
        "text/plain",
    ),
    *tuple(
        (
            f"q16.source.inference.{module}.v1",
            ArtifactKind.MODEL_EVIDENCE,
            f"Q16Inference{module.title()}SourceV1",
            1,
            f"src/quant_edge/inference/{module}.py",
            "text/x-python",
        )
        for module in (
            "artifacts",
            "contracts",
            "generation",
            "pipeline",
            "protocol",
            "service",
            "transport",
        )
    ),
    (
        "q16.source.inference.init.v1",
        ArtifactKind.MODEL_EVIDENCE,
        "Q16InferenceInitSourceV1",
        1,
        "src/quant_edge/inference/__init__.py",
        "text/x-python",
    ),
)

EXPECTED_SHA256: Final[dict[str, str]] = {
    "q04.replay-golden.v1": "32e134938d9e2ba5e9f32fb279bfa9bf9c6dcc8abe0d220107382d7f78fa6aec",
    "q06.feature-golden.v1": "06c81655ebb61a6311f29f7964d99b6d4dca94d7a1f8c2416d922fda3fcbabb3",
    "q06.source.baselines.v1": "7b28186ebec44d6f4b8ac227ee329118b6de8eafa362ab7b4ac39a91a9c46b7f",
    "q06.source.diagnostics.v1": "2c0b80b9da27041fd91d8a7b44a49069473321abb91751b3cc28f947b7d4576a",
    "q06.source.domains.v1": "3068967f25275771dd9536d7dd4496740581bff5d36d705f0604320e0191f3cc",
    "q06.source.fixedpoint.v1": "ef5678593723ac0393814cd4cb1050f72d5cd172c32081edc623e7d13af3c92b",
    "q06.source.harness.v1": "cf71221fe9336c4b54d8f819edba9f4d9afbf00d92912c3292c744e51b13e7e1",
    "q06.source.init.v1": "0c152b0947c945bc392cb0c6caaa8dd9e35a4ac56d18da0197f114f106baafc0",
    "q06.source.primitives.v1": "e996020f3a9b7226a8730c03ca54652b97bde314799eff27b6978aaaa4c9fa01",
    "q06.source.registry.v1": "ac7c3acf685f90a26183446510cbc92bfa741cedaee807e5f6fb1b3e56fe9961",
    "q06.source.values.v1": "44fc57eeda5d4fc0ecf45b79bb45c01a4570831d72b89f4ac8cd6a5a4c17ebfb",
    "q07.micro-golden.v1": "d8308437461b8d6aebd3814ef91044208255f34290ff9d260b167b21723f4ce3",
    "q07.source.bookfeat.v1": "c6edb81471bfe234fde67de43f753a63f4a8039c03fb87846e917d8f7c2af7f6",
    "q07.source.equivalence.v1": "f721b4a3f606d9f99b29b17092b6ae51d5158bc22f83b06b4475ac3b7fdeb5b6",
    "q07.source.families.v1": "4224fc2328d483b81399e70c4a8a671c8a994cf3d86dcda047c471bcfec80ee6",
    "q07.source.flow.v1": "30a3a333585fa70e033e969b7cd5cfea19b5146f5b33fa77757dbb396210d835",
    "q07.source.init.v1": "2031ea1222dff535a93e906da1bc80a88364d04ce95f5b62614274a157f0c6a8",
    "q07.source.inputs.v1": "56a995b61694a0c478397a37491fc7b22e6bc683c01982c31d2f9af48d447a65",
    "q07.source.l1.v1": "12312b1ec911f460b6e3c3fd300942d26e2c2db1aea0a3ffada36032224810e5",
    "q12.ensemble-golden.v1": "88382d291f6d0ddb4443888df80ce1d03bc893790ca746d13237b23b58d2bb77",
    "q13.data-sufficiency.v1": "126e27674a99f18accfc21638cbb5bdb1d1bda0f563a03284a7e4ad75665365d",
    "q15.registry-campaign.v1": "24debb2a96b91338d937b67878c75be2ef38615880c9c0ad8cd30590ac0bd11b",
    "q15.registry-cards.v1": "0457f22f9b713955f654d99b7dcfe9795d84c71c7ec8baf5a927e007d5a08fb5",
    "q16.dependency-lock.v1": "716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29",
}

EXPECTED_BYTES: Final[dict[str, int]] = {
    "q04.replay-golden.v1": 14_050,
    "q06.feature-golden.v1": 5_486,
    "q06.source.baselines.v1": 12_134,
    "q06.source.diagnostics.v1": 9_872,
    "q06.source.domains.v1": 16_497,
    "q06.source.fixedpoint.v1": 3_596,
    "q06.source.harness.v1": 4_422,
    "q06.source.init.v1": 3_595,
    "q06.source.primitives.v1": 11_772,
    "q06.source.registry.v1": 7_875,
    "q06.source.values.v1": 5_029,
    "q07.micro-golden.v1": 26_326,
    "q07.source.bookfeat.v1": 13_653,
    "q07.source.equivalence.v1": 5_687,
    "q07.source.families.v1": 8_918,
    "q07.source.flow.v1": 18_945,
    "q07.source.init.v1": 2_749,
    "q07.source.inputs.v1": 11_073,
    "q07.source.l1.v1": 7_456,
    "q12.ensemble-golden.v1": 153_049,
    "q13.data-sufficiency.v1": 1_813,
    "q15.registry-campaign.v1": 4_322,
    "q15.registry-cards.v1": 16_676,
    "q16.dependency-lock.v1": 123_424,
}

FEATURE_OWNER: Final = "quant_edge.features+quant_edge.micro"
MODEL_OWNER: Final = "quant_edge.registry_ops"
CALIBRATION_OWNER: Final = "quant_edge.ensemble"


class ServingArtifactError(QuantEdgeError):
    """Serving artifact or cross-artifact lineage failed closed."""


def _require_manifest_keys(
    value: dict[str, object],
    *,
    expected: tuple[str, ...],
    path: str,
) -> None:
    try:
        require_exact_keys(value, expected=expected, path=path)
    except QuantEdgeError as error:
        raise ServingArtifactError(f"{path} fields are not schema exact") from error


@dataclass(frozen=True, slots=True)
class ServingManifestV1:
    artifacts: tuple[ArtifactRefV1, ...]
    feature_owner: str
    model_owner: str
    calibration_owner: str

    def __post_init__(self) -> None:
        if not isinstance(self.artifacts, tuple) or len(self.artifacts) != len(SERVING_ARTIFACTS):
            raise ContractValueError("serving manifest must contain the exact artifact inventory")
        ids = tuple(artifact.artifact_id for artifact in self.artifacts)
        if ids != tuple(sorted(ids)) or len(set(ids)) != len(ids):
            raise ContractValueError("serving artifacts must be sorted by unique ID")
        require_contract_id(self.feature_owner, field="feature_owner")
        require_contract_id(self.model_owner, field="model_owner")
        require_contract_id(self.calibration_owner, field="calibration_owner")

    def artifact(self, artifact_id: str) -> ArtifactRefV1:
        for artifact in self.artifacts:
            if artifact.artifact_id == artifact_id:
                return artifact
        raise ServingArtifactError(f"serving artifact {artifact_id} is absent")

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifacts": [artifact.as_mapping() for artifact in self.artifacts],
            "calibrationOwner": self.calibration_owner,
            "featureOwner": self.feature_owner,
            "modelOwner": self.model_owner,
            "posture": "SYNTHETIC_ONLY",
            "schema": "Q16ServingManifestV1",
            "version": 1,
        }

    @property
    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes).hexdigest())


def _safe_path(root: Path, relative_path: str) -> Path:
    parsed = PurePosixPath(relative_path)
    if (
        parsed.is_absolute()
        or not parsed.parts
        or any(part in ("", ".", "..") for part in parsed.parts)
        or "\\" in relative_path
        or "://" in relative_path
    ):
        raise ServingArtifactError("artifact path is not a safe relative POSIX path")
    return root.joinpath(*parsed.parts)


def build_serving_manifest(quant_root: Path) -> ServingManifestV1:
    if not isinstance(quant_root, Path) or not quant_root.is_absolute():
        raise ContractValueError("quant_root must be an absolute pathlib.Path")
    artifacts: list[ArtifactRefV1] = []
    for (
        artifact_id,
        kind,
        schema_name,
        schema_version,
        relative_path,
        media_type,
    ) in SERVING_ARTIFACTS:
        path = _safe_path(quant_root, relative_path)
        try:
            raw = path.read_bytes()
        except OSError as error:
            raise ServingArtifactError(f"artifact {artifact_id} is unavailable") from error
        if not raw:
            raise ServingArtifactError(f"artifact {artifact_id} is empty")
        observed_digest = hashlib.sha256(raw).hexdigest()
        expected_digest = EXPECTED_SHA256.get(artifact_id)
        if expected_digest is not None and observed_digest != expected_digest:
            raise ServingArtifactError(f"artifact {artifact_id} differs from its accepted digest")
        expected_size = EXPECTED_BYTES.get(artifact_id)
        if expected_size is not None and len(raw) != expected_size:
            raise ServingArtifactError(f"artifact {artifact_id} differs from its accepted size")
        artifacts.append(
            ArtifactRefV1(
                artifact_id=artifact_id,
                kind=kind,
                schema_name=schema_name,
                schema_version=schema_version,
                relative_path=relative_path,
                sha256=DigestV1(observed_digest),
                byte_length=len(raw),
                media_type=media_type,
            )
        )
    return ServingManifestV1(
        artifacts=tuple(sorted(artifacts, key=lambda item: item.artifact_id)),
        feature_owner=FEATURE_OWNER,
        model_owner=MODEL_OWNER,
        calibration_owner=CALIBRATION_OWNER,
    )


def manifest_from_mapping(value: dict[str, object]) -> ServingManifestV1:
    _require_manifest_keys(
        value,
        expected=(
            "artifacts",
            "calibrationOwner",
            "featureOwner",
            "modelOwner",
            "posture",
            "schema",
            "version",
        ),
        path="$",
    )
    if (
        value["schema"] != "Q16ServingManifestV1"
        or type(value["version"]) is not int
        or value["version"] != 1
        or value["posture"] != "SYNTHETIC_ONLY"
    ):
        raise ServingArtifactError("serving manifest schema/version/posture mismatch")
    rows = value["artifacts"]
    if not isinstance(rows, list):
        raise ServingArtifactError("serving manifest artifacts must be an array")
    artifacts: list[ArtifactRefV1] = []
    for row in rows:
        if not isinstance(row, dict):
            raise ServingArtifactError("serving manifest artifact must be an object")
        _require_manifest_keys(
            row,
            expected=(
                "artifactId",
                "byteLength",
                "kind",
                "mediaType",
                "relativePath",
                "schemaName",
                "schemaVersion",
                "sha256",
            ),
            path="$.artifacts[]",
        )
        try:
            kind = ArtifactKind(row["kind"])
            digest = DigestV1(cast(str, row["sha256"]))
        except (TypeError, ValueError, ContractValueError) as error:
            raise ServingArtifactError("serving artifact enum/digest is invalid") from error
        text_fields = {
            key: row[key] for key in ("artifactId", "mediaType", "relativePath", "schemaName")
        }
        if any(not isinstance(item, str) for item in text_fields.values()):
            raise ServingArtifactError("serving artifact text fields are invalid")
        byte_length = row["byteLength"]
        schema_version = row["schemaVersion"]
        if isinstance(byte_length, bool) or not isinstance(byte_length, int):
            raise ServingArtifactError("serving artifact byteLength must be integer")
        if isinstance(schema_version, bool) or not isinstance(schema_version, int):
            raise ServingArtifactError("serving artifact schemaVersion must be integer")
        artifacts.append(
            ArtifactRefV1(
                artifact_id=cast(str, row["artifactId"]),
                kind=kind,
                schema_name=cast(str, row["schemaName"]),
                schema_version=schema_version,
                relative_path=cast(str, row["relativePath"]),
                sha256=digest,
                byte_length=byte_length,
                media_type=cast(str, row["mediaType"]),
            )
        )
    owner_values = (value["featureOwner"], value["modelOwner"], value["calibrationOwner"])
    if any(not isinstance(item, str) for item in owner_values):
        raise ServingArtifactError("serving owner fields must be text")
    manifest = ServingManifestV1(
        artifacts=tuple(artifacts),
        feature_owner=cast(str, value["featureOwner"]),
        model_owner=cast(str, value["modelOwner"]),
        calibration_owner=cast(str, value["calibrationOwner"]),
    )
    expected_ids = tuple(sorted(item[0] for item in SERVING_ARTIFACTS))
    if tuple(item.artifact_id for item in manifest.artifacts) != expected_ids:
        raise ServingArtifactError("serving artifact inventory is not exact")
    if any(
        item.artifact_id in EXPECTED_SHA256
        and item.sha256.hexdigest != EXPECTED_SHA256[item.artifact_id]
        for item in manifest.artifacts
    ):
        raise ServingArtifactError("serving manifest artifact digest is not accepted")
    expected_metadata = {
        artifact_id: (
            kind,
            schema_name,
            schema_version,
            relative_path,
            media_type,
            EXPECTED_BYTES.get(artifact_id),
        )
        for artifact_id, kind, schema_name, schema_version, relative_path, media_type in (
            SERVING_ARTIFACTS
        )
    }
    for item in manifest.artifacts:
        expected = expected_metadata[item.artifact_id]
        observed_metadata = (
            item.kind,
            item.schema_name,
            item.schema_version,
            item.relative_path,
            item.media_type,
        )
        if observed_metadata != expected[:5] or (
            expected[5] is not None and item.byte_length != expected[5]
        ):
            raise ServingArtifactError("serving manifest artifact metadata is not accepted")
    if (
        manifest.feature_owner != FEATURE_OWNER
        or manifest.model_owner != MODEL_OWNER
        or manifest.calibration_owner != CALIBRATION_OWNER
    ):
        raise ServingArtifactError("serving manifest owner identity is not accepted")
    return manifest


def load_manifest(path: Path) -> ServingManifestV1:
    if not isinstance(path, Path) or not path.is_absolute():
        raise ContractValueError("manifest path must be absolute")
    try:
        if path.is_symlink() or not path.is_file():
            raise ServingArtifactError("serving manifest must be a real regular file")
        raw = path.read_bytes()
    except OSError as error:
        raise ServingArtifactError("serving manifest is unavailable") from error
    try:
        return manifest_from_mapping(parse_canonical_object(raw))
    except QuantEdgeError as error:
        raise ServingArtifactError("serving manifest is not canonical and schema exact") from error


def _verified_json(
    quant_root: Path,
    manifest: ServingManifestV1,
    artifact_id: str,
) -> dict[str, object]:
    reference = manifest.artifact(artifact_id)
    if reference.media_type != "application/json":
        raise ServingArtifactError(f"artifact {artifact_id} is not allowlisted JSON")
    try:
        raw = read_verified_artifact(quant_root, reference)
        value = parse_canonical_object(raw)
    except (ArtifactIntegrityError, QuantEdgeError) as error:
        raise ServingArtifactError(f"artifact {artifact_id} failed integrity") from error
    body_version = value.get("version")
    if value.get("schema") != reference.schema_name or (
        body_version is not None
        and (type(body_version) is not int or body_version != reference.schema_version)
    ):
        raise ServingArtifactError(f"artifact {artifact_id} schema/version mismatch")
    return value


def verify_manifest_artifacts(quant_root: Path, manifest: ServingManifestV1) -> None:
    if not isinstance(quant_root, Path) or not quant_root.is_absolute():
        raise ContractValueError("quant_root must be absolute")
    for reference in manifest.artifacts:
        try:
            read_verified_artifact(quant_root, reference)
        except ArtifactIntegrityError as error:
            raise ServingArtifactError(
                f"artifact {reference.artifact_id} failed safe bounded verification"
            ) from error


def load_serving_lineage(quant_root: Path, manifest: ServingManifestV1) -> ServingLineageV1:
    require_manifest_matches_current(quant_root, manifest)
    verify_manifest_artifacts(quant_root, manifest)
    campaign = _verified_json(quant_root, manifest, "q15.registry-campaign.v1")
    cards = _verified_json(quant_root, manifest, "q15.registry-cards.v1")
    deep = _verified_json(quant_root, manifest, "q13.data-sufficiency.v1")
    ensemble = _verified_json(quant_root, manifest, "q12.ensemble-golden.v1")
    champion = campaign.get("finalChampion")
    lifecycles = campaign.get("lifecycles")
    model_cards = cards.get("modelCards")
    calibration = ensemble.get("calibration")
    if not all(isinstance(item, dict | list) for item in (champion, lifecycles, model_cards)):
        raise ServingArtifactError("accepted registry champion/card lifecycle is malformed")
    if (
        not isinstance(champion, dict)
        or not isinstance(lifecycles, list)
        or not isinstance(model_cards, list)
    ):
        raise ServingArtifactError("accepted registry lineage types are malformed")
    model_id = champion.get("modelId")
    model_revision = champion.get("modelRevision")
    posture = champion.get("posture")
    if not all(isinstance(item, str) for item in (model_id, model_revision, posture)):
        raise ServingArtifactError("accepted champion identity is malformed")
    matching_cards = [
        card
        for card in model_cards
        if isinstance(card, dict)
        and card.get("modelId") == model_id
        and card.get("modelRevision") == model_revision
    ]
    if len(matching_cards) != 1:
        raise ServingArtifactError("accepted champion must have exactly one model card")
    loadable = matching_cards[0].get("loadableModelPayload")
    if not isinstance(loadable, bool):
        raise ServingArtifactError("accepted champion loadability is malformed")
    availability = (
        ModelAvailability.AVAILABLE if loadable else ModelAvailability.UNAVAILABLE_NONLOADABLE
    )
    shadows = tuple(
        sorted(
            cast(str, row["modelId"])
            for row in lifecycles
            if isinstance(row, dict)
            and row.get("lifecycle") == "SHADOW_CHALLENGER"
            and isinstance(row.get("modelId"), str)
        )
    )
    if len(shadows) != 2 or len(set(shadows)) != len(shadows):
        raise ServingArtifactError("accepted shadow inventory is ambiguous")
    deep_status = deep.get("status")
    if deep_status != "FAIL_DATA_INSUFFICIENT" or deep.get("trainingPermitted") is not False:
        raise ServingArtifactError("deep gate does not retain accepted fail-closed truth")
    if not isinstance(calibration, dict) or not isinstance(calibration.get("chosenMethod"), str):
        raise ServingArtifactError("accepted calibration lineage is malformed")
    dependency = manifest.artifact("q16.dependency-lock.v1").sha256
    champion_model_id = cast(str, model_id)
    champion_revision = cast(str, model_revision)
    champion_posture = cast(str, posture)
    calibration_revision = f"q12.{calibration['chosenMethod']}.synthetic.v1"
    identity: tuple[object, ...] = (
        champion_model_id,
        champion_revision,
        champion_posture,
        availability.value,
        shadows,
        deep_status,
        calibration_revision,
        False,
        dependency.hexdigest,
        manifest.digest.hexdigest,
    )
    return ServingLineageV1(
        champion_model_id=champion_model_id,
        champion_revision=champion_revision,
        champion_posture=champion_posture,
        champion_availability=availability,
        shadow_model_ids=shadows,
        deep_gate=deep_status,
        calibration_revision=calibration_revision,
        calibration_available=False,
        dependency_lock_sha256=dependency,
        manifest_sha256=manifest.digest,
        _seal=_seal_serving_lineage(identity),
    )


def require_manifest_matches_current(quant_root: Path, manifest: ServingManifestV1) -> None:
    expected = build_serving_manifest(quant_root)
    if manifest.canonical_bytes != expected.canonical_bytes:
        raise ServingArtifactError("serving manifest does not match the accepted current artifacts")
