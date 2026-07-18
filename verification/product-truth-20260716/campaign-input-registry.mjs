import path from 'node:path';

export const REQUIRED_C2_PARENT = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
export const EXACT_C9_CANDIDATE = 'd8a86f722689ed82ad40f9ec44bbbc19c2347646';
export const EXACT_C9_TREE = '1da28eb2dcc03a0545fc2bc51e2a735e88826014';
export const SEALED_C9_EVIDENCE_COMMIT = '5fd74604082420fbe46d98e408ef4ca0d1b57711';
export const SEALED_C9_EVIDENCE_TREE = '762143c25a77390d5b24e23b8f81c49a26b9d7d4';
export const SEALED_C9_EVIDENCE_PARENTS = Object.freeze([
  EXACT_C9_CANDIDATE,
  '951e7a60709683d969abcca06de26197052cb374',
]);
export const SAME_TREE_LANDING_COMMIT = 'bcb3e76b274b7f459af0f85545d38ca117c1f0bd';
export const SAME_TREE_LANDING_PARENT = '06b24ca10c5e2db73b2e6bea6121252d47fd7812';
export const SEALED_GIT_OBJECT_PAYLOAD_BUNDLE_SHA256 = 'd84ea2ef90c9634c8a62fc42036b71990c9edcb5bdb8d3eb01cb5b61a4c16d08';
export const PREDECESSOR_CANDIDATE = '41752d6a87dc1cb1b933bb4460c9cabfc15ff694';
export const PREDECESSOR_TREE = 'a770f9f393e6229252731cd5247e9a1abfd2e509';
export const REJECTED_C8_CANDIDATE = '6ab02a82931ae8234456c0710cca41b94fdc12c9';
export const REJECTED_C8_TREE = '4dbb427b357b87b9c58bfe97d06a584bd5c973ef';
export const REJECTED_SELECTION_HISTORY = Object.freeze([
  Object.freeze({
    label: 'C3',
    sha: '78f708d6cdb9d1618c53d3f08f71097b4320a63b',
    tree: '9e54ae92bd3cc4d30d3114590d7da6d81e019f16',
    disposition: 'REJECTED_FINAL_VERIFICATION',
    reason: 'SIX_FINAL_VERIFIER_FINDINGS_AND_INELIGIBLE_ANCESTRY',
  }),
  Object.freeze({
    label: 'C4',
    sha: '4c9143a0bcc331aa170e9e26b741240b39df8b9e',
    tree: '164c5e812f609364ce6cd3fa37fb91530a226db2',
    disposition: 'REJECTED_REPORT_PARITY',
    reason: 'CANONICAL_AND_SINGLE_BRANCH_REPORT_PARITY_42_OF_44_STALE_MACHINE_REPORT',
  }),
  Object.freeze({
    label: 'C5',
    sha: '959a5f9900e25f53414710bbfb3464c3ccb67a5d',
    tree: '28d3d9922cc1201333775a458919afe9158e6dc2',
    disposition: 'REJECTED_FINAL_VERIFICATION',
    reason: 'VFINAL5_UNBOUND_GENERATOR_INCOMPLETE_INPUT_MAP_STALE_CENSUS_LEDGER_WATCHMAN_FALSE_GREEN',
  }),
  Object.freeze({
    label: 'C6',
    sha: '89cd7e066b97f2f33d730d1e0adf291ebe7c4f64',
    tree: '2dd6399ff0aa2fb21c3b4632815333cf015c053a',
    disposition: 'REJECTED_CANONICAL_SECURITY_GATE',
    reason: 'CAMPAIGN_CONTRACT_TEST_USED_FORBIDDEN_CHILD_PROCESS_AND_ENVIRONMENT_ACCESS',
  }),
  Object.freeze({
    label: 'C7',
    sha: 'a283eb859ec1142aadecbd64e0b84959535f6216',
    tree: 'ffe2be1f1c4504fbb17228d2a905fe8b763af5e6',
    disposition: 'REJECTED_EXACT_EVIDENCE_INTEGRITY',
    reason: 'STALE_PAYLOAD_INVENTORY_CHECKSUM_AND_FALSE_PROVENANCE_BLOB_COUNT',
  }),
  Object.freeze({
    label: 'C8',
    sha: REJECTED_C8_CANDIDATE,
    tree: REJECTED_C8_TREE,
    disposition: 'REJECTED_EXACT_CENSUS_NON_IDEMPOTENT',
    reason: 'POST_EVIDENCE_GENERATOR_PASS_REWROTE_CUSTODY_HEAD_DERIVED_CENSUS_FIELDS',
  }),
]);
export const REJECTED_CANDIDATE_SHAS = Object.freeze([
  PREDECESSOR_CANDIDATE,
  ...REJECTED_SELECTION_HISTORY.map((row) => row.sha),
]);
export const CAMPAIGN_BRANCH = 'truth-campaign-20260716';
export const LOCK_INVENTORY_MATRIX_REQUIREMENT_ID = 'CAMP-09-PROVENANCE';
export const C9_CORRECTION_GRANTS = Object.freeze([
  '.gitattributes',
  'STATE.md',
  'WORKTREE_LEDGER.md',
  'integration/reports/i00-proof-evidence.json',
  'server/src/productIntegration/runtime/projection.ts',
  'server/src/productIntegration/runtime/types.ts',
  'server/test/productIntegration/runtime/runtime.test.mjs',
  'test/i00/commands/donor-equality.test.mjs',
  'test/i00/donor-equality.mjs',
  'test/i00/performance/campaign-evidence-contract.test.mjs',
  'verification/product-truth-20260716/',
  'web/src/components/Header.tsx',
  'web/src/features/productControlRoom/components/ControlRegistryPanel.tsx',
  'web/src/features/productControlRoom/components/SurfaceBindingPanel.tsx',
  'web/src/features/productControlRoom/fixtureBinding.ts',
  'web/src/features/productControlRoom/styles/productControlRoom.css',
  'web/src/lib/canonicalCockpitTruth.ts',
  'web/src/lib/operatorControlPosture.ts',
  'web/src/lib/productIntegration/model.ts',
  'web/src/pages/Dashboard.tsx',
  'web/src/pages/NotificationsPage.tsx',
  'web/src/pages/SystemHealth.tsx',
  'web/src/styles.css',
  'web/test/productControlRoom/canonical-presentation.test.mjs',
  'web/test/productControlRoom/contracts.test.mjs',
]);
export const EXACT_EVIDENCE_OUTPUTS = Object.freeze([
  'AI_OPS_C2_DISPOSITION.json',
  'AUTHORITY_RESOLUTION.md',
  'C2_PROOF_BINDING.json',
  'CAPABILITY_TRUTH_MATRIX.csv',
  'CLEAN_CLONE_ACCEPTANCE.md',
  'COCKPIT_BINDING_MATRIX.csv',
  'COMPOSED_RUNTIME_RECEIPT.md',
  'DIRECTIVE_COVERAGE_MATRIX.csv',
  'EVIDENCE_SELECTION.json',
  'FINAL_VERDICT.md',
  'INDEPENDENT_FINDINGS.json',
  'INPUTS.lock',
  'LOCKED_INPUT_PAYLOADS.json',
  'MANIFEST.json',
  'MANIFEST.sha256',
  'MERGE_PROVENANCE.json',
  'PRODUCT_ASSURANCE_C2_DISPOSITION.json',
  'STAGING_OPERATIONAL_RECEIPT.md',
  'STATE.md',
  'UNMERGED_DELTA_REPORT.md',
  'WORKTREE_CENSUS.json',
]);

