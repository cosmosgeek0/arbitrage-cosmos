import path from 'node:path';

export const REQUIRED_C2_PARENT = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
export const PREDECESSOR_CANDIDATE = '41752d6a87dc1cb1b933bb4460c9cabfc15ff694';
export const PREDECESSOR_TREE = 'a770f9f393e6229252731cd5247e9a1abfd2e509';
export const CAMPAIGN_BRANCH = 'truth-campaign-20260716';
export const LOCK_INVENTORY_MATRIX_REQUIREMENT_ID = 'CAMP-09-PROVENANCE';

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
