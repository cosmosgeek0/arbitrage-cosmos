"""Exact-current Q00-Q17 component inventory for the final Q-lane proof.

The manifest is a projection of already accepted receipts and artifacts.  It does
not ask Git what is current at runtime and it does not infer acceptance from a
directory merely existing.  Commit identities are pinned constants; accepted
phase references, the current Q17 task and every accepted package tree are
reverified from current regular, non-symlink bytes.  Q17 activation-task metadata
is explicitly historical and is never relabeled as the current task reference.
"""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object, require_exact_keys
from quant_edge.errors import CanonicalJsonError, QuantEdgeError


class ComponentManifestError(QuantEdgeError):
    """A component identity, evidence byte, or manifest claim failed closed."""


PENDING: Final = "PENDING_NOT_EMBEDDED"
MAX_EVIDENCE_BYTES: Final = 1_048_576
MAX_SOURCE_BYTES: Final = 1_048_576
_SHA256_LENGTH: Final = 64

_POST_ACCEPTANCE_IMPLEMENTATION_STATE: Final = (
    "CORRECTION_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION"
)
_Q16_RB13_CORRECTION_ID: Final = "RB13_QUANT_INFERENCE_WORKER_ISOLATION"
_Q16_RB13_IMPLEMENTATION_STATE: Final = _POST_ACCEPTANCE_IMPLEMENTATION_STATE
_Q16_HISTORICAL_SERVICE_SHA256: Final = (
    "9531d45a513d28c08945adffbb51f149dc3e27afbc897f09bf66d660bf43f59f"
)
_MONEY_TRUTH_DIRECTOR_INTEGRATION_COMMIT: Final = (
    "5f887cf27ce246d80b7fc553eed470b015976963"
)
_MONEY_TRUTH_DIRECTOR_INTEGRATION_TREE: Final = (
    "813a383df420e318dc97522c860d6b1e6b99aab4"
)
_MONEY_TRUTH_FIX_TIP_COMMIT: Final = "039c3866619c3e3af9533c651284af32a7bc114d"
_MONEY_TRUTH_FIX_TIP_TREE: Final = "6724c8fa53fb74df5ef840d37ca3de8364b7c64f"
_F034_COMMIT: Final = "19f674a35944f1f3fdd4fdafd396fba9df6fd255"
_F038_COMMIT: Final = "42e431fbc8ee8823cba826f759737ce3b3f52465"
_F039_COMMIT: Final = _MONEY_TRUTH_FIX_TIP_COMMIT

CANONICAL_BASE: Final = "7010499170e24b31c9c0be2c9d73a536e680c6fe"
FROZEN_PROTOCOL_COMMIT: Final = "73e1a1ff7daa48df8dac45713fc5f106842edafc"
Q17_ACTIVATION_COMMIT: Final = "ba7323e0ac1f5013d9309b5b73998b84bdffbae5"
Q17_ACTIVATION_TREE: Final = "976feb81db7ad9d7bbc2ea48819dc500afcf5a1f"
Q17_ACTIVATION_TASK_BYTES: Final = 7_949
Q17_ACTIVATION_TASK_SHA256: Final = (
    "4aca562cea3d147152f5fba3a7c593f2c84845dba3ad84065a29a8bc229b4a57"
)
EXTERNAL_LAUNCH_ACCEPTANCE_COMMIT: Final = "9ca01537f4edda06ee566cd261e612d5c315fb76"

_Q17_WORKING: Final = "WORKING"
_Q17_COMPLETE: Final = "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION"
_Q17_STATUS_LINES: Final = {
    "Status: `WORKING`": _Q17_WORKING,
    ("Status: `COMPLETE — READY_FOR_INDEPENDENT_COMMIT_VERIFICATION`"): _Q17_COMPLETE,
}


@dataclass(frozen=True, slots=True)
class _ArtifactSpec:
    artifact_id: str
    relative_path: str
    byte_length: int
    sha256: str
    media_type: str
    schema_name: str
    schema_version: int | None


@dataclass(frozen=True, slots=True)
class _SourceSpec:
    relative_path: str
    manifest_path_prefix: str
    file_count: int
    seal_sha256: str


@dataclass(frozen=True, slots=True)
class _CorrectionSpec:
    role: str
    commit: str
    tree: str


@dataclass(frozen=True, slots=True)
class _PostAcceptanceCorrectionSpec:
    correction_id: str
    current_source: _SourceSpec
    current_primary_evidence: _ArtifactSpec | None
    fix_commits: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _PhaseSpec:
    phase: str
    owner: str
    implementation_commit: str
    implementation_tree: str
    acceptance_commit: str
    acceptance_tree: str
    implementation_receipt_sha256: str
    acceptance_receipt_sha256: str
    implementation_receipt_bytes: int
    acceptance_receipt_bytes: int
    evidence_posture: str
    integration_state: str
    director_integration_commits: tuple[str, ...]
    corrections: tuple[_CorrectionSpec, ...]
    source: _SourceSpec | None
    primary_evidence: _ArtifactSpec
    dispositions: tuple[str, ...]
    limitations: tuple[str, ...]


_PRIMARY_EVIDENCE: Final[tuple[_ArtifactSpec, ...]] = (
    _ArtifactSpec(
        "q00.benchmark-profile.v1",
        "quant/docs/Q00_BENCHMARK_PROFILE.md",
        7_725,
        "96d5809b11c579ebb2f552757f943b3a25c72180d77f0ea3fd74e933eda5443f",
        "text/markdown",
        "Q00BenchmarkProfileV1",
        1,
    ),
    _ArtifactSpec(
        "q01.deterministic-seed.v1",
        "quant/fixtures/deterministic_seed_v1.json",
        279,
        "b01207e33339c44e15500091ea52a019a2983a69b3702da46f87f9a04804cd05",
        "application/json",
        "DeterministicSeedFixtureV1",
        1,
    ),
    _ArtifactSpec(
        "q02.partition-golden.v1",
        "quant/fixtures/q02_partition_golden_v1.json",
        3_198,
        "01b648ee6ae5f9d4dbba345b775d4f19b4d1ce2276036d9161554c73ab8f49ba",
        "application/json",
        "Q02PartitionGoldenFixtureV1",
        1,
    ),
    _ArtifactSpec(
        "q03.event-atlas.v1",
        "quant/generated/q03/event_atlas.v1.json",
        189_860,
        "f8d59dea19be7a4f633f73deaccc3910b086c5a50fa03c07a1b4147ba297b21c",
        "application/json",
        "EventAtlasV1",
        1,
    ),
    _ArtifactSpec(
        "q04.replay-golden.v1",
        "quant/fixtures/q04_replay_golden_v1.json",
        14_050,
        "32e134938d9e2ba5e9f32fb279bfa9bf9c6dcc8abe0d220107382d7f78fa6aec",
        "application/json",
        "Q04ReplayGoldenFixtureV1",
        1,
    ),
    _ArtifactSpec(
        "q05.label-golden.v1",
        "quant/fixtures/q05_label_golden_v1.json",
        4_184,
        "f36a9b089fe2c935c08f6f67e8b7debcf40b8d67cde46ae73271835b725afe47",
        "application/json",
        "Q05LabelGoldenFixtureV1",
        1,
    ),
    _ArtifactSpec(
        "q06.feature-golden.v1",
        "quant/fixtures/q06_feature_golden_v1.json",
        5_486,
        "06c81655ebb61a6311f29f7964d99b6d4dca94d7a1f8c2416d922fda3fcbabb3",
        "application/json",
        "Q06FeatureGoldenFixtureV1",
        1,
    ),
    _ArtifactSpec(
        "q07.micro-golden.v1",
        "quant/fixtures/q07_micro_golden_v1.json",
        26_326,
        "d8308437461b8d6aebd3814ef91044208255f34290ff9d260b167b21723f4ce3",
        "application/json",
        "Q07MicroGoldenFixtureV1",
        1,
    ),
    _ArtifactSpec(
        "q08.derivatives-campaign.v1",
        "quant/generated/q08/derivatives_campaign.v1.json",
        1_204,
        "d2054e47d0050ef521d91f653b9ab6f60411a2d2f0633933c7ec65e76145525b",
        "application/json",
        "Q08DerivativesCampaignV1",
        1,
    ),
    _ArtifactSpec(
        "q09.regime-campaign.v1",
        "quant/generated/q09/regime_campaign.v1.json",
        1_505,
        "897660948b868b564558b227d32fe65359b4c7f24ce17357e4eb4d4ade69737a",
        "application/json",
        "Q09RegimeCampaignV1",
        1,
    ),
    _ArtifactSpec(
        "q10.model-campaign.v1",
        "quant/generated/q10/model_campaign.v1.json",
        1_135,
        "ab1f8a607d437eb4d98dc3e284a3e08999712269984dc45bd18fb9ca70b6541f",
        "application/json",
        "Q10ModelCampaignV1",
        1,
    ),
    _ArtifactSpec(
        "q11.survival-campaign.v1",
        "quant/generated/q11/survival_campaign.v1.json",
        17_826,
        "091a8d9e646cb879d49f0788cb88edc803caa73ac866028245a3e46529c18ac0",
        "application/json",
        "Q11SurvivalCampaignV1",
        1,
    ),
    _ArtifactSpec(
        "q12.ensemble-campaign.v1",
        "quant/generated/q12/ensemble_campaign.v1.json",
        2_376,
        "ad9d9b1f6ba9ffe3fc59450075f5221792f6c900403775f6820e2da763c28bb2",
        "application/json",
        "Q12EnsembleCampaignV1",
        1,
    ),
    _ArtifactSpec(
        "q13.data-sufficiency.v1",
        "quant/generated/q13/data_sufficiency.v1.json",
        1_813,
        "126e27674a99f18accfc21638cbb5bdb1d1bda0f563a03284a7e4ad75665365d",
        "application/json",
        "Q13DeepDataSufficiencyReportV1",
        None,
    ),
    _ArtifactSpec(
        "q14.validation-campaign.v1",
        "quant/generated/q14/validation_campaign.v1.json",
        2_322,
        "a0522034a97c2676d4af31c7b22c10412ebb06a115df4de72f307081b23d9f87",
        "application/json",
        "Q14ValidationCampaignV1",
        1,
    ),
    _ArtifactSpec(
        "q15.registry-campaign.v1",
        "quant/generated/q15/registry_campaign.v1.json",
        4_322,
        "24debb2a96b91338d937b67878c75be2ef38615880c9c0ad8cd30590ac0bd11b",
        "application/json",
        "Q15RegistryCampaignV1",
        1,
    ),
    _ArtifactSpec(
        "q16.edge-assessment.v1",
        "quant/generated/q16/edge_assessment.v1.json",
        2_798,
        "10d4a858ac08c29b03ab3df6476b7eb6830359581d00791a229ccd765b369329",
        "application/json",
        "EdgeAssessmentEnvelopeV1",
        1,
    ),
)