export const EXACT_EVIDENCE_TOOLING_FILES = Object.freeze([
  'campaign-input-registry.mjs',
  'generate-exact-candidate-evidence.mjs',
  'generate-manifest.mjs',
  'human-evidence-renderer.mjs',
  'verify-exact-candidate-evidence.mjs',
]);

export const EXACT_EVIDENCE_DESCENDANT_FILES = Object.freeze([
  ...EXACT_EVIDENCE_OUTPUTS,
  ...EXACT_EVIDENCE_TOOLING_FILES,
]);

export const FORBIDDEN_HUMAN_GATE_TOKENS = Object.freeze([
  'BASELINE_TRUTH_ACCEPTED',
  'CLEAN_CLONE_ACCEPTED',
  'LOCAL_RUNTIME_ACCEPTED',
  'STAGING_OPERATIONAL_ACCEPTED',
  'VERIFIED_ACCEPTED',
]);

export const SEALED_C9_SOURCE_PATHS = Object.freeze([
  'AI_OPS_C2_DISPOSITION.json',
  'C2_PROOF_BINDING.json',
  'CAPABILITY_TRUTH_MATRIX.csv',
  'COCKPIT_BINDING_MATRIX.csv',
  'DIRECTIVE_COVERAGE_MATRIX.csv',
  'EVIDENCE_SELECTION.json',
  'INDEPENDENT_FINDINGS.json',
  'INPUTS.lock',
  'MANIFEST.json',
  'MERGE_PROVENANCE.json',
  'PRODUCT_ASSURANCE_C2_DISPOSITION.json',
  'WORKTREE_CENSUS.json',
]);

export const FRONTIER_REFERENCE_COMMITS = Object.freeze([
  Object.freeze({
    sha: 'f0168cb37bd04d21bc90591ab2256770de3b75bc',
    role: 'ACCEPTED_PRE_FRONTIER_BASE_WITH_ZERO_FRONTIER_PATHS',
    expected_ancestor_of_candidate: true,
  }),
  Object.freeze({
    sha: '887221418345ad54d7b98881b359fab85a6188e6',
    role: 'PARKED_FRONTIER_COORDINATOR_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5',
    role: 'PARKED_FRONTIER_F0_DOCK_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: 'e435c1f0c6850b2c53501d3410dd5ce92b64b286',
    role: 'PARKED_FRONTIER_F1_VENUE_MESH_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '56a08f4efb3f1b82205c4265c1dd18bbd1a70209',
    role: 'PARKED_FRONTIER_F2_PORTFOLIO_LAB_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '3c9c794e88513bee340f336c5fc4d2dd8eebf47e',
    role: 'PARKED_FRONTIER_F3_STRATEGY_ARENA_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '7a658b9850f743b944c35253568ae4a231a768b0',
    role: 'PARKED_FRONTIER_F8_EDGE_METER_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '2c29de4e4d01e8087c00e79f180b731790943baa',
    role: 'PARKED_FRONTIER_F13_DECISION_LAB_BLOCKED_TIP',
    expected_ancestor_of_candidate: false,
  }),
]);

export const HISTORICAL_PAYLOAD_COMMIT_SPECS = Object.freeze([
  ...FRONTIER_REFERENCE_COMMITS
    .filter((row) => !row.expected_ancestor_of_candidate)
    .map((row) => Object.freeze({ sha: row.sha, role: row.role })),
  Object.freeze({
    sha: SAME_TREE_LANDING_COMMIT,
    role: 'NOT_CANDIDATE_TRUTH_SAME_TREE_COMMIT_IDENTITY_IS_INSUFFICIENT',
  }),
]);