_SOURCE_SPECS: Final[tuple[_SourceSpec, ...]] = (
    _SourceSpec(
        "quant/src/quant_edge/lake",
        "src/quant_edge/lake",
        8,
        "9d1429b33176e4f8726032243741af9e532ca36798610e08ea129eccc35bd64c",
    ),
    _SourceSpec(
        "quant/src/quant_edge/bootstrap",
        "src/quant_edge/bootstrap",
        9,
        "83bd6ccb7a9e188bdc323a9e4faf3513d7f75348d99437b327d89bdcbb2d61f5",
    ),
    _SourceSpec(
        "quant/src/quant_edge/book",
        "src/quant_edge/book",
        5,
        "aee6cf473955d1845d92492004f9376f22cb44324b002742823b595119773d3f",
    ),
    _SourceSpec(
        "quant/src/quant_edge/labels",
        "src/quant_edge/labels",
        10,
        "fb3fc6571a45e330499c52000672c9f6e6819f3b12e03f42506546e85b31fe12",
    ),
    _SourceSpec(
        "quant/src/quant_edge/features",
        "src/quant_edge/features",
        9,
        "c005edec4d0e3ec20263a8c026fca15620e918bc06f6304b3fe528d7707c5d3e",
    ),
    _SourceSpec(
        "quant/src/quant_edge/micro",
        "src/quant_edge/micro",
        7,
        "cd50265ea4e986b32c07f5766b1de3b904a28a136450af8888f7712e36a65798",
    ),
    _SourceSpec(
        "quant/src/quant_edge/derivatives",
        "src/quant_edge/derivatives",
        15,
        "0224276b1a356696eab857aea38d40d8956491761a9e0012a0298cb9e3448d74",
    ),
    _SourceSpec(
        "quant/src/quant_edge/regime",
        "src/quant_edge/regime",
        13,
        "89b8e3747755f595d6adbb2a94e4c0d88b4eb0882a3ec5fec240a8dac3a697ae",
    ),
    _SourceSpec(
        "quant/src/quant_edge/models",
        "src/quant_edge/models",
        10,
        "7ffde23cbe6d07b6b9cef99aab27151e9069b5ffffd254e32f8f3586ebeefb7a",
    ),
    _SourceSpec(
        "quant/src/quant_edge/survival",
        "src/quant_edge/survival",
        8,
        "0f635f5e6f3924fc6f0e071dfd82b49a724b06b4163cfc6a1b0e214e2963642c",
    ),
    _SourceSpec(
        "quant/src/quant_edge/ensemble",
        "src/quant_edge/ensemble",
        7,
        "0e933737922c1d6255b90e1be275bdd47f34318e239d549caf051246fa8c449d",
    ),
    _SourceSpec(
        "quant/src/quant_edge/deep",
        "src/quant_edge/deep",
        7,
        "13646834bb44c2eb987d65079565f02aa2febdb6adeb015001fc1695c0a00221",
    ),
    _SourceSpec(
        "quant/src/quant_edge/validation",
        "src/quant_edge/validation",
        12,
        "8c4482643582c9e9fbd7be3bd470c4d106717955bd10ad80854df9314e6b7356",
    ),
    _SourceSpec(
        "quant/src/quant_edge/registry_ops",
        "src/quant_edge/registry_ops",
        7,
        "ccb0a8dd86e8b6548728d11bb3b28db29ce0e3e8e6d3288653375ef4d39af262",
    ),
    _SourceSpec(
        "quant/src/quant_edge/inference",
        "src/quant_edge/inference",
        8,
        "6c67b5bf2488e3b13e5c5fc72a2b613d0ed74fb00a14f635ab71444f7c6d321a",
    ),
)

# C16/A16 accepted the source seal above.  RB-13 changes those bytes after that
# acceptance, so its live source and service bytes are verified separately and
# stay explicitly pending independent commit verification.  These pins are
# regenerated with the post-acceptance correction; they are never projected as
# evidence for the immutable C16/A16 identities or receipts.
_Q16_RB13_SOURCE_SPEC: Final = _SourceSpec(
    "quant/src/quant_edge/inference",
    "src/quant_edge/inference",
    8,
    "2a2203a1e5a9e652d1bcc87b92b5983dc14aaa879ea9596dc4b7e49a7481a202",
)
_Q16_RB13_SERVICE_SPEC: Final = _ArtifactSpec(
    "q16.rb13-inference-service-source.v1",
    "quant/src/quant_edge/inference/service.py",
    35_877,
    "763e08352e201ce7173c16a6a72cd413c7feac58ca7e624a3d94dab4eb70fb68",
    "text/x-python",
    "Q16RB13InferenceServiceSourceV1",
    1,
)