export const EXACT_EVIDENCE_PROOF_REFERENCES = Object.freeze([
  Object.freeze({
    proof_reference_id: 'C9_SOURCE_STATE',
    commit: EXACT_C9_CANDIDATE,
    path: 'STATE.md',
    git_blob: '2241a8f018e349ec7a7b49564c8dcca3ec03159b',
    sha256: '7bbdb6d892394405e8ab0cb8a81ac4ba6096582175ce07dd6682cab22bd50b3e',
    byte_length: 17_412,
    required_symbols: Object.freeze(['| Account A correction candidate C9 |']),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_PROOF_BINDING',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/C2_PROOF_BINDING.json',
    git_blob: 'b9381b3ae7366f1d1a6822363dde08c01b4ee8c7',
    sha256: 'f4e80fc5742d0031c831041befddb9c76cceb108be3c54534d2c6e787fc52cf2',
    byte_length: 4_089,
    required_symbols: Object.freeze([
      '"schema": "product-truth-c9-proof-binding.v2"',
      `"candidate_sha": "${EXACT_C9_CANDIDATE}"`,
    ]),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_INPUT_LOCK',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/INPUTS.lock',
    git_blob: 'b64de79756b5f2d2a8df7e6b41344edc9d64cc29',
    sha256: 'f66f5021d13fc18b822d3d31f021c880ace0453f26ee7505361e507bccd107d8',
    byte_length: 67_109,
    required_symbols: Object.freeze([
      '"schema": "product-truth-inputs-lock.v4"',
      `"candidate": "${EXACT_C9_CANDIDATE}"`,
    ]),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_SELECTION_V2',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/EVIDENCE_SELECTION.json',
    git_blob: 'd742ee7ac15e352fb281177111fe2bd20fd0e4b6',
    sha256: '186ef8ba0fac457ad60738fac57c662745cf32f367f6cc706558f0ccbc9fdc01',
    byte_length: 4_312,
    required_symbols: Object.freeze([
      '"schema": "product-truth-c9-evidence-selection.v2"',
      `"source_candidate": "${EXACT_C9_CANDIDATE}"`,
    ]),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_MANIFEST_V2',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/MANIFEST.json',
    git_blob: 'c6b9bd8e63d14613b21284589975addb463ae3d3',
    sha256: 'd931ad1383f4b7a91700220b62b006c53316e4fe41102a7279884857bfcfead5',
    byte_length: 14_957,
    required_symbols: Object.freeze([
      '"schema": "product-truth-manifest.v2"',
      `"candidate_sha": "${EXACT_C9_CANDIDATE}"`,
    ]),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_PROVENANCE',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/MERGE_PROVENANCE.json',
    git_blob: '751ce7a6e02f6895cdc3a99969914527dc72e7c4',
    sha256: '9c4039e90424d92274e7f0a5cb990ce57fd21ed4d08801ba62d317debe0613b7',
    byte_length: 71_232,
    required_symbols: Object.freeze([
      '"schema": "product-truth-merge-provenance.v3"',
      `"candidate_sha": "${EXACT_C9_CANDIDATE}"`,
    ]),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_CENSUS',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/WORKTREE_CENSUS.json',
    git_blob: '8b71a2f4383184e52fe87871c9542c61739da47f',
    sha256: '104347b7ae72b71acd09a82d8c034a3dd89f155674d97dc989bbc0012e810846',
    byte_length: 311_293,
    required_symbols: Object.freeze([
      '"schema": "product-truth-worktree-census.v2"',
      `"candidate_sha": "${EXACT_C9_CANDIDATE}"`,
    ]),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_FINDINGS',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/INDEPENDENT_FINDINGS.json',
    git_blob: '53eb697f7ac9048c4679b39b4d125395d9656d0f',
    sha256: '17f5a99f433a81310ab5cadcdde06962c3eb2a80c4a5ec8fa271adf0b00b06a6',
    byte_length: 8_465,
    required_symbols: Object.freeze([
      '"schema": "product-truth-c9-independent-findings.v3"',
      '"wave1b": "C9_SOURCE_FIXED_FRESH_FINAL_VERIFIER_PENDING"',
    ]),
  }),
  Object.freeze({
    proof_reference_id: 'SEALED_C9_PRODUCT_ASSURANCE',
    commit: SEALED_C9_EVIDENCE_COMMIT,
    path: 'verification/product-truth-20260716/PRODUCT_ASSURANCE_C2_DISPOSITION.json',
    git_blob: '71720f5e2d43735b2125022c44a2973b65b86056',
    sha256: 'a02540e684a52f918e9896c0196d2e46b050d841612a1248a177edfe2a037654',
    byte_length: 4_152,
    required_symbols: Object.freeze([
      '"schema": "product-assurance-c9-disposition.v2"',
      '"binding": "EXACT_CANDIDATE"',
    ]),
  }),
]);