# F-034/F-038/F-039 changed already accepted Q02/Q05/Q08 owner bytes.  Their
# accepted source/evidence pins above remain immutable.  These specs verify the
# exact current money-truth correction bytes without promoting them into the
# historical phase identities or receipts.
_POST_ACCEPTANCE_CORRECTIONS: Final[dict[str, _PostAcceptanceCorrectionSpec]] = {
    "Q02": _PostAcceptanceCorrectionSpec(
        "MONEY_TRUTH_Q02_INSTRUMENT_UNIT_IDENTITY",
        _SourceSpec(
            "quant/src/quant_edge/lake",
            "src/quant_edge/lake",
            8,
            "3d755d7255a030528008e22b590f33b8355d87f74ed68620825ba245c1ff9bfc",
        ),
        None,
        (_F039_COMMIT,),
    ),
    "Q05": _PostAcceptanceCorrectionSpec(
        "MONEY_TRUTH_Q05_DIRECTIONAL_LABEL_ECONOMICS",
        _SourceSpec(
            "quant/src/quant_edge/labels",
            "src/quant_edge/labels",
            10,
            "d8c5709d1c1caace7c32e9d58c32648e940b14804ff18aaca5245ec6f538bed7",
        ),
        _ArtifactSpec(
            "q05.money-truth-label-golden.v1",
            "quant/fixtures/q05_label_golden_v1.json",
            4_184,
            "c82cf92d68bebcfbc5d818de667b9ca50714e7cffbeac331fe06176899c6709e",
            "application/json",
            "Q05LabelGoldenFixtureV1",
            1,
        ),
        (_F038_COMMIT, _F039_COMMIT),
    ),
    "Q08": _PostAcceptanceCorrectionSpec(
        "MONEY_TRUTH_Q08_EXECUTABLE_BASIS_ECONOMICS",
        _SourceSpec(
            "quant/src/quant_edge/derivatives",
            "src/quant_edge/derivatives",
            15,
            "232ee05a6d2ab4a2645be9be5f466ce400004ec503298dcb2ca13e8e264bac06",
        ),
        _ArtifactSpec(
            "q08.money-truth-derivatives-campaign.v1",
            "quant/generated/q08/derivatives_campaign.v1.json",
            1_204,
            "3a2a912ccecdd9fb893d798c38b4cc40d2f4821465fd2d3e82987b7449c654a8",
            "application/json",
            "Q08DerivativesCampaignV1",
            1,
        ),
        (_F034_COMMIT, _F038_COMMIT, _F039_COMMIT),
    ),
}

# C/A/tree values are copied from the immutable acceptance receipts and verified
# against Git during Q17 construction.  Runtime code intentionally has no Git or
# subprocess dependency.
_PHASE_IDENTITIES: Final[tuple[tuple[str, ...], ...]] = (
    (
        "Q00",
        "launch_gate",
        "fa6fecd8295aaab6aa38d35bd34843b64af69e69",
        "7c3b49a2eb71422ee0de02853a08d108ac8c2b85",
        "a7606b49d26cfc9aeec4e8a4166219885a0d19e5",
        "679acf18d9b70230707caceffde4b5ca1b8948ac",
    ),
    (
        "Q01",
        "quant_edge.core",
        "73330e281c7a91fa5fba2059570e9619f9ade34d",
        "52b500d91fbb0b3fe016e0c65878128dba87cd60",
        "501eff34a7bcc354dfcd900d2d72ca263ade8b93",
        "a13ee14f4a7eec79c1a0048bc35b5f4b86911140",
    ),
    (
        "Q02",
        "quant_edge.lake",
        "7edd275e98762f600c6168e405b26716ba9d7e0d",
        "3f258a10729deb4f80f918be058f1f1bb7946f8f",
        "1db50828c8474b0f9fe70a70817ab20003107546",
        "66c4644f302a66c0eb8f97c9a5f5b16175c04fd1",
    ),
    (
        "Q03",
        "quant_edge.bootstrap",
        "34b88ef7f022226acd8e294d3a023f71f3dfc397",
        "34ea865d2df4ecf98f79c83f65bb1d0f49a00636",
        "9e7d4aabae68a0e20479c389c0f08c33886bdeb4",
        "14a29aa368b99aa5627e8b85e48dc2ee10a6738b",
    ),
    (
        "Q04",
        "quant_edge.book",
        "668ab5d0548d1713c299e85972fcbc6433c59504",
        "8611a1ac3c9f23fa61aa806ae5dcfc4e00e4f017",
        "3455216249c2d7bcac67ef0d44a5567bcf93a26c",
        "260eec743564d6d94e8d006ab648752a820d046f",
    ),
    (
        "Q05",
        "quant_edge.labels",
        "a1baa003b2d9a1c746fe55956cad7b9633bcecdd",
        "f59734a85329a55aa76d98432b76c090646c9206",
        "8986653b0bbe371d7b129d56742bec7ba158ebaf",
        "85986aa185e1d42f5bdf82fc089e7b72b35a4285",
    ),
    (
        "Q06",
        "quant_edge.features",
        "3bf9e2a775c0aa91a29ab2f67c27544b9ddc6602",
        "e183d53c1cc0d2866211824cde020e6149147a85",
        "24ccf5880cbce8b1ee81ddd7d33f7c9c7271aacd",
        "a655ff8537c0e44449fc3dfa881293d79a0d2f8c",
    ),
    (
        "Q07",
        "quant_edge.micro",
        "22ab5bc8db94bf92883fdeac2a397ebf8c132ca0",
        "919f86ce835dac86d9c534ff5734d4361c8198c4",
        "f0d4448f5f427b017589a79d41d05b0b31045726",
        "78b8a01ae06583f7cc2959da41beb4a93747d29a",
    ),
    (
        "Q08",
        "quant_edge.derivatives",
        "4c9b02672aed7c02149fd7e37e9fd2ec5552107a",
        "da7a50d205e8232b57d91d80d13195733b46b395",
        "4bac0892fd410d60edcf7b35f8ca59a5e0cf37c9",
        "37abe80dcc206042335562c2ebccec27875e449b",
    ),
    (
        "Q09",
        "quant_edge.regime",
        "8c5bf3486e3bab28fd8c1865cc607765b8877af3",
        "b5704f8703ba3ef4501424d6432a55d008564fa2",
        "a3426e53731d65e8c1fd9b824f69b4e4644f398e",
        "b867b0eb62c1e3648e5b868d7f39314249e8889c",
    ),
    (
        "Q10",
        "quant_edge.models",
        "f25648ace7f7adf8cd9c59ba459d1099ffdc7638",
        "b89ef4eabe6d729a83009982c5b705266559b4cf",
        "ce0a0f806a1d0b69a3405065b294e83fbe0137d9",
        "4af2431401f0d21fae0db5e6a38ca30315ce140f",
    ),
    (
        "Q11",
        "quant_edge.survival",
        "a6563a73decbefd20403cedf6f16eb60082550c4",
        "b398cfb074dbeac88aef1a6deeee3f29c91e16c2",
        "d04286dcfa324acc29e9e4d0467cbc4aafafba8f",
        "32a9844bc5c2eebad75dc8f4aafbe1c308332685",
    ),
    (
        "Q12",
        "quant_edge.ensemble",
        "7e403d2c24290deda81cae93f58308818144e017",
        "2c8cef3458e4953cd279d7c11ec2939685eda1a4",
        "b9c4cee64084efc33daae481ff2d43eebe46047a",
        "5255ffdc285c6b08d1e1d4079da82cdb0ea0a584",
    ),
    (
        "Q13",
        "quant_edge.deep",
        "d28131c7745dda884a8918aa8bf5279004615c05",
        "8f491ff65489e0c4740338f648c43d0aab1b1ebc",
        "06f0a8f0c722ece6c46f56c62156aec291a77317",
        "efbd184fe58d89a5bf5bd016387f60ba8ba1c059",
    ),
    (
        "Q14",
        "quant_edge.validation",
        "4b016e9c0713a07d80e2243cf687fd825c7a5494",
        "7810eff697f3dddec2717470a988e0ee128465ad",
        "e266b42913fb721cc2a8470a08774be3fdf1ce0c",
        "ceaaca3d0872995eaa416b30b12455c1237cc1dc",
    ),
    (
        "Q15",
        "quant_edge.registry_ops",
        "6b18928c282f19128a033ed33910754cbdc2cbe0",
        "04f78c5100f12979311cfb0c0608c2baab753863",
        "e69f6879b5914879b5d9342e3f05fa964f5b9496",
        "f5958f5ddc7b0a8608da28313ed88fc1e9bdf1a0",
    ),
    (
        "Q16",
        "quant_edge.inference",
        "b3d8cedece8cf3a9f546c60016beae442f85f160",
        "a35b888041cbdd4ea56accd29a490a8ce043cef0",
        "4ac05802244a194639865a4b615ee2af13dce4e2",
        "eb367affe1952093be09d8ec2d1d1344ae905453",
    ),
)

_IMPLEMENTATION_RECEIPTS: Final[tuple[tuple[int, str], ...]] = (
    (7_625, "738dad4caac7cfac9ba8b7b84fb646ec1817c6f0eb34fc09daa60129ab1996c3"),
    (10_459, "254b638eaa00b3f2ea06f12a3c5b460ac330c0ca5e48236042ea97ddb543114e"),
    (11_926, "978456a8e3bb5adfc8092fc7d647ef3cb8ade9ac6b548578a578c23c11bc9b97"),
    (12_564, "767c94f8680490a35b992da1a6abf349379508ba75bef670ac3de1071f5fe92a"),
    (12_449, "95b87d68b781f6cdeca560249d848fb7512d94b844051ce360bcd882c4f03a47"),
    (12_307, "36b34d000d3f02af8180f047b83a65a718cb713639987aebc90249bd171272b9"),
    (8_144, "084836741fd74759b526760d6b2657deb7137d6d1f4ce227565dfb63ed26bddf"),
    (10_137, "06bcc7ca89160d9d6351ca26f0125bde48b064dbc8a049cad8ea6bf1b2292162"),
    (11_032, "567ca1e189bd32d6eba504a9b9050e2cce8023e09f315467b56506451de9c4ad"),
    (13_083, "71a437f3545e2ec7f808850a42889352b775a9f4c2b49e1385748d0c899d20c3"),
    (14_945, "d9261dbdc5cb141e529b2978182563acd4754a2c0003b43236f23a58d7c89f37"),
    (14_762, "4b5e613bc5cfce3e519ccdadd0b426fa997a21fcbe494307c0df589e4fb199c5"),
    (9_857, "2062adbc0840d2be42a192ef0f470a9508fe53165b98f5eb849e67ffbc6f06bc"),
    (11_827, "b3108cb60401999581174ab6c8ecd8d17219ac8d44d98574673faa34620235be"),
    (11_251, "b0ef9e862a435a00627060ea3ecb27a38aa60f3ec2679766ec5825adf7059b1f"),
    (8_505, "baa20476a37867bb5d6fcef062918d50f80c5058d1be4a63ba6163ace24f346a"),
    (10_635, "b3b08998bfc3450de2b3502defca482cb6759f6cfe44a4cbb9f2e95d43fea5d6"),
)

_ACCEPTANCE_RECEIPTS: Final[tuple[tuple[int, str], ...]] = (
    (4_555, "c29c7646af5f284a88eca782beb7dbf636e6c6eb11dda25d1bccc03ea97385de"),
    (5_133, "368daeccd6b43f28bfc41110f1dc85b8037f1c7eac81e3539a5e2bea893bd4b2"),
    (4_980, "5ffa157aa4d568916623add4e4b641498b27fb4ea6cef94e5e4f496e809409ab"),
    (6_178, "31cf167aa6f7bcd209ebbb29254e9d0f6ccd65ec7093885dacd488ec49270486"),
    (5_128, "ad14fe33c852ea0be0ccd269d15f942557cd66c1080a28f7809d33eef11fd2ae"),
    (4_615, "835865ec2f4fc40740b84ca94e0bc419ab8f0c7f8563622bab2d7701d1f596df"),
    (4_175, "8b2d558b003e5eb9f17aabf80eb3d10efac8ff2478b29d032c2b3c4f5ec016d3"),
    (4_842, "2a1a71ec05cb375d0893eed569e513d80bfabf665b3b2a8cffab5c54decd42ad"),
    (3_882, "ef4582e71cf9060d78e9832c286e1898aaa8bae5134766cbe47bccfe368b7f2e"),
    (4_281, "cf18016afb21c3d27797ccd49a6795b6c9e7e9eaa7c3205d16211eed35c4d5aa"),
    (5_031, "93f1d6b3e44864ed90e013522f0bc4d3a5fd97bd8f1995653881044ea6bff458"),
    (4_539, "137e4fa4098db7209b5c8c3cb3afd8002b6e24999d7f5316cc8d2a3eec803cc2"),
    (4_883, "2f032b32cbea9a0573ce01d4035267615a907c458d8c75ea5132e96727e4a22e"),
    (4_624, "2b1afa1e1f51d9b3f6d590a14cb8dd81adf92f594bfada244a7ccad960904761"),
    (3_715, "362cc25553c9b886f8dda0c4c41a416d97568e15bbe7ef30897a38e1eb5026dc"),
    (3_700, "b7ececc6857238f7102e471f722bd219ebe28e77cacee88f0e9bd34675a30cb3"),
    (5_171, "e2283973e496cd592e56df9d95a79d79dc197122f1937b89707c22a86d490828"),
)

_EVIDENCE_POSTURES: Final[tuple[str, ...]] = (
    "DOCUMENTARY_ACCEPTED",
    "SYNTHETIC_DETERMINISM",
    "SYNTHETIC_GOLDEN",
    "REAL_ARCHIVE_WITH_EXPLICIT_FORWARD_GAPS",
    "SYNTHETIC_REPLAY_GOLDEN",
    "SYNTHETIC_LABEL_GOLDEN",
    "SYNTHETIC_FEATURE_GOLDEN",
    "SYNTHETIC_MICROSTRUCTURE_GOLDEN",
    "SYNTHETIC_ONLY",
    "SYNTHETIC_ONLY",
    "SYNTHETIC_ONLY",
    "SYNTHETIC_ONLY",
    "SYNTHETIC_ONLY",
    "DATA_INSUFFICIENT_REFERENCE_ONLY",
    "SYNTHETIC_ONLY",
    "SYNTHETIC_ONLY_MODEL_PAYLOAD_UNAVAILABLE",
    "SYNTHETIC_ONLY_SAFE_ABSTAIN",
)

_DIRECTOR_INTEGRATIONS: Final[dict[str, tuple[str, ...]]] = {
    "Q08": (
        "c00de401b27f3d6cccc3f1e8968ad7578f3575ca",
        "494d6ceacd9438f370b27f17b45ff8368179c5ee",
    ),
    "Q09": ("8a5dd092b73ba0069a67f3a3bead0561f3269370",),
    "Q11": ("ef154736ae594f139409caebd3cda4d49a9ea51a",),
    "Q13": ("3ed8e38d65812e2eb8ed6eba19e4eb5084c253d1",),
    "Q14": ("f756f3b582f24857811e6ec4c0d08a3a61026b74",),
    "Q15": (
        "f54180c3a7d014e4d91a0c6b7dc5ea4c3d521754",
        "c070fdaf7dc568448212067dde5e1fb2ecc21356",
    ),
}

_CORRECTIONS: Final[dict[str, tuple[_CorrectionSpec, ...]]] = {
    "Q08": (
        _CorrectionSpec(
            "SHARD_ARCHIVE_SCOPE_CORRECTION",
            "6649749c700fbb6825f44e22bf551e82effea4d1",
            "0745bba06309f8b7959b64f7f1145643da0f7bdd",
        ),
        _CorrectionSpec(
            "DIRECTOR_MERGED_SCOPE_CORRECTION",
            "494d6ceacd9438f370b27f17b45ff8368179c5ee",
            "e54858eb78fae51df0811d9386259a1314a5891d",
        ),
    ),
    "Q15": (
        _CorrectionSpec(
            "IMMUTABLE_EVIDENCE_SEAL",
            "e1e1238b4af4be01b875a29667b76f1b8a81e565",
            "693fc2b4f2c9a7f125258afc401fc6efb1bd9fb4",
        ),
        _CorrectionSpec(
            "DIRECTOR_MERGED_SCOPE_CORRECTION",
            "c070fdaf7dc568448212067dde5e1fb2ecc21356",
            "0394288ffeaf02af64d2095b13e9f61ddfdafe7a",
        ),
    ),
}


def _safe_parts(relative_path: str) -> tuple[str, ...]:
    if not isinstance(relative_path, str) or not relative_path or "\x00" in relative_path:
        raise ComponentManifestError("component path must be non-empty portable text")
    parsed = PurePosixPath(relative_path)
    if (
        parsed.is_absolute()
        or not parsed.parts
        or any(part in ("", ".", "..") for part in parsed.parts)
        or "\\" in relative_path
        or "://" in relative_path
        or parsed.as_posix() != relative_path
    ):
        raise ComponentManifestError("component path must be an exact relative POSIX path")
    return parsed.parts