export const HUMAN_EVIDENCE_ARTIFACT_SPECS = Object.freeze([
  Object.freeze({
    path: 'AUTHORITY_RESOLUTION.md',
    selection_id: 'C9_AUTHORITY_PENDING_FRESH_VERIFIER',
    state: 'PENDING_FRESH_VERIFIER',
    actor: 'CAMPAIGN_EVIDENCE_GENERATOR',
    candidate_write_authority: false,
    sha256: 'fce15e57e2bda56c8992ed8fc5c1bbcd9598397e032037bb280b0615cf486e15',
    git_blob: 'f2efdcbc80c56812cdaba03fb04b547a73eb955b',
    byte_length: 1_861,
    proof_reference_ids: Object.freeze(['C9_SOURCE_STATE', 'SEALED_C9_INPUT_LOCK', 'SEALED_C9_PROVENANCE']),
  }),
  Object.freeze({
    path: 'CLEAN_CLONE_ACCEPTANCE.md',
    selection_id: 'C9_CLEAN_CLONE_NOT_RUN',
    state: 'NOT_RUN',
    actor: 'ACCOUNT_A_BUILDER_EVIDENCE_ONLY',
    candidate_write_authority: false,
    sha256: 'c02ba1c3834a8c427b22c4d62a4dd883b322742280f15f40d037b85e7eed1d71',
    git_blob: 'd25aeca6f6641cf970dc0c358d11fcc78f9d3ba3',
    byte_length: 1_535,
    proof_reference_ids: Object.freeze(['C9_SOURCE_STATE', 'SEALED_C9_MANIFEST_V2']),
  }),
  Object.freeze({
    path: 'COMPOSED_RUNTIME_RECEIPT.md',
    selection_id: 'C9_COMPOSED_RUNTIME_NOT_RUN',
    state: 'NOT_RUN',
    actor: 'CAMPAIGN_EVIDENCE_GENERATOR',
    candidate_write_authority: false,
    sha256: '542d1a7c980c91506c84cad742912a01afc1410f092726336dd756519224d1e0',
    git_blob: 'c0bdc25af0dc664221fba287fad60ac3291b5800',
    byte_length: 1_612,
    proof_reference_ids: Object.freeze(['SEALED_C9_PROOF_BINDING', 'SEALED_C9_FINDINGS']),
  }),
  Object.freeze({
    path: 'FINAL_VERDICT.md',
    selection_id: 'C9_FINAL_VERDICT_PENDING_FRESH_VERIFIER',
    state: 'PENDING_FRESH_VERIFIER',
    actor: 'NO_FINAL_VERIFIER_ASSIGNED',
    candidate_write_authority: false,
    sha256: 'd44c5b2dbd44e26295b67c1c58b66b771ee558e103f346238cdc798325fe9b3f',
    git_blob: '472658f3c3977f4a07b4b51d5f1eaed20ab270aa',
    byte_length: 3_256,
    proof_reference_ids: Object.freeze(['SEALED_C9_SELECTION_V2', 'SEALED_C9_FINDINGS', 'SEALED_C9_PRODUCT_ASSURANCE']),
  }),
  Object.freeze({
    path: 'STAGING_OPERATIONAL_RECEIPT.md',
    selection_id: 'C9_STAGING_NOT_CONFIGURED',
    state: 'NOT_CONFIGURED',
    actor: 'NO_STAGING_OPERATOR_ASSIGNED',
    candidate_write_authority: false,
    sha256: 'd7bab7360c0f5dcae594875b118c34cd7c4ea62bd427dc3152acb151ea811144',
    git_blob: '08bc75d86fb221851a07ece9f3a8684a194d0ee9',
    byte_length: 1_677,
    proof_reference_ids: Object.freeze(['SEALED_C9_PROOF_BINDING', 'SEALED_C9_PRODUCT_ASSURANCE']),
  }),
  Object.freeze({
    path: 'UNMERGED_DELTA_REPORT.md',
    selection_id: 'C9_DELTA_REVIEW_BLOCKED_PENDING_FRESH_VERIFIER',
    state: 'BLOCKED:FRESH_FINAL_VERIFIER_PENDING',
    actor: 'CAMPAIGN_EVIDENCE_GENERATOR',
    candidate_write_authority: false,
    sha256: '8681c89fb1301a413911a532cc1e6d577bdac418618fdaa28663d410a464d22f',
    git_blob: 'a907335807ace4241a1683a6990454583624dc2d',
    byte_length: 1_729,
    proof_reference_ids: Object.freeze(['SEALED_C9_CENSUS', 'SEALED_C9_PROVENANCE']),
  }),
]);

export const D_LAUNCH_65_AUTHORITY = Object.freeze({
  commit: '9c8c9f98c7fbd491fb97fce70d723b6c8bed2a4d',
  tree: '7a5fc0d56fec5e3bf5c345bcb7c476896f3509a7',
  parent: 'f0c030d37b762198b1e34d6b689112a433efa4c8',
  path: 'QL_DIRECTOR_STATE.md',
  git_blob: 'e8fb856c19a14c4a5278e4c7c8f7e2cd51a85b12',
  sha256: '9471fef43baf638d7cc8bd958c2e45b881405cc14178cdfb24c78ebec1ed6ffb',
  byte_length: 73_589,
  ruling_lines: '288-289',
  archive_source_commit: '0e4b364849075a454d7dd624ca068c238f4196c2',
  archive_source_tree: '45eb6c6128f0a24cf17d242b704a0079c8e5a6ab',
  archive_subtree: 'bf67e1bb6ba154ef7ae89e2907149d572fa9daa8',
});