def _require_repo_root(repo_root: Path) -> tuple[Path, os.stat_result]:
    if not isinstance(repo_root, Path) or not repo_root.is_absolute():
        raise ComponentManifestError("repo_root must be an absolute pathlib.Path")
    try:
        before = repo_root.lstat()
        resolved = repo_root.resolve(strict=True)
    except OSError as error:
        raise ComponentManifestError("repo_root is absent") from error
    if not stat.S_ISDIR(before.st_mode) or repo_root.is_symlink() or resolved != repo_root:
        raise ComponentManifestError("repo_root must be an exact real non-symlink directory")
    return resolved, before


def _read_regular(
    repo_root: Path,
    root_before: os.stat_result,
    relative_path: str,
    *,
    expected_bytes: int | None,
    maximum_bytes: int,
) -> bytes:
    parts = _safe_parts(relative_path)
    candidate = repo_root.joinpath(*parts)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise ComponentManifestError(f"component evidence is absent: {relative_path}") from error
    if not resolved.is_relative_to(repo_root) or resolved != candidate:
        raise ComponentManifestError(f"component evidence escapes or uses a link: {relative_path}")

    directory_flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    directory_fds: list[int] = []
    descriptor = -1
    try:
        directory_fds.append(os.open(repo_root, directory_flags))
        opened_root = os.fstat(directory_fds[0])
        if (opened_root.st_dev, opened_root.st_ino) != (
            root_before.st_dev,
            root_before.st_ino,
        ):
            raise ComponentManifestError("repo_root changed while opening")
        for part in parts[:-1]:
            parent_fd = directory_fds[-1]
            next_fd = os.open(part, directory_flags, dir_fd=parent_fd)
            directory_fds.append(next_fd)
            opened_child = os.fstat(next_fd)
            current_child = os.stat(part, dir_fd=parent_fd, follow_symlinks=False)
            if not stat.S_ISDIR(opened_child.st_mode) or (
                opened_child.st_dev,
                opened_child.st_ino,
            ) != (current_child.st_dev, current_child.st_ino):
                raise ComponentManifestError("component evidence parent changed while opening")
        descriptor = os.open(
            parts[-1],
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=directory_fds[-1],
        )
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ComponentManifestError("component evidence must be a regular file")
        if before.st_nlink != 1:
            raise ComponentManifestError("component evidence must be a single-link file")
        if before.st_size > maximum_bytes:
            raise ComponentManifestError("component evidence exceeds its bounded read")
        if expected_bytes is not None and before.st_size != expected_bytes:
            raise ComponentManifestError("component evidence size is not accepted")
        chunks: list[bytes] = []
        remaining = before.st_size + 1
        while remaining:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        identity_before = (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_nlink,
            before.st_size,
            before.st_mtime_ns,
        )
        identity_after = (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_nlink,
            after.st_size,
            after.st_mtime_ns,
        )
        if len(raw) != before.st_size or identity_before != identity_after:
            raise ComponentManifestError("component evidence changed during its bounded read")
        for index, part in enumerate(parts[:-1]):
            current_child = os.stat(
                part,
                dir_fd=directory_fds[index],
                follow_symlinks=False,
            )
            opened_child = os.fstat(directory_fds[index + 1])
            if not stat.S_ISDIR(current_child.st_mode) or (
                current_child.st_dev,
                current_child.st_ino,
            ) != (opened_child.st_dev, opened_child.st_ino):
                raise ComponentManifestError("component evidence parent changed during read")
        current_leaf = os.stat(
            parts[-1],
            dir_fd=directory_fds[-1],
            follow_symlinks=False,
        )
        current_identity = (
            current_leaf.st_dev,
            current_leaf.st_ino,
            current_leaf.st_mode,
            current_leaf.st_nlink,
            current_leaf.st_size,
            current_leaf.st_mtime_ns,
        )
        if not stat.S_ISREG(current_leaf.st_mode) or current_identity != identity_after:
            raise ComponentManifestError("component evidence leaf changed during read")
    except OSError as error:
        raise ComponentManifestError(
            f"component evidence cannot be opened: {relative_path}"
        ) from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        for directory_fd in reversed(directory_fds):
            os.close(directory_fd)

    try:
        root_after = repo_root.lstat()
    except OSError as error:
        raise ComponentManifestError("repo_root disappeared during verification") from error
    if (root_before.st_dev, root_before.st_ino) != (root_after.st_dev, root_after.st_ino):
        raise ComponentManifestError("repo_root changed during verification")
    return raw


def _artifact_mapping(
    repo_root: Path,
    root_before: os.stat_result,
    spec: _ArtifactSpec,
) -> tuple[dict[str, object], dict[str, object] | None]:
    if len(spec.sha256) != _SHA256_LENGTH or spec.sha256.lower() != spec.sha256:
        raise ComponentManifestError("pinned component evidence digest is malformed")
    raw = _read_regular(
        repo_root,
        root_before,
        spec.relative_path,
        expected_bytes=spec.byte_length,
        maximum_bytes=MAX_EVIDENCE_BYTES,
    )
    if hashlib.sha256(raw).hexdigest() != spec.sha256:
        raise ComponentManifestError(
            f"component evidence digest is not accepted: {spec.artifact_id}"
        )
    parsed: dict[str, object] | None = None
    if spec.media_type == "application/json":
        try:
            # Q16's frozen cross-language protocol canonical form intentionally
            # omits the trailing LF used by the Python artifact canonicalizer.
            parsed = parse_canonical_object(raw if raw.endswith(b"\n") else raw + b"\n")
        except CanonicalJsonError as error:
            raise ComponentManifestError("component JSON evidence is not canonical") from error
        if parsed.get("schema") != spec.schema_name:
            raise ComponentManifestError("component evidence schema is not accepted")
        if parsed.get("version") != spec.schema_version:
            raise ComponentManifestError("component evidence version is not accepted")
    else:
        try:
            heading = raw.decode("utf-8").splitlines()[0]
        except (UnicodeDecodeError, IndexError) as error:
            raise ComponentManifestError("component text evidence is not valid UTF-8") from error
        if not heading.startswith("#"):
            raise ComponentManifestError("component text evidence lacks its format heading")
    return (
        {
            "artifactId": spec.artifact_id,
            "bytes": spec.byte_length,
            "mediaType": spec.media_type,
            "path": spec.relative_path,
            "schema": spec.schema_name,
            "sha256": spec.sha256,
            "version": spec.schema_version,
        },
        parsed,
    )


def _pinned_artifact_mapping(spec: _ArtifactSpec) -> dict[str, object]:
    """Project historical metadata without claiming that current path bytes match it."""

    _safe_parts(spec.relative_path)
    if (
        type(spec.byte_length) is not int
        or spec.byte_length < 1
        or len(spec.sha256) != _SHA256_LENGTH
        or spec.sha256.lower() != spec.sha256
    ):
        raise ComponentManifestError("pinned historical component metadata is malformed")
    return {
        "artifactId": spec.artifact_id,
        "bytes": spec.byte_length,
        "mediaType": spec.media_type,
        "path": spec.relative_path,
        "schema": spec.schema_name,
        "sha256": spec.sha256,
        "version": spec.schema_version,
    }


def _pinned_source_mapping(spec: _SourceSpec) -> dict[str, object]:
    """Project an accepted historical source seal without relabeling live bytes."""

    _safe_parts(spec.relative_path)
    _safe_parts(spec.manifest_path_prefix)
    if (
        type(spec.file_count) is not int
        or spec.file_count < 1
        or len(spec.seal_sha256) != _SHA256_LENGTH
        or spec.seal_sha256.lower() != spec.seal_sha256
    ):
        raise ComponentManifestError("pinned historical source metadata is malformed")
    return {
        "fileCount": spec.file_count,
        "path": spec.relative_path,
        "sealSchema": "Q17SourceTreeSealV1",
        "sha256": spec.seal_sha256,
    }