export const VFINAL5_AUTHORITY = Object.freeze({
  commit: '6c9e46afda68d6f90b1487462d4f398e4d7cb6b2',
  path: 'docs/archive/campaign-detail-20260716/vfinal3/VFINAL5_RECEIPT.md',
  git_blob: '8fa803e7ee5e40bf93432105e4a819429ada940b',
  sha256: '12f7e1ee77f7340e32d6d77242a8b5f190fc5c7225c546fbc74d2977d1266f72',
  byte_length: 20_403,
  decision: 'REJECTED',
  candidate: '959a5f9900e25f53414710bbfb3464c3ccb67a5d',
});

const control = (legacyId, authority, originalPath, expectedSha256) => ({
  inputId: `control:${legacyId}`,
  legacyId,
  inputClass: 'CONTROLLING_EXTERNAL',
  authority,
  originalPath,
  expectedSha256,
});

const superseded = (legacyId, originalPath, expectedSha256, supersededBy) => ({
  inputId: `superseded:${legacyId}`,
  legacyId,
  inputClass: 'SUPERSEDED_EXTERNAL',
  authority: 'SUPERSEDED_REFERENCE_ONLY',
  originalPath,
  expectedSha256,
  supersededBy,
});

export const EXTERNAL_INPUT_SPECS = Object.freeze([
  control('CAMPAIGN', 'CONTROLLING', '/Users/cosmosgeek/Desktop/INDEPENDENT_PRODUCT_TRUTH_AND_LIVE_READINESS_CAMPAIGN_20260716.md', 'ae9638ba0b8539711d9dc67bab7ef0cd7b3539b0636fc5d78dd172a6c96c4d1b'),
  control('SAFETY_AMENDMENT', 'CONTROLLING_WITH_ROLE_CLAUSE_SUPERSEDED', '/Users/cosmosgeek/Desktop/newCMD.txt', '45c83f3c7cd6b29ad86fcd33500d530da01ed2484610fed52f23b734d2e1fb61'),
  control('ROLE_CORRECTION', 'CONTROLLING', '/Users/cosmosgeek/Desktop/RESPONSE.TXT', '17eb023994a64b917afe6023886226d419dc070e093f5d49e234266c65b1eea5'),
  control('FRONTIER_ACCELERATION', 'ORCHESTRATION_ONLY', '/Users/cosmosgeek/Desktop/OWNER_CONTINUOUS_FRONTIER_ACCELERATION_DIRECTIVE.md', '6abdfe61f3b6aea71cd9fc2cbe02e5d0d7be2deb38cf9e63d1910c9184d93ed4'),
  control('Q_L_LAUNCH', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/DIRECTOR_Q_L_TWO_LANE_LAUNCH.md', '26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06'),
  control('Q_DIRECTIVE', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/QUANT_EDGE_RESEARCH_FACTORY_12H.md', '198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4'),
  control('L_DIRECTIVE', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md', '40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037'),
  control('I00', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5'),
  control('IP_RUNTIME', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_RUNTIME.md', '6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810'),
  control('IP_CONTROL', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_CONTROL.md', '5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278'),
  control('IP_OPS', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_OPS.md', '2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779'),
  control('IP_PROOF', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_PROOF.md', 'e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6'),
  control('POST_I00', 'CONTROLLING_SUBORDINATE', '/Users/cosmosgeek/Desktop/POST_I00_EVENT_DRIVEN_AI_OPERATIONS_ACTIVATION.md', 'cbc523fd18578641f6fcc02a5efb564ac861ca1320fcc189948a0725b41b5195'),
  control('POST_I00_CORRECTION', 'CONTROLLING', '/Users/cosmosgeek/Desktop/command.txt', '4d938de306fb7577d8ff143677e30fb21fc3192da16d554c3a578b59566fb590'),
  control('FRONTIER', 'REFERENCE_ONLY', '/Users/cosmosgeek/Desktop/Frontier.md', '4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad'),
  control('FRONTIER_WRAPPER', 'REFERENCE_ONLY', '/Users/cosmosgeek/Desktop/frontierCommand.txt', '7adf1cd6f841c417ea71da5a29f438640622df2bad2b89c11461348484e2bec0'),
  control('CAMPAIGN_BRIEFING', 'REFERENCE_ONLY', '/Users/cosmosgeek/Desktop/FULL_LOCAL_STATE_BRIEFING_FOR_WEB_COMMANDER_20260716.md', 'd0741f52a87d6b422e5d2a9b6da041ee884829ab060bd4224c84493e7478005a'),
  superseded('ORGAN_PORTFOLIO_PARALLEL_BUILD.md', '/Users/cosmosgeek/Desktop/ORGAN_PORTFOLIO_PARALLEL_BUILD.md', 'b2a9116e49e3d2e89c291a2907e51af217993e638b02d33af469d84dad51aa41', 'Frontier.md'),
  superseded('PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS.md', '/Users/cosmosgeek/Desktop/PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS.md', '47ece80df0e4f5f5d25bc02bfd5f2fbf30a8eff0ae1be78e97df3238d9b506f8', 'Frontier.md'),
  superseded('new.txt', '/Users/cosmosgeek/Desktop/new.txt', '71a2df2e14835148f93310c70fc61c0829ad4ea6e54f7b56c26d405a2418b998', 'current campaign plus amendments'),
  superseded('cmd.txt', '/Users/cosmosgeek/Desktop/cmd.txt', '90dcac299155695f02c232646b23fc78cf4f3febce5ee2e781113896ae5d0da9', 'current campaign plus amendments'),
  superseded('OWNER TIME-OPTIMIZATION AMENDMENT.txt', '/Users/cosmosgeek/Desktop/OWNER TIME-OPTIMIZATION AMENDMENT.txt', '46549feced327d805c6057ecedffc8b65469c6537e5ce64b8c0a4f559eb1da30', 'OWNER_CONTINUOUS_FRONTIER_ACCELERATION_DIRECTIVE.md'),
  superseded('DIRECTOR_FINAL_ASSURANCE_HANDOFF.md', '/Users/cosmosgeek/Desktop/Main/DIRECTOR_FINAL_ASSURANCE_HANDOFF.md', 'da38896c8e7bb42c29afba2094ce48856792da17348cd4cc78904469e199728d', 'IP_ASSURANCE.md'),
]);

export const AUTHORITY_PAYLOAD_SPECS = Object.freeze([
  Object.freeze({
    memberId: 'authority:D_LAUNCH_65',
    sourceCommit: D_LAUNCH_65_AUTHORITY.commit,
    sourcePath: D_LAUNCH_65_AUTHORITY.path,
    expectedSha256: D_LAUNCH_65_AUTHORITY.sha256,
    expectedGitBlob: D_LAUNCH_65_AUTHORITY.git_blob,
    expectedByteLength: D_LAUNCH_65_AUTHORITY.byte_length,
    payloadRelativePath: 'locked-input-payloads/authority-D_LAUNCH_65-QL_DIRECTOR_STATE.md',
  }),
  Object.freeze({
    memberId: 'authority:VFINAL5_RECEIPT',
    sourceCommit: VFINAL5_AUTHORITY.commit,
    sourcePath: VFINAL5_AUTHORITY.path,
    expectedSha256: VFINAL5_AUTHORITY.sha256,
    expectedGitBlob: VFINAL5_AUTHORITY.git_blob,
    expectedByteLength: VFINAL5_AUTHORITY.byte_length,
    payloadRelativePath: 'locked-input-payloads/authority-VFINAL5_RECEIPT.md',
  }),
]);

export const WAVE_ARCHIVE_ORIGINS = Object.freeze({
  PROV_FINDINGS: Object.freeze({ source_path: 'docs/archive/campaign-detail-20260716/shard-receipts/PROV_FINDINGS.json' }),
  CLEAN_CLONE_FINDINGS: Object.freeze({ source_path: 'docs/archive/campaign-detail-20260716/shard-receipts/CLEAN_CLONE_FINDINGS.json' }),
  ACTIVATION_RUNBOOK_DRAFT: Object.freeze({ source_path: 'docs/archive/campaign-detail-20260716/shard-receipts/ACTIVATION_RUNBOOK_DRAFT.md' }),
  CANARY_PRECHECK: Object.freeze({ source_path: 'docs/archive/campaign-detail-20260716/shard-receipts/CANARY_PRECHECK.json' }),
});

export function externalPayloadRelativePath(spec, index) {
  const extension = path.extname(spec.originalPath) || '.bin';
  const safe = spec.legacyId.replace(/[^A-Za-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
  return `locked-input-payloads/${String(index + 1).padStart(2, '0')}-${safe}${extension}`;
}

export const REQUIRED_MATRIX_COUNTS = Object.freeze({
  DIRECTIVE_COVERAGE_MATRIX: 153,
  CAPABILITY_TRUTH_MATRIX: 23,
  COCKPIT_BINDING_MATRIX: 178,
  total: 354,
});