def _verified_python_source_mapping(
    repo_root: Path,
    root_before: os.stat_result,
    spec: _ArtifactSpec,
) -> dict[str, object]:
    """Verify a current Python source pin without treating it as accepted evidence."""

    if spec.media_type != "text/x-python" or spec.schema_version != 1:
        raise ComponentManifestError("current correction source metadata is malformed")
    raw = _read_regular(
        repo_root,
        root_before,
        spec.relative_path,
        expected_bytes=spec.byte_length,
        maximum_bytes=MAX_SOURCE_BYTES,
    )
    if hashlib.sha256(raw).hexdigest() != spec.sha256:
        raise ComponentManifestError(
            f"current correction source digest changed: {spec.artifact_id}"
        )
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ComponentManifestError("current correction source is not valid UTF-8") from error
    return _pinned_artifact_mapping(spec)


def _current_q17_task_mapping(
    repo_root: Path,
    root_before: os.stat_result,
) -> tuple[dict[str, object], str]:
    relative_path = "quant/TASKS/Q17.md"
    raw = _read_regular(
        repo_root,
        root_before,
        relative_path,
        expected_bytes=None,
        maximum_bytes=MAX_EVIDENCE_BYTES,
    )
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise ComponentManifestError("current Q17 task is not valid UTF-8") from error
    if not lines or lines[0] != "# Q17 — end-to-end proof, benchmark and final lane receipt":
        raise ComponentManifestError("current Q17 task heading is not exact")
    status_lines = [line for line in lines if line.startswith("Status:")]
    if len(status_lines) != 1 or status_lines[0] not in _Q17_STATUS_LINES:
        raise ComponentManifestError("current Q17 task status is not an allowed exact state")
    semantic_status = _Q17_STATUS_LINES[status_lines[0]]
    return (
        {
            "artifactId": "q17.current-task.v1",
            "bytes": len(raw),
            "mediaType": "text/markdown",
            "path": relative_path,
            "schema": "Q17TaskV1",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "version": 1,
        },
        semantic_status,
    )


def _receipt_spec(phase: str, *, acceptance: bool, byte_length: int, sha256: str) -> _ArtifactSpec:
    suffix = "acceptance" if acceptance else "implementation"
    file_suffix = "_ACCEPTANCE" if acceptance else ""
    return _ArtifactSpec(
        f"{phase.casefold()}.{suffix}-receipt.v1",
        f"quant/RECEIPTS/{phase}{file_suffix}.md",
        byte_length,
        sha256,
        "text/markdown",
        f"{phase}{suffix.title()}ReceiptV1",
        1,
    )


def _source_inventory(
    directory: Path,
) -> tuple[tuple[tuple[object, ...], ...], tuple[str, ...]]:
    """Return an exact flat Python inventory, excluding only a real bytecode cache."""

    try:
        children = tuple(sorted(directory.iterdir(), key=lambda child: child.name))
    except OSError as error:
        raise ComponentManifestError(
            "accepted component source inventory is unavailable"
        ) from error
    inventory: list[tuple[object, ...]] = []
    python_names: list[str] = []
    for child in children:
        try:
            identity = child.lstat()
        except OSError as error:
            raise ComponentManifestError(
                "accepted component source child is unavailable"
            ) from error
        if child.name == "__pycache__":
            if not stat.S_ISDIR(identity.st_mode):
                raise ComponentManifestError("accepted component bytecode cache is unsafe")
            inventory.append(
                (
                    child.name,
                    "EXCLUDED_TRANSIENT_BYTECODE_CACHE",
                    identity.st_mode,
                    identity.st_dev,
                    identity.st_ino,
                )
            )
            continue
        if child.suffix != ".py" or not stat.S_ISREG(identity.st_mode):
            raise ComponentManifestError("accepted component source has an unexpected child")
        python_names.append(child.name)
        inventory.append(
            (
                child.name,
                "SEALED_PYTHON_SOURCE",
                identity.st_mode,
                identity.st_dev,
                identity.st_ino,
                identity.st_nlink,
                identity.st_size,
                identity.st_mtime_ns,
            )
        )
    return tuple(inventory), tuple(python_names)


def _source_mapping(
    repo_root: Path,
    root_before: os.stat_result,
    spec: _SourceSpec,
) -> dict[str, object]:
    parts = _safe_parts(spec.relative_path)
    directory = repo_root.joinpath(*parts)
    try:
        directory_before = directory.lstat()
        resolved = directory.resolve(strict=True)
    except OSError as error:
        raise ComponentManifestError("accepted component source root is absent") from error
    if (
        not stat.S_ISDIR(directory_before.st_mode)
        or directory.is_symlink()
        or resolved != directory
        or not resolved.is_relative_to(repo_root)
    ):
        raise ComponentManifestError("accepted component source root is unsafe")

    inventory_before, python_names = _source_inventory(directory)
    if len(python_names) != spec.file_count:
        raise ComponentManifestError("accepted component source inventory changed")
    rows: list[dict[str, object]] = []
    for name in python_names:
        raw = _read_regular(
            repo_root,
            root_before,
            f"{spec.relative_path}/{name}",
            expected_bytes=None,
            maximum_bytes=MAX_SOURCE_BYTES,
        )
        rows.append(
            {
                "bytes": len(raw),
                "path": f"{spec.manifest_path_prefix}/{name}",
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    seal = hashlib.sha256(canonical_json_bytes({"files": rows})).hexdigest()
    if seal != spec.seal_sha256:
        raise ComponentManifestError("accepted component source bytes changed")
    try:
        directory_after = directory.lstat()
    except OSError as error:
        raise ComponentManifestError("accepted component source root disappeared") from error
    if (directory_before.st_dev, directory_before.st_ino) != (
        directory_after.st_dev,
        directory_after.st_ino,
    ):
        raise ComponentManifestError("accepted component source root changed")
    inventory_after, python_names_after = _source_inventory(directory)
    if inventory_after != inventory_before or python_names_after != python_names:
        raise ComponentManifestError("accepted component source inventory changed during read")
    return {
        "fileCount": spec.file_count,
        "path": spec.relative_path,
        "sealSchema": "Q17SourceTreeSealV1",
        "sha256": spec.seal_sha256,
    }


def _phase_specs() -> tuple[_PhaseSpec, ...]:
    result: list[_PhaseSpec] = []
    for index, identity in enumerate(_PHASE_IDENTITIES):
        phase, owner, implementation, implementation_tree, acceptance, acceptance_tree = identity
        implementation_receipt_bytes, implementation_receipt_sha = _IMPLEMENTATION_RECEIPTS[index]
        acceptance_receipt_bytes, acceptance_receipt_sha = _ACCEPTANCE_RECEIPTS[index]
        source = None if index < 2 else _SOURCE_SPECS[index - 2]
        integration_commits = _DIRECTOR_INTEGRATIONS.get(phase, ())
        integration_state = (
            "DIRECTOR_MERGED_ACCEPTED"
            if phase in {"Q08", "Q09", "Q11", "Q13", "Q14", "Q15"}
            else "LANE_HISTORY_ACCEPTED"
        )
        limitations = ["ADVISORY_RESEARCH_ONLY", "NO_MONEY_OR_EXECUTION_AUTHORITY"]
        if index >= 8:
            limitations.append("SYNTHETIC_EVIDENCE_IS_NOT_EDGE_EVIDENCE")
        if phase == "Q10":
            limitations.extend(
                (
                    "Q10_QUANTILE_BEST_INDEX_DOCUMENTARY_CONFLICT",
                    "Q14_NOT_A_VALIDATION_OF_Q10_OR_Q11",
                )
            )
        if phase == "Q13":
            limitations.append("DEEP_FAIL_DATA_INSUFFICIENT")
        if phase == "Q15":
            limitations.append("MODEL_PAYLOAD_UNAVAILABLE_NONLOADABLE")
        if phase in _POST_ACCEPTANCE_CORRECTIONS:
            limitations.append(
                f"POST_ACCEPTANCE_CORRECTION_NOT_ATTESTED_BY_{phase}_RECEIPTS"
            )
        if phase == "Q16":
            limitations.extend(
                (
                    "SAFE_ABSTAIN_ONLY",
                    "POST_ACCEPTANCE_CORRECTION_NOT_ATTESTED_BY_Q16_RECEIPTS",
                )
            )
        result.append(
            _PhaseSpec(
                phase,
                owner,
                implementation,
                implementation_tree,
                acceptance,
                acceptance_tree,
                implementation_receipt_sha,
                acceptance_receipt_sha,
                implementation_receipt_bytes,
                acceptance_receipt_bytes,
                _EVIDENCE_POSTURES[index],
                integration_state,
                integration_commits,
                _CORRECTIONS.get(phase, ()),
                source,
                _PRIMARY_EVIDENCE[index],
                ("IMPLEMENTED", "EXACT_COMMIT_ACCEPTED", "CURRENT_BYTES_VERIFIED"),
                tuple(limitations),
            )
        )
    return tuple(result)


def _phase_mapping(
    repo_root: Path,
    root_before: os.stat_result,
    spec: _PhaseSpec,
) -> tuple[dict[str, object], dict[str, object] | None]:
    implementation_ref, _ = _artifact_mapping(
        repo_root,
        root_before,
        _receipt_spec(
            spec.phase,
            acceptance=False,
            byte_length=spec.implementation_receipt_bytes,
            sha256=spec.implementation_receipt_sha256,
        ),
    )
    acceptance_ref, _ = _artifact_mapping(
        repo_root,
        root_before,
        _receipt_spec(
            spec.phase,
            acceptance=True,
            byte_length=spec.acceptance_receipt_bytes,
            sha256=spec.acceptance_receipt_sha256,
        ),
    )
    money_truth_correction = _POST_ACCEPTANCE_CORRECTIONS.get(spec.phase)
    if (
        money_truth_correction is not None
        and money_truth_correction.current_primary_evidence is not None
    ):
        primary_ref = _pinned_artifact_mapping(spec.primary_evidence)
        parsed_primary = None
    else:
        primary_ref, parsed_primary = _artifact_mapping(
            repo_root,
            root_before,
            spec.primary_evidence,
        )
    corrections = [
        {"commit": correction.commit, "role": correction.role, "tree": correction.tree}
        for correction in spec.corrections
    ]
    is_q16_post_acceptance_correction = spec.phase == "Q16"
    is_post_acceptance_correction = (
        money_truth_correction is not None or is_q16_post_acceptance_correction
    )
    post_acceptance_correction: dict[str, object] | None = None
    source: dict[str, object] | None
    if is_post_acceptance_correction:
        if spec.source is None:
            raise ComponentManifestError("historical correction source metadata is unavailable")
        source = _pinned_source_mapping(spec.source)

    if is_q16_post_acceptance_correction:
        current_source = _source_mapping(repo_root, root_before, _Q16_RB13_SOURCE_SPEC)
        current_service = _verified_python_source_mapping(
            repo_root,
            root_before,
            _Q16_RB13_SERVICE_SPEC,
        )
        post_acceptance_correction = {
            "acceptanceState": "NOT_ACCEPTED",
            "correctionId": _Q16_RB13_CORRECTION_ID,
            "currentServiceSource": current_service,
            "currentSourceRoot": current_source,
            "historicalAcceptedServiceSha256": _Q16_HISTORICAL_SERVICE_SHA256,
            "historicalReceipts": "DOES_NOT_ATTEST_CORRECTED_BYTES",
            "implementationCommit": PENDING,
            "implementationState": _Q16_RB13_IMPLEMENTATION_STATE,
            "implementationTree": PENDING,
            "verificationState": "PENDING_INDEPENDENT_EXACT_COMMIT_VERIFICATION",
        }
    elif money_truth_correction is not None:
        current_source = _source_mapping(
            repo_root,
            root_before,
            money_truth_correction.current_source,
        )
        if money_truth_correction.current_primary_evidence is None:
            current_primary = primary_ref
        else:
            current_primary, _ = _artifact_mapping(
                repo_root,
                root_before,
                money_truth_correction.current_primary_evidence,
            )
        post_acceptance_correction = {
            "acceptanceState": "NOT_ACCEPTED",
            "correctionId": money_truth_correction.correction_id,
            "currentBytesProvenance": {
                "directorIntegrationCommit": _MONEY_TRUTH_DIRECTOR_INTEGRATION_COMMIT,
                "directorIntegrationTree": _MONEY_TRUTH_DIRECTOR_INTEGRATION_TREE,
                "fixCommits": list(money_truth_correction.fix_commits),
                "tipCommit": _MONEY_TRUTH_FIX_TIP_COMMIT,
                "tipTree": _MONEY_TRUTH_FIX_TIP_TREE,
            },
            "currentPrimaryEvidence": current_primary,
            "currentSourceRoot": current_source,
            "historicalAcceptedPrimaryEvidenceSha256": spec.primary_evidence.sha256,
            "historicalReceipts": "DOES_NOT_ATTEST_CORRECTED_BYTES",
            "implementationCommit": PENDING,
            "implementationState": _POST_ACCEPTANCE_IMPLEMENTATION_STATE,
            "implementationTree": PENDING,
            "verificationState": "PENDING_INDEPENDENT_EXACT_COMMIT_VERIFICATION",
        }
    else:
        source = (
            None if spec.source is None else _source_mapping(repo_root, root_before, spec.source)
        )
    if is_q16_post_acceptance_correction:
        dispositions = [
            "HISTORICAL_IMPLEMENTATION_ACCEPTED",
            "HISTORICAL_EXACT_COMMIT_ACCEPTED",
            "RB13_CORRECTION_IMPLEMENTED",
            "RB13_CORRECTION_PENDING_INDEPENDENT_VERIFICATION",
            "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED",
            "NOT_ACCEPTED",
        ]
    elif money_truth_correction is not None:
        dispositions = [
            "HISTORICAL_IMPLEMENTATION_ACCEPTED",
            "HISTORICAL_EXACT_COMMIT_ACCEPTED",
            f"{spec.phase}_MONEY_TRUTH_CORRECTION_IMPLEMENTED",
            f"{spec.phase}_MONEY_TRUTH_CORRECTION_PENDING_INDEPENDENT_VERIFICATION",
            "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED",
            "NOT_ACCEPTED",
        ]
    else:
        dispositions = list(spec.dispositions)
    return (
        {
            "corrections": corrections,
            "directorIntegrationCommits": list(spec.director_integration_commits),
            "dispositions": dispositions,
            "evidencePosture": (
                "HISTORICAL_ACCEPTANCE_WITH_POST_ACCEPTANCE_CORRECTION_PENDING"
                if is_post_acceptance_correction
                else spec.evidence_posture
            ),
            "evidenceRefs": [implementation_ref, acceptance_ref, primary_ref],
            "evidenceSeal": {
                "acceptanceReceiptSha256": spec.acceptance_receipt_sha256,
                "implementationReceiptSha256": spec.implementation_receipt_sha256,
                "status": (
                    "HISTORICAL_RECEIPT_BYTES_VERIFIED_CORRECTION_NOT_ATTESTED"
                    if is_post_acceptance_correction
                    else "EXACT_CURRENT_BYTES"
                ),
            },
            "identities": {
                "acceptanceCommit": spec.acceptance_commit,
                "acceptanceTree": spec.acceptance_tree,
                "implementationCommit": spec.implementation_commit,
                "implementationTree": spec.implementation_tree,
            },
            "implementationState": (
                _POST_ACCEPTANCE_IMPLEMENTATION_STATE
                if is_post_acceptance_correction
                else "ACCEPTED"
            ),
            "integrationState": spec.integration_state,
            "limitations": list(spec.limitations),
            "owner": spec.owner,
            "phase": spec.phase,
            "postAcceptanceCorrection": post_acceptance_correction,
            "sourceRoot": source,
        },
        parsed_primary,
    )


def _require_q10_best_index(parsed: dict[str, object] | None) -> None:
    if parsed is None:
        raise ComponentManifestError("Q10 primary evidence is unavailable")
    summaries = parsed.get("studySummaries")
    if not isinstance(summaries, list):
        raise ComponentManifestError("Q10 study summaries are malformed")
    quantile = [
        item
        for item in summaries
        if isinstance(item, dict) and item.get("studyId") == "study_xgb_quantile:v1"
    ]
    if len(quantile) != 1 or quantile[0].get("bestTrialIndex") != 7:
        raise ComponentManifestError("Q10 accepted quantile best-index truth changed")


def build_component_manifest(repo_root: Path) -> dict[str, object]:
    """Build the exact-current component manifest without Git or network access."""

    root, root_before = _require_repo_root(repo_root)
    lock_spec = _ArtifactSpec(
        "q-lane.directive-input-lock.v1",
        "quant/DIRECTIVE_INPUTS.lock",
        1_757,
        "d4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24",
        "text/markdown",
        "QDirectiveInputsLockV1",
        1,
    )
    lock_ref, _ = _artifact_mapping(root, root_before, lock_spec)
    activation_task_spec = _ArtifactSpec(
        "q17.activation-task.v1",
        "quant/TASKS/Q17.md",
        Q17_ACTIVATION_TASK_BYTES,
        Q17_ACTIVATION_TASK_SHA256,
        "text/markdown",
        "Q17TaskV1",
        1,
    )
    activation_task_ref = _pinned_artifact_mapping(activation_task_spec)
    current_task_ref, current_task_status = _current_q17_task_mapping(root, root_before)

    components: list[dict[str, object]] = []
    q10_primary: dict[str, object] | None = None
    for spec in _phase_specs():
        row, parsed_primary = _phase_mapping(root, root_before, spec)
        components.append(row)
        if spec.phase == "Q10":
            q10_primary = parsed_primary
    _require_q10_best_index(q10_primary)
    task_is_complete = current_task_status == _Q17_COMPLETE
    components.append(
        {
            "corrections": [],
            "directorIntegrationCommits": [],
            "dispositions": (
                [
                    "ACTIVATED",
                    "IMPLEMENTATION_COMPLETE",
                    "READY_FOR_INDEPENDENT_COMMIT_VERIFICATION",
                    "C17_NOT_EMBEDDED",
                    "NOT_ACCEPTED",
                ]
                if task_is_complete
                else ["ACTIVATED", "WORKING", "NOT_ACCEPTED"]
            ),
            "evidencePosture": (
                "COMPOSITION_COMPLETE_PENDING_EXACT_C17"
                if task_is_complete
                else "COMPOSITION_PENDING_EXACT_C17"
            ),
            "evidenceRefs": [current_task_ref],
            "evidenceSeal": {
                "acceptanceReceiptSha256": PENDING,
                "implementationReceiptSha256": PENDING,
                "status": PENDING,
            },
            "identities": {
                "acceptanceCommit": PENDING,
                "acceptanceTree": PENDING,
                "implementationCommit": PENDING,
                "implementationTree": PENDING,
            },
            "implementationState": (_Q17_COMPLETE if task_is_complete else "ACTIVATED_WORKING"),
            "integrationState": "NOT_CONFIGURED",
            "limitations": [
                "C17_AND_A17_PENDING_NOT_EMBEDDED",
                "ADVISORY_RESEARCH_ONLY",
                "NO_MONEY_OR_EXECUTION_AUTHORITY",
            ],
            "owner": "quant_edge.final_proof",
            "phase": "Q17",
            "postAcceptanceCorrection": None,
            "sourceRoot": None,
        }
    )
    return {
        "baseCommit": CANONICAL_BASE,
        "components": components,
        "documentaryConflicts": [
            {
                "acceptedArtifactPath": "quant/generated/q10/model_campaign.v1.json",
                "acceptedValue": 7,
                "disposition": "ACCEPTED_ARTIFACT_CONTROLS_DOCUMENTARY_VALUE_NOT_USED",
                "documentaryPath": "quant/RECEIPTS/Q10.md",
                "documentaryValue": 11,
                "field": "study_xgb_quantile:v1.bestTrialIndex",
                "id": "Q10_QUANTILE_BEST_INDEX",
            }
        ],
        "externalDirectorEvidence": {
            "launchAcceptance": {
                "ancestryStatus": "NOT_Q_LANE_ANCESTOR",
                "commit": EXTERNAL_LAUNCH_ACCEPTANCE_COMMIT,
                "originBranch": "current-main",
                "phase": "Q00",
                "role": "D_LAUNCH_1_AUTHENTIC_LAUNCH_FILE_DIGEST_ACCEPTANCE",
            }
        },
        "finalPosture": {
            "action": "ABSTAIN_UNKNOWN",
            "advisoryOnly": True,
            "calibration": "UNAVAILABLE_MODEL_OUTPUT",
            "currentUniverse": "UNKNOWN",
            "deep": "FAIL_DATA_INSUFFICIENT",
            "edge": "UNAVAILABLE",
            "eventRateTrace": "UNKNOWN",
            "integration": "NOT_CONFIGURED",
            "latencyTarget": "UNKNOWN",
            "model": "UNAVAILABLE_NONLOADABLE",
            "realLabels": "DATA_INSUFFICIENT",
        },
        "frozenInputLock": lock_ref,
        "protocolCommit": FROZEN_PROTOCOL_COMMIT,
        "q17Activation": {
            "commit": Q17_ACTIVATION_COMMIT,
            "semanticStatus": "WORKING_AT_ACTIVATION",
            "task": activation_task_ref,
            "tree": Q17_ACTIVATION_TREE,
            "verificationPosture": "HISTORICAL_COMMIT_PIN_NOT_CURRENT_WORKTREE_BYTES",
        },
        "q17CurrentTask": {
            "evidence": current_task_ref,
            "semanticStatus": current_task_status,
        },
        "q17Finalization": {
            "acceptanceCommitA17": PENDING,
            "implementationCommitC17": PENDING,
        },
        "schema": "Q17ComponentManifestV1",
        "version": 1,
    }


def _require_manifest_structure(manifest: object) -> dict[str, object]:
    if not isinstance(manifest, dict) or any(not isinstance(key, str) for key in manifest):
        raise ComponentManifestError("component manifest must be an object with text keys")
    value = cast(dict[str, object], manifest)
    try:
        require_exact_keys(
            value,
            expected={
                "baseCommit",
                "components",
                "documentaryConflicts",
                "externalDirectorEvidence",
                "finalPosture",
                "frozenInputLock",
                "protocolCommit",
                "q17Activation",
                "q17CurrentTask",
                "q17Finalization",
                "schema",
                "version",
            },
            path="$",
        )
    except CanonicalJsonError as error:
        raise ComponentManifestError("component manifest top-level fields are not exact") from error
    components = value.get("components")
    if not isinstance(components, list) or len(components) != 18:
        raise ComponentManifestError("component manifest must contain exactly Q00-Q17")
    phases: list[str] = []
    row_keys = {
        "corrections",
        "directorIntegrationCommits",
        "dispositions",
        "evidencePosture",
        "evidenceRefs",
        "evidenceSeal",
        "identities",
        "implementationState",
        "integrationState",
        "limitations",
        "owner",
        "phase",
        "postAcceptanceCorrection",
        "sourceRoot",
    }
    for row in components:
        if not isinstance(row, dict) or any(not isinstance(key, str) for key in row):
            raise ComponentManifestError("component row must be an object with text keys")
        row_value = cast(dict[str, object], row)
        if set(row_value) != row_keys or not isinstance(row_value.get("phase"), str):
            raise ComponentManifestError("component row fields are not exact")
        phases.append(cast(str, row_value["phase"]))
    expected_phases = [f"Q{index:02}" for index in range(18)]
    if phases != expected_phases or len(set(phases)) != len(phases):
        raise ComponentManifestError("component phases are duplicated, missing, or out of order")
    return value


def validate_component_manifest(repo_root: Path, manifest: object) -> dict[str, object]:
    """Validate exact schema/status/identity claims against pinned current bytes."""

    value = _require_manifest_structure(manifest)
    expected = build_component_manifest(repo_root)
    try:
        supplied_bytes = canonical_json_bytes(value)
        expected_bytes = canonical_json_bytes(expected)
    except CanonicalJsonError as error:
        raise ComponentManifestError("component manifest is not canonical-JSON-safe") from error
    if supplied_bytes != expected_bytes:
        raise ComponentManifestError("component manifest does not match exact accepted truth")
    return expected
