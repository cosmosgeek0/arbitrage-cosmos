#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'verification/product-truth-20260716');
const UNBOUND = 'SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT';
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const candidateArg = process.argv.indexOf('--candidate');
const candidate = candidateArg >= 0 ? process.argv[candidateArg + 1] : null;
if (candidateArg >= 0 && !FULL_SHA.test(candidate ?? '')) throw new Error('CANDIDATE_SHA_REQUIRED');
const candidateToken = candidate ?? UNBOUND;

function run(command, args, { allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding,
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 128 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${String(result.status)}): ${String(result.stderr)}`);
  }
  return result;
}

function git(...args) { return run('git', args).stdout.trim(); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function fileBytes(file) { return readFileSync(file); }
function fileSha(file) { return sha256(fileBytes(file)); }
function contentOid(file) { return run('git', ['hash-object', '--no-filters', file]).stdout.trim(); }
function candidateBytes(relativePath) {
  return candidate === null
    ? fileBytes(path.join(ROOT, relativePath))
    : run('git', ['show', `${candidate}:${relativePath}`], { encoding: null }).stdout;
}
function candidateBlob(relativePath) {
  return candidate === null ? null : git('rev-parse', `${candidate}:${relativePath}`);
}
function assertExpected(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}_DRIFT:${actual}:${expected}`);
}

if (candidate !== null) {
  run('git', ['cat-file', '-e', `${candidate}^{commit}`]);
}

const externalInputs = [
  ['CAMPAIGN', 'CONTROLLING', '/Users/cosmosgeek/Desktop/INDEPENDENT_PRODUCT_TRUTH_AND_LIVE_READINESS_CAMPAIGN_20260716.md', 'ae9638ba0b8539711d9dc67bab7ef0cd7b3539b0636fc5d78dd172a6c96c4d1b'],
  ['SAFETY_AMENDMENT', 'CONTROLLING_WITH_ROLE_CLAUSE_SUPERSEDED', '/Users/cosmosgeek/Desktop/newCMD.txt', '45c83f3c7cd6b29ad86fcd33500d530da01ed2484610fed52f23b734d2e1fb61'],
  ['ROLE_CORRECTION', 'CONTROLLING', '/Users/cosmosgeek/Desktop/RESPONSE.TXT', '17eb023994a64b917afe6023886226d419dc070e093f5d49e234266c65b1eea5'],
  ['FRONTIER_ACCELERATION', 'ORCHESTRATION_ONLY', '/Users/cosmosgeek/Desktop/OWNER_CONTINUOUS_FRONTIER_ACCELERATION_DIRECTIVE.md', '6abdfe61f3b6aea71cd9fc2cbe02e5d0d7be2deb38cf9e63d1910c9184d93ed4'],
  ['Q_L_LAUNCH', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/DIRECTOR_Q_L_TWO_LANE_LAUNCH.md', '26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06'],
  ['Q_DIRECTIVE', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/QUANT_EDGE_RESEARCH_FACTORY_12H.md', '198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4'],
  ['L_DIRECTIVE', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md', '40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037'],
  ['I00', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5'],
  ['IP_RUNTIME', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_RUNTIME.md', '6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810'],
  ['IP_CONTROL', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_CONTROL.md', '5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278'],
  ['IP_OPS', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_OPS.md', '2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779'],
  ['IP_PROOF', 'CONTROLLING_PROTECTED_OWNER_INPUT', '/Users/cosmosgeek/Desktop/Main/IP_PROOF.md', 'e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6'],
  ['POST_I00', 'CONTROLLING_SUBORDINATE', '/Users/cosmosgeek/Desktop/POST_I00_EVENT_DRIVEN_AI_OPERATIONS_ACTIVATION.md', 'cbc523fd18578641f6fcc02a5efb564ac861ca1320fcc189948a0725b41b5195'],
  ['POST_I00_CORRECTION', 'CONTROLLING', '/Users/cosmosgeek/Desktop/command.txt', '4d938de306fb7577d8ff143677e30fb21fc3192da16d554c3a578b59566fb590'],
  ['FRONTIER', 'REFERENCE_ONLY', '/Users/cosmosgeek/Desktop/Frontier.md', '4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad'],
  ['FRONTIER_WRAPPER', 'REFERENCE_ONLY', '/Users/cosmosgeek/Desktop/frontierCommand.txt', '7adf1cd6f841c417ea71da5a29f438640622df2bad2b89c11461348484e2bec0'],
  ['CAMPAIGN_BRIEFING', 'REFERENCE_ONLY', '/Users/cosmosgeek/Desktop/FULL_LOCAL_STATE_BRIEFING_FOR_WEB_COMMANDER_20260716.md', 'd0741f52a87d6b422e5d2a9b6da041ee884829ab060bd4224c84493e7478005a'],
];

const supersededExternal = [
  ['ORGAN_PORTFOLIO_PARALLEL_BUILD.md', '/Users/cosmosgeek/Desktop/ORGAN_PORTFOLIO_PARALLEL_BUILD.md', 'b2a9116e49e3d2e89c291a2907e51af217993e638b02d33af469d84dad51aa41', 'Frontier.md'],
  ['PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS.md', '/Users/cosmosgeek/Desktop/PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS.md', '47ece80df0e4f5f5d25bc02bfd5f2fbf30a8eff0ae1be78e97df3238d9b506f8', 'Frontier.md'],
  ['new.txt', '/Users/cosmosgeek/Desktop/new.txt', '71a2df2e14835148f93310c70fc61c0829ad4ea6e54f7b56c26d405a2418b998', 'current campaign plus amendments'],
  ['cmd.txt', '/Users/cosmosgeek/Desktop/cmd.txt', '90dcac299155695f02c232646b23fc78cf4f3febce5ee2e781113896ae5d0da9', 'current campaign plus amendments'],
  ['OWNER TIME-OPTIMIZATION AMENDMENT.txt', '/Users/cosmosgeek/Desktop/OWNER TIME-OPTIMIZATION AMENDMENT.txt', '46549feced327d805c6057ecedffc8b65469c6537e5ce64b8c0a4f559eb1da30', 'OWNER_CONTINUOUS_FRONTIER_ACCELERATION_DIRECTIVE.md'],
  ['DIRECTOR_FINAL_ASSURANCE_HANDOFF.md', '/Users/cosmosgeek/Desktop/Main/DIRECTOR_FINAL_ASSURANCE_HANDOFF.md', 'da38896c8e7bb42c29afba2094ce48856792da17348cd4cc78904469e199728d', 'IP_ASSURANCE.md'],
];

const trackedInputs = [
  ['STATE', 'STATE.md', 'CONTROLLING_PRODUCT_STATE'],
  ['MISSION', 'MISSION.md', 'PERMANENT_LAW'],
  ['ARCHITECTURE', 'ARCHITECTURE.md', 'PERMANENT_LAW'],
  ['DESIGN', 'DESIGN.md', 'PERMANENT_UI_LAW'],
  ['DIRECTOR', 'DIRECTOR.md', 'CONTROLLING_PROCESS_LAW'],
  ['AGENTS', 'AGENTS.md', 'CONTROLLING_REPOSITORY_LAW'],
  ['HANDOFF', 'DIRECTOR_HANDOFF_TRUTH_CAMPAIGN.md', 'REFERENCE_ONLY'],
  ['EDGE_PROTOCOL', 'EDGE_PROTOCOL_V1.md', 'PERMANENT_PROTOCOL_LAW'],
  ['IP_ASSURANCE', 'IP_ASSURANCE.md', 'CONTROLLING_ASSURANCE_LAW'],
  ['QL_DIRECTOR_STATE', 'QL_DIRECTOR_STATE.md', 'CONTROLLING_CANDIDATE_DIRECTOR_STATE'],
  ['QL_PARALLEL_DAG', 'QL_PARALLEL_DAG.md', 'CONTROLLING_CANDIDATE_DIRECTOR_DAG'],
  ['Q_LOCK', 'quant/DIRECTIVE_INPUTS.lock', 'SUPPORTING_LOCK'],
  ['L_LOCK', 'live-edge-receipts/DIRECTIVE_INPUTS.lock', 'SUPPORTING_LOCK'],
  ['PROTECTED_BUNDLE', 'test/i00/performance/protected-owner-directives.bundle.v1.json', 'PACKAGED_VERIFIER_INPUT_SNAPSHOT_ONLY'],
];

const supersededTrackedPaths = [
  'docs/archive/SUPERSEDED_BY_IP_ASSURANCE_AT_5f6d4b3b70e3.md',
  'docs/archive/BLUEPRINT.md',
  'docs/archive/DIRECTOR_RULEBOOK.md',
  'docs/archive/SYSTEM_AUTHORITY_MAP.md',
  'docs/archive/DESIGN_PLAYBOOK.md',
  'docs/archive/UI_SURFACE_BASELINE.md',
  'docs/archive/ENGINE_SPRINT_5H.md',
  'docs/archive/PARALLEL_BACKEND_MAX_POWER_SPRINT.md',
  'docs/archive/MARKET_INTELLIGENCE_MAX_POWER_SPRINT.md',
  'docs/archive/LIVE_INTELLIGENCE_RUNTIME_MAX_POWER_SPRINT.md',
  'docs/archive/CAPITAL_SUPERVISION_MAX_POWER_SPRINT.md',
  'docs/archive/SYSTEM_CONVERGENCE_VERTICAL_SLICE_MAX_POWER_SPRINT.md',
];

const absentSuperseded = [
  ['FINAL_GAP_EXECUTION_ORDER.md', 'I00'],
  ['FINAL_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP_DAG.md', 'I00'],
  ['FINAL_MASTER_PRODUCT_CLOSURE_AUTONOMY_AND_BRINGUP_ORDER.md', 'I00'],
  ['I00_LLM_DIAGNOSTIC_RUNTIME_ACTIVATION_AND_CODE_REPAIR_BINDING.md', 'POST_I00'],
  ['SENTINEL_RESIDENT_AI_OPERATIONS_PROGRAM.md', 'POST_I00'],
  ['AI_OPS_ACTIVATION_ADDENDUM_FOR_DIRECTOR.md', 'POST_I00_CORRECTION'],
  ['Frontier(1).md and unnamed earlier Frontier drafts', 'FRONTIER'],
  ['DIRECTOR_VERDICT_GAP_AUDIT.md', 'CAMPAIGN'],
];

function measuredExternal([id, authority, absolutePath, expectedSha256]) {
  if (!existsSync(absolutePath)) throw new Error(`CONTROLLING_INPUT_MISSING:${id}:${absolutePath}`);
  const observed = fileSha(absolutePath);
  assertExpected(`CONTROLLING_INPUT_${id}`, observed, expectedSha256);
  return {
    id,
    authority,
    absolute_path: absolutePath,
    sha256: observed,
    content_oid: contentOid(absolutePath),
    byte_length: statSync(absolutePath).size,
    candidate_presence: false,
  };
}

function measuredTracked([id, relativePath, authority]) {
  const bytes = candidateBytes(relativePath);
  return {
    id,
    authority,
    relative_path: relativePath,
    candidate_commit: candidate,
    git_blob: candidateBlob(relativePath),
    sha256: sha256(bytes),
    byte_length: bytes.length,
    candidate_presence: true,
  };
}

const waveFiles = [
  ['PROV_FINDINGS', 'wave1-inputs/PROV_FINDINGS.json', 'b0e06ead6b8280545c36ab7b8d5f58de75819dfa653c51dde7c09f720efe71fc', 'DEFECT_INPUT'],
  ['CLEAN_CLONE_FINDINGS', 'wave1-inputs/CLEAN_CLONE_FINDINGS.json', '0c8c59354486db404334107470865d4255ce0049dfcd38701fe0eb163c23250c', 'DEFECT_INPUT'],
  ['ACTIVATION_RUNBOOK_DRAFT', 'wave1-inputs/ACTIVATION_RUNBOOK_DRAFT.md', '81b516dc6b69fe482bdaded03f6ce424de9a89b080bd03c2287d87a9176d1b00', 'REFERENCE_LATER_OWNER_GATE'],
  ['CANARY_PRECHECK', 'wave1-inputs/CANARY_PRECHECK.json', '02c4181f49385a2f8d9620babeead4a4a94506e7586dae1e6613ae944d623f92', 'REFERENCE_LATER_OWNER_GATE'],
].map(([id, relative, expected, disposition]) => {
  const relativePath = `verification/product-truth-20260716/${relative}`;
  const measured = measuredTracked([id, relativePath, disposition]);
  assertExpected(`WAVE_INPUT_${id}`, measured.sha256, expected);
  return measured;
});

const dLaunch62Bytes = run('git', ['show', '2a832750f83137a8912c9f70e0b634b856f10aab:QL_DIRECTOR_STATE.md'], { encoding: null }).stdout;
assertExpected('D_LAUNCH_62_DIRECTOR_STATE_SHA256', sha256(dLaunch62Bytes), '95d4c2766451b7e126dc9cb411d68667a0fd1d8736f95d5cdff86015448074fd');
assertExpected('D_LAUNCH_62_DIRECTOR_STATE_BLOB', git('rev-parse', '2a832750f83137a8912c9f70e0b634b856f10aab:QL_DIRECTOR_STATE.md'), '20d2ab2f2e11c09a60ceb247ae14d9a80d7d93d5');

const inputLock = {
  schema: 'product-truth-inputs-lock.v3',
  binding: candidate === null ? 'SOURCE_COMMIT_CANNOT_SELF_NAME' : 'EXACT_CANDIDATE',
  candidate: candidate,
  candidate_token: candidateToken,
  candidate_tree: candidate === null ? null : git('rev-parse', `${candidate}^{tree}`),
  candidate_branch: 'truth-campaign-20260716',
  source_base_main: '2ae812624f20b9bc93fc4ad66cb568929101110f',
  d_launch_62: {
    commit: '2a832750f83137a8912c9f70e0b634b856f10aab',
    path: 'QL_DIRECTOR_STATE.md',
    git_blob: '20d2ab2f2e11c09a60ceb247ae14d9a80d7d93d5',
    sha256: '95d4c2766451b7e126dc9cb411d68667a0fd1d8736f95d5cdff86015448074fd',
    authority: 'CONTROLLING_DEFECT_WAVE_RECEIPT',
  },
  historical_d_launch_61_custody: {
    applies_to_candidate: '41752d6a87dc1cb1b933bb4460c9cabfc15ff694',
    receipt_path: 'verification/product-truth-20260716/D_LAUNCH_61_CUSTODY_RECEIPT.json',
    director_receipt_commit: 'b4d9f22d3732003f2cc5cec1f11a87833a933209',
    director_state_blob: 'bf7e7c09aa84af046dc8ff1750098da5e89e8076',
    director_state_sha256: '0d39a06b622f67a455d461bc033d6e7ef4bcc78f063c7cf6a6ad61e989db546e',
    remote_head: 'd2c4f43caf9ad7a84cfde8da8760cc9895384538',
    bundle_sha256: '775c55d26474578100b03d0cb45575b9cf95cc6ab012c709c963e4dd6b8ffe37',
    c2_custody_effect: 'NONE; OLD_C_CUSTODY_DOES_NOT_TRANSFER_TO_C2',
  },
  controlling_external_inputs: externalInputs.map(measuredExternal),
  candidate_tracked_law_and_locks: trackedInputs.map(measuredTracked),
  defect_wave_inputs: waveFiles,
  deployment_authority: {
    kind: 'COMPOSITE_NO_STANDALONE_DIRECTIVE',
    member_ids: ['CAMPAIGN', 'I00', 'IP_OPS', 'L_DIRECTIVE', 'POST_I00'],
    state: 'NOT_CONFIGURED; DEFERRED_OWNER_GATE',
    implementation_evidence: [
      'ops/i00/l15-amendment-contract.json',
      'docs/archive/i00-phase2/L15_INFRA_INTEGRATION_RECEIPT.md',
      'ops/docs/i00/ACTIVATION_AND_BOUNDARY_RUNBOOK.md',
      'ops/docs/i00/RELEASE_AND_RECOVERY_RUNBOOK.md',
    ].map((relativePath) => measuredTracked([relativePath, relativePath, 'IMPLEMENTATION_EVIDENCE_NOT_AUTHORITY'])),
  },
  superseded_reference_inputs: [
    ...supersededTrackedPaths.map((relativePath) => measuredTracked([
      relativePath,
      relativePath,
      'SUPERSEDED_REFERENCE_ONLY',
    ])),
    ...supersededExternal.map(([id, absolutePath, expectedSha256, supersededBy]) => ({
      ...measuredExternal([id, 'SUPERSEDED_REFERENCE_ONLY', absolutePath, expectedSha256]),
      superseded_by: supersededBy,
    })),
  ],
  absent_named_superseded_inputs: absentSuperseded.map(([name, supersededBy]) => ({
    name,
    content_available: false,
    sha256: null,
    git_blob: null,
    disposition: 'ABSENT_SUPERSEDED_REFERENCE_ONLY',
    superseded_by: supersededBy,
  })),
  protected_input_law: 'Physical protected owner inputs remain outside C2; exact external bytes are locked directly. The packaged verifier snapshot is supporting evidence only.',
};
inputLock.inventory_counts = {
  controlling_external: inputLock.controlling_external_inputs.length,
  candidate_tracked_law_and_locks: inputLock.candidate_tracked_law_and_locks.length,
  defect_wave_inputs: inputLock.defect_wave_inputs.length,
  superseded_available: inputLock.superseded_reference_inputs.length,
  superseded_named_absent: inputLock.absent_named_superseded_inputs.length,
  total_directive_law_lock_and_wave_rows: inputLock.controlling_external_inputs.length
    + inputLock.candidate_tracked_law_and_locks.length
    + inputLock.defect_wave_inputs.length
    + inputLock.superseded_reference_inputs.length
    + inputLock.absent_named_superseded_inputs.length,
};
writeFileSync(path.join(OUT, 'INPUTS.lock'), `${JSON.stringify(inputLock, null, 2)}\n`);

function parseCsv(text) {
  const table = [];
  let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); table.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  const [headers, ...values] = table.filter((entry) => entry.some(Boolean));
  return { headers, rows: values.map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] ?? '']))) };
}
function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function emitCsv(file, headers, rows) {
  const body = [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
  writeFileSync(path.join(OUT, file), `${body}\n`);
}

const coveragePath = path.join(OUT, 'DIRECTIVE_COVERAGE_MATRIX.csv');
const coverage = parseCsv(candidateBytes('verification/product-truth-20260716/DIRECTIVE_COVERAGE_MATRIX.csv').toString('utf8'));
const byId = new Map(coverage.rows.map((row) => [row.requirement_id, row]));
for (const row of coverage.rows) row.candidate_sha = candidateToken;
const replacements = {
  'server/test/**/basis*': 'server/test/engine-basis.mjs',
  'server/test/**/volume*': 'server/test/engine-volume.mjs',
  'web/src/features/productControlRoom/**/*.test*': 'web/test/productControlRoom/**',
  'test/i00/security/**': 'server/test/i00Acceptance/security-boundary.test.mjs; test/i00/scope-security.mjs',
  'test/i00/authority/**': 'server/test/i00Acceptance/authority-protocol.test.mjs',
  'server/src/foundation/ledger': 'server/src/ledger.ts',
  'test/i00/browser/**': 'test/i00/performance/acceptance-contract.test.mjs; test/i00/performance/local-acceptance.mjs',
  'test/i00/performance/protected-owner-directives.bundle.test.ts': 'test/i00/performance/performance.test.mjs',
};
for (const row of coverage.rows) {
  for (const field of ['implementation_path', 'test_path']) {
    for (const [bad, good] of Object.entries(replacements)) row[field] = row[field].replaceAll(bad, good);
  }
  row.test_path = row.test_path.replaceAll('prospective test/aiOps', 'port-local server/test/aiOps');
}
function patchRow(id, patch) {
  const row = byId.get(id); if (!row) throw new Error(`COVERAGE_ROW_MISSING:${id}`); Object.assign(row, patch);
}
patchRow('MIS-002', { test_path: 'server/test/engine-basis.mjs; server/test/engine-volume.mjs; quant/tests/**' });
patchRow('MIS-004', { test_path: 'server/test/productIntegration/**; web/test/productControlRoom/**' });
patchRow('MIS-007', { test_path: 'server/test/foundation/execution/execution.mjs; server/test/liveEdge/**; server/test/i00Acceptance/security-boundary.test.mjs; test/i00/scope-security.mjs' });
patchRow('MIS-008', { implementation_path: 'server/src/ledger.ts; server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts', test_path: 'server/test/systemIntegration/persistence/ledger-cas.test.mjs; server/test/systemIntegration/persistence/live-edge-mutation-journal-adapter.test.mjs' });
patchRow('ARC-001', { test_path: 'server/test/engine-basis.mjs' });
patchRow('ARC-002', { test_path: 'server/test/engine-volume.mjs' });
patchRow('ARC-007', { implementation_path: 'server/src/ledger.ts; server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts', test_path: 'server/test/systemIntegration/persistence/ledger-cas.test.mjs; server/test/systemIntegration/persistence/live-edge-mutation-journal-adapter.test.mjs' });
patchRow('ARC-010', { test_path: 'server/test/i00Acceptance/authority-protocol.test.mjs; server/test/systemIntegration/**' });
patchRow('AUTH-003', {
  runtime_evidence: candidate === null
    ? 'D-LAUNCH-61 custody is historical old-C evidence only; C2 is not yet frozen and has no off-machine custody'
    : `Exact C2 ${candidate} is frozen locally; D-LAUNCH-61 remote head d2c4f43c… and bundle 775c55d2… cover old C only`,
  status: candidate === null ? 'BUILDING' : 'BLOCKED',
  blocker: candidate === null ? 'C2_NOT_YET_FROZEN' : 'C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED',
  disposition: 'Only exact C2 may be handed forward after new custody; Wave 1b independently blocks final-verifier handoff',
});
patchRow('DEP-004', {
  runtime_evidence: 'No C2 baseline token, staging deployment, target readback, or rollback has been issued',
  status: 'DEFERRED_OWNER_GATE',
  blocker: 'C2 custody, Wave 1b, independent verification, later operational gates, and explicit deployment authority remain absent',
  disposition: 'No deployment acceptance is implied by a local source/test freeze',
});
patchRow('CAMP-05-CENSUS', {
  runtime_evidence: 'Prior 101-worktree census is historical old-C evidence; exact-C2 post-freeze census is regenerated in the evidence descendant',
  status: candidate === null ? 'BUILDING' : 'BLOCKED',
  blocker: candidate === null ? 'C2_NOT_YET_FROZEN' : 'EXACT_C2_POST_FREEZE_CENSUS_PENDING_OR_SEPARATELY_ATTESTED',
  disposition: 'No old-C census is relabeled as C2 evidence',
});
patchRow('CAMP-07-PASS0', {
  runtime_evidence: candidate === null
    ? 'D-LAUNCH-62 Wave 1 source repair in progress; C2 not frozen'
    : `Exact C2 ${candidate} is locally frozen; off-machine custody is not established`,
  status: 'BLOCKED',
  blocker: candidate === null ? 'C2_NOT_YET_FROZEN' : 'C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED',
  disposition: 'No BASELINE_TRUTH_ACCEPTED token for C2 without new custody',
});
patchRow('CAMP-20-LADDER', {
  runtime_evidence: 'No C2 acceptance token has been issued; later gates are not implied',
  status: 'BLOCKED',
  blocker: candidate === null ? 'C2_NOT_YET_FROZEN' : 'C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED',
  disposition: 'Stop at exact candidate-local gate report or precise blocker',
});
patchRow('CAMP-21-STOP', {
  runtime_evidence: candidate === null
    ? 'Expected source stop: BLOCKED:C2_NOT_YET_FROZEN'
    : 'Expected Account-A stop absent custody: BLOCKED:C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED',
  status: 'BLOCKED',
  blocker: candidate === null ? 'C2_NOT_YET_FROZEN' : 'C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED',
  disposition: 'Final-verifier handoff additionally remains blocked pending Wave 1b',
});
patchRow('AIO-002', { implementation_path: 'server/src/aiOps/adapters/providerGateway.ts; server/src/aiOps/adapters/providerMatrix.ts; server/src/aiOps/adapters/syntheticProviderAdapters.ts', test_path: 'server/test/aiOps/a3/providerCliMatrix.test.mjs; server/test/aiOps/a3/toolEgress.test.mjs (port-local, excluded from C2 baseline)', runtime_evidence: 'Provider gateway source is inert; provider activation/runtime NOT_CONFIGURED', status: 'NOT_CONFIGURED', blocker: 'AI provider and worker owner mounts NOT_CONFIGURED', disposition: 'Source integrated; root acceptance explicitly excluded' });
patchRow('AIO-008', { implementation_path: 'NONE_IN_C2: server/src/aiOps/verifier/** and ops/aiOps/sentinel/** absent', test_path: 'server/test/aiOps/a5/ai-off-survival.test.mjs (synthetic port evidence only; excluded from C2 baseline)', runtime_evidence: 'Independent verifier, external sentinel, and paging destination NOT_CONFIGURED', status: 'NOT_CONFIGURED', blocker: 'EXTERNAL_SENTINEL_AND_PAGING_NOT_CONFIGURED', disposition: 'No deployed delivery proof; synthetic AI-off fixtures are reference only' });
patchRow('AIO-011', { implementation_path: 'web/src/aiOps/AiOpsWorkspace.tsx isolated source; web/src/App.tsx canonical mount absent', test_path: 'web/test/aiOps/** source/port tests excluded from C2 baseline; generator mount-absence probe', runtime_evidence: 'AI-Ops route UNWIRED', status: 'UNWIRED', blocker: 'CANONICAL_PRODUCT_ROUTE_UNWIRED', disposition: 'No canonical product route or production read model' });
patchRow('DEP-003', { implementation_path: 'NONE_IN_C2: ops/aiOps/sentinel/** absent; ops/live/** is local scaffolding only', test_path: 'generate-wave1-evidence.mjs absence probe; no deployed paging test exists', runtime_evidence: 'No external sentinel or paging delivery receipt', status: 'NOT_CONFIGURED', blocker: 'EXTERNAL_SENTINEL_AND_PAGING_NOT_CONFIGURED', disposition: 'Local logs are not external paging' });

const baseRow = (id, source, section, owner, implementation, test, status, blocker, disposition, extra = {}) => ({
  requirement_id: id,
  source_file: source,
  source_section: section,
  authority: extra.authority ?? 'Permanent/campaign law',
  owner,
  implementation_path: implementation,
  test_path: test,
  cockpit_surface: extra.cockpit ?? 'none',
  runtime_evidence: extra.runtime ?? 'candidate source and exact-C2 campaign evidence',
  donor_sha: extra.donor ?? 'NONE',
  candidate_sha: candidateToken,
  status,
  blocker,
  disposition,
});
const additions = [
  baseRow('MIS-012', 'MISSION.md', '§First adapter anti-expansion law', 'intelligenceRuntime plus System Integration adapter', 'server/src/intelligenceRuntime/contracts/sourceCatalog.ts; server/src/systemIntegration/adapters/sourceRegistry.ts', 'server/test/intelligenceRuntime/contracts/contracts.test.mjs; server/test/systemIntegration/adapters/source-and-engine.scenarios.test.mjs', 'INTEGRATED', 'Future venue identities NOT_CONFIGURED', 'Binance-first public source; no duplicate producer'),
  baseRow('MIS-013', 'MISSION.md', '§Full new-lens contract', 'intelligenceFoundation', 'server/src/intelligenceFoundation/contracts/types.ts; server/src/intelligenceRuntime/contracts/sourceCatalog.ts', 'server/test/intelligenceFoundation/contracts/contracts.test.mjs; server/test/intelligenceRuntime/contracts/contracts.test.mjs', 'NOT_CONFIGURED', 'No single descriptor enforces the complete new-lens admission contract', 'No new lens admitted; no predictive/value claim'),
  baseRow('MIS-014', 'MISSION.md; AGENTS.md; DIRECTOR.md', '§Bounded agents', 'Canonical deterministic owners', 'server/src/foundation/control; server/src/intelligenceFoundation/contracts', 'server/test/foundation/control/control.mjs; server/test/intelligenceFoundation/contracts/contracts.test.mjs', 'INTEGRATED', 'AI provider/workers NOT_CONFIGURED', 'Only bounded deterministic components are accepted'),
  baseRow('MIS-015', 'MISSION.md', '§Structurally-real runtime and UI verification', 'Product Integration', 'server/src/productIntegration/runtime; web/src/features/productControlRoom', 'server/test/productIntegration/**; web/test/productControlRoom/**; test/i00/performance/local-acceptance.mjs', 'BLOCKED', 'EXACT_C2_RENDERED_BROWSER_RECEIPT_NOT_PRODUCED', 'Source tests do not substitute for rendered browser truth', { cockpit: 'Control Room' }),
  baseRow('MIS-016', 'MISSION.md; AGENTS.md', '§Must-never-become constraints', 'Foundation and System Integration', 'server/src/foundation/execution; server/src/productIntegration; server/src/systemIntegration', 'server/test/foundation/execution/execution.mjs; server/test/i00Acceptance/security-boundary.test.mjs; test/i00/scope-security.mjs; web/test/productControlRoom/legacy-boundary.test.mjs', 'INTEGRATED', 'Forbidden money capabilities remain NOT_CONFIGURED', 'LIVE_EXECUTION_NOT_IMPLEMENTED and no-secret/no-fake-UI boundaries remain enforced'),
  baseRow('MIS-017', 'MISSION.md', '§Official-document reverification', 'Canonical source owners', 'OFFICIAL_INTERFACE_MATRIX.md; fixtures/i00/closure-evidence.json', 'server/test/i00Acceptance/closure-evidence.test.mjs', 'REFERENCE_ONLY', 'Future interface edits or activation require fresh official-doc checks', 'Dated unchanged interface facts only'),
  baseRow('ARC-011', 'ARCHITECTURE.md', 'Part II cross-engine projection law', 'Foundation read model', 'server/src/foundation/readModel; server/src/systemIntegration/adapters/engineCapture.ts', 'server/test/foundation/readModel/read-model.mjs; server/test/systemIntegration/adapters/source-and-engine.scenarios.test.mjs', 'INTEGRATED', 'NONE', 'Projection only; strategy owners remain Basis and Volume'),
  baseRow('ARC-012', 'ARCHITECTURE.md', 'Part II active-position exact attribution', 'capitalFoundation', 'server/src/capitalFoundation/positions/projection.ts; server/src/capitalFoundation/supervision; server/src/capitalFoundation/actions; server/src/capitalFoundation/economics', 'server/test/capitalFoundation/positions/projection.test.mjs; server/test/capitalFoundation/supervision/supervision.test.mjs; server/test/capitalFoundation/actions/actions.test.mjs; server/test/capitalFoundation/economics/economics.test.mjs', 'INTEGRATED', 'Private/exchange runtime truth NOT_CONFIGURED', 'Exact source attribution; no fabricated private truth'),
  baseRow('ARC-013', 'ARCHITECTURE.md; AGENTS.md', 'Part II signed-action absence', 'ABSENT_FUTURE_AUDITED_ADAPTER', 'NONE; rejection boundary server/src/foundation/execution', 'server/test/foundation/execution/execution.mjs; server/test/i00Acceptance/security-boundary.test.mjs; test/i00/scope-security.mjs', 'NOT_CONFIGURED', 'LIVE_EXECUTION_NOT_IMPLEMENTED', 'Permanent absence is an enforced boundary, not a missing candidate feature'),
  baseRow('I00-014', 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', 'Incident acknowledgement control', 'Canonical incident command owner absent', 'NONE; server/src/productIntegration/runtime/systemControlCommandOwner.ts enumerates the boundary', 'server/test/productIntegration/runtime/system-control-command-owner.test.mjs; server/test/i00Acceptance/closure-evidence.test.mjs', 'NOT_CONFIGURED', 'INCIDENT_ACK_COMMAND_OWNER_ABSENT', 'Ledger CAS shape exists but no ack command/API/readback; acknowledgement must not clear root cause'),
  baseRow('I00-015', 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', 'Source isolation control', 'intelligenceRuntime lifecycle owner absent', 'NONE; server/src/productIntegration/runtime/systemControlCommandOwner.ts; server/src/systemIntegration/application/facade.ts', 'server/test/productIntegration/runtime/system-control-command-owner.test.mjs; server/test/i00Acceptance/closure-evidence.test.mjs', 'NOT_CONFIGURED', 'CANONICAL_SOURCE_ISOLATION_COMMAND_ABSENT; INDIVIDUAL_COMPONENT_CONTROL_NOT_SUPPORTED', 'No source-specific lifecycle adapter/readback'),
  baseRow('BRI-001', 'ARCHITECTURE.md; campaign', 'Cross-domain adapter law; §2.1 item 8', 'SYSTEM_INTEGRATION_ADAPTER', 'server/src/systemIntegration/adapters/foundationQuantityBridge.ts', 'server/test/systemIntegration/adapters/foundation-quantity-bridge.test.mjs', 'INTEGRATED', 'Production consumer NOT_CONFIGURED', 'Closed comparison only; no action schema, quantity mutation, allocation, execution, or send authority', { runtime: 'MONEY_PATH_AUTHORITY_EVIDENCE.json quantity probe' }),
];

const frontierTips = {
  F0: 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5', F1: 'e435c1f0c6850b2c53501d3410dd5ce92b64b286', F2: '56a08f4efb3f1b82205c4265c1dd18bbd1a70209', F3: '3c9c794e88513bee340f336c5fc4d2dd8eebf47e', F8: '7a658b9850f743b944c35253568ae4a231a768b0', F13: '2c29de4e4d01e8087c00e79f180b731790943baa',
};
const frontierNames = ['Dock', 'VenueMesh', 'PortfolioLab', 'StrategyArena', 'OperatorGym', 'ChangeRadar', 'Nerve', 'Chronos', 'EdgeMeter', 'Narrator', 'Lineage', 'LabelForge', 'ScenarioBank', 'DecisionLab'];
additions.push(baseRow('FRT-000', 'Frontier.md', '§§0-2,10-13,17-18', 'FRONTIER_REFERENCE_OWNER', 'NONE_IN_C2: frontier/** count 0', 'WORKTREE_CENSUS.json; generate-wave1-evidence.mjs exclusion assertions', 'REFERENCE_ONLY', 'FRONTIER_PORT_AUTHORIZED absent', '20 Frontier worktrees ABANDONED_SAFE; all parked branches excluded', { donor: '887221418345ad54d7b98881b359fab85a6188e6', runtime: 'Frontier SHA-256 4bb325b2…; candidate frontier path count 0' }));
frontierNames.forEach((name, index) => {
  const id = `F${index}`;
  const tip = frontierTips[id] ?? 'f0168cb37bd04d21bc90591ab2256770de3b75bc';
  const blocker = index === 13 ? 'BLOCKED_OWNER_POLICY_ARTIFACT_UNAVAILABLE' : [4, 5, 6, 7, 9, 10].includes(index) ? 'BLOCKED_OWNER_MOVING' : index === 11 ? 'ANNOTATION_ADAPTER_BLOCKED' : index === 12 ? 'NOT_LAUNCHED' : 'FRONTIER_PORT_AUTHORIZED absent';
  additions.push(baseRow(`FRT-${String(index + 1).padStart(3, '0')}`, 'Frontier.md', `F${index} ${name}`, `FRONTIER_F${index}`, 'NONE_IN_C2; parked donor/scout only', 'Module-local receipt tests are REFERENCE_ONLY; WORKTREE_CENSUS.json', 'REFERENCE_ONLY', blocker, 'ABANDONED_SAFE; excluded from C2; PRESTAGE_READY/scaffold status is not candidate admission', { donor: tip, runtime: `${name} disposition is candidate-bound exclusion evidence` }));
});
additions.push(
  baseRow('FRT-SUP-001', 'ORGAN_PORTFOLIO_PARALLEL_BUILD.md', 'Frontier source disposition', 'SUPERSEDED_REFERENCE_ONLY', 'NONE', 'NONE', 'REFERENCE_ONLY', 'Superseded by Frontier.md', 'SUPERSEDED_REFERENCE_ONLY; hash locked in INPUTS.lock'),
  baseRow('FRT-SUP-002', 'PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS.md', 'Frontier source disposition', 'SUPERSEDED_REFERENCE_ONLY', 'NONE', 'NONE', 'REFERENCE_ONLY', 'Superseded by Frontier.md', 'SUPERSEDED_REFERENCE_ONLY; hash locked in INPUTS.lock'),
);

for (const row of additions) {
  if (byId.has(row.requirement_id)) Object.assign(byId.get(row.requirement_id), row);
  else { coverage.rows.push(row); byId.set(row.requirement_id, row); }
}
const requiredIds = additions.map((row) => row.requirement_id);
if (new Set(coverage.rows.map((row) => row.requirement_id)).size !== coverage.rows.length) throw new Error('DUPLICATE_COVERAGE_ID');
for (const id of requiredIds) if (!byId.has(id)) throw new Error(`REQUIRED_COVERAGE_ROW_MISSING:${id}`);
const banned = ['test/i00/authority/**', 'test/i00/security/**', 'server/src/foundation/ledger', 'test/i00/browser/**', 'protected-owner-directives.bundle.test.ts', 'prospective test/aiOps', 'ops/aiOps/sentinel;'];
const serializedCoverage = JSON.stringify(coverage.rows);
for (const fragment of banned) if (serializedCoverage.includes(fragment)) throw new Error(`FALSE_COVERAGE_PATH:${fragment}`);
if (candidate !== null) {
  const frontierPaths = git('ls-tree', '-r', '--name-only', candidate, '--', 'frontier').split('\n').filter(Boolean);
  if (frontierPaths.length !== 0) throw new Error('FRONTIER_PATHS_ADMITTED');
  for (const tip of new Set(Object.values(frontierTips))) {
    if (run('git', ['merge-base', '--is-ancestor', tip, candidate], { allowFailure: true }).status === 0) {
      throw new Error(`FRONTIER_TIP_ADMITTED:${tip}`);
    }
  }
}
emitCsv('DIRECTIVE_COVERAGE_MATRIX.csv', coverage.headers, coverage.rows);

const capabilityPath = path.join(OUT, 'CAPABILITY_TRUTH_MATRIX.csv');
const capabilities = parseCsv(candidateBytes('verification/product-truth-20260716/CAPABILITY_TRUTH_MATRIX.csv').toString('utf8'));
for (const row of capabilities.rows) row.candidate_sha = candidateToken;
const capabilityById = new Map(capabilities.rows.map((row) => [row.capability_id, row]));
const candidateSource = capabilityById.get('candidate-source');
if (candidateSource) {
  Object.assign(candidateSource, {
    scope: candidate === null ? 'D-LAUNCH-62 C2 source repair' : 'exact frozen C2 source',
    implementation_path: candidate === null ? 'candidate worktree; exact SHA not self-nameable' : `Git tree ${git('rev-parse', `${candidate}^{tree}`)}`,
    runtime_evidence: candidate === null ? 'focused proof and acceptance gates passed; root/full/fresh clone pending' : 'exact local/fresh-clone gate receipt is recorded separately',
    status: candidate === null ? 'BUILDING' : 'FROZEN_LOCAL',
    blocker: candidate === null ? 'C2_NOT_YET_FROZEN' : 'C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED; WAVE1B_PENDING',
    disposition: 'D-LAUNCH-61 custody covers old C only; evidence descendants cannot alter C2',
  });
}
for (const id of ['ai-ops-product-route', 'ai-provider-runtime', 'ai-worker-runtime', 'ai-paging-sentinel']) {
  const row = capabilityById.get(id);
  if (row) {
    if (id === 'ai-ops-product-route') row.status = 'UNWIRED';
    else row.status = 'NOT_CONFIGURED';
    row.disposition = id === 'ai-ops-product-route'
      ? 'Canonical product route UNWIRED; excluded from C2 baseline acceptance'
      : 'Operational owner mount NOT_CONFIGURED; excluded from C2 baseline acceptance';
  }
}
const aiRoot = {
  capability_id: 'ai-ops-root-acceptance', scope: 'canonical root test mount', owner: 'AI_OPS',
  implementation_path: 'server/src/aiOps; web/src/aiOps source only', runtime_evidence: 'canonical runners print explicit exclusion',
  candidate_sha: candidateToken, status: 'NOT_CONFIGURED', blocker: 'AI_OPS_ROOT_TEST_MOUNT_NOT_CONFIGURED',
  disposition: 'EXCLUDED_FROM_C2_BASELINE_ACCEPTANCE; branch-specific port/shadow suites are REFERENCE_ONLY',
};
if (capabilityById.has(aiRoot.capability_id)) Object.assign(capabilityById.get(aiRoot.capability_id), aiRoot);
else capabilities.rows.push(aiRoot);
emitCsv('CAPABILITY_TRUTH_MATRIX.csv', capabilities.headers, capabilities.rows);

const dispositionById = {
  'PROV-001': ['FIXED', 'INPUTS.lock v3 inventories controlling, protected, composite deployment, superseded, absent-superseded, and Wave-1 inputs'],
  'PROV-002': ['FIXED', '17 Frontier family/module/superseded rows; candidate exclusion asserted'],
  'PROV-003': ['FIXED', 'False paths corrected and nine permanent MISSION/ARCHITECTURE rows added'],
  'PROV-004': ['HONEST_NOT_CONFIGURED', 'INCIDENT_ACK and SOURCE_ISOLATE rows explicitly record absent command owners and tests of the boundary'],
  'PROV-005': ['FIXED_WITH_DEFERRED_BROWSER_GATE', 'Proof catalog unbound in source, tracked-byte reports regenerated; exact-C2 browser receipt remains deferred'],
  'PROV-006': ['EXCLUDED_NOT_CONFIGURED', 'AI-Ops source integrated but root mount/acceptance explicitly excluded; canonical runners print the scope'],
  'PROV-007': ['HONEST_NOT_CONFIGURED', 'Route UNWIRED; provider, worker, sentinel, and paging NOT_CONFIGURED'],
  'PROV-008': ['DEFERRED_OWNER_GATE', 'Generator-era Product Assurance closure set is not C2 evidence; precise per-artifact deferrals recorded'],
  'PROV-009': ['FIXED', 'Canonical Product Assurance gate mounts 131 A-FORMAL/S2 action-evidence checks'],
  'PROV-010': ['FIXED', 'Ledger CAS/journal and Foundation quantity bridge rows cite exact implementation and tests'],
  'PROV-011': ['FIXED', 'Evidence-selection contract distinguishes source C2 from exact-bound evidence descendants'],
  'P3-CLEAN-001': ['FIXED', 'Sealed proof uses tracked bytes; ambient Git is a separate tri-state diagnostic; exact-byte single-branch parity is tested'],
  'P3-CLEAN-002': ['FIXED', 'V2 living-input seal binds D-LAUNCH-62 bytes and preserves D-LAUNCH-7 historical pins'],
  'P3-CLEAN-003': ['FIXED', 'Product Assurance Git runs through bounded runner and root npm test mounts the I00 proof scanner'],
};
const prov = JSON.parse(candidateBytes('verification/product-truth-20260716/wave1-inputs/PROV_FINDINGS.json').toString('utf8'));
const clean = JSON.parse(candidateBytes('verification/product-truth-20260716/wave1-inputs/CLEAN_CLONE_FINDINGS.json').toString('utf8'));
const findings = [...prov.findings, ...clean.findings].map((finding) => ({
  id: finding.id,
  severity: finding.severity,
  title: finding.title,
  adjudication: dispositionById[finding.id]?.[0] ?? 'MISSING_ADJUDICATION',
  disposition: dispositionById[finding.id]?.[1] ?? 'MISSING_ADJUDICATION',
  source_candidate: '41752d6a87dc1cb1b933bb4460c9cabfc15ff694',
  repaired_candidate: candidate,
  gate_state: candidate === null ? 'PENDING_C2_FREEZE_AND_ROOT_GATES' : 'CANDIDATE_BOUND_PENDING_RECORDED_GATE_RECEIPT',
}));
if (findings.length !== 14 || findings.some((finding) => finding.adjudication === 'MISSING_ADJUDICATION')) {
  throw new Error('WAVE1_FINDING_ADJUDICATION_INCOMPLETE');
}
const findingReceipt = {
  schema: 'product-truth-wave1-findings.v2',
  actor_role: 'ACCOUNT_A_CANDIDATE_WRITER',
  candidate_sha: candidate,
  candidate_token: candidateToken,
  old_candidate_prohibited_from_final_verifier: true,
  source_receipts: {
    prov_sha256: 'b0e06ead6b8280545c36ab7b8d5f58de75819dfa653c51dde7c09f720efe71fc',
    clean_clone_sha256: '0c8c59354486db404334107470865d4255ce0049dfcd38701fe0eb163c23250c',
  },
  declared_summary_mismatch: 'Durable PROV receipt contains 2 CRITICAL + 8 HIGH + 1 MEDIUM; all 11 were adjudicated despite the abbreviated directive prose.',
  findings,
  wave1b: 'PENDING_SHARD_SEC_AND_V_COCKPIT; FINAL_VERIFIER_HANDOFF_BLOCKED',
};
writeFileSync(path.join(OUT, 'INDEPENDENT_FINDINGS.json'), `${JSON.stringify(findingReceipt, null, 2)}\n`);
writeFileSync(path.join(OUT, 'WAVE1_FINDING_ADJUDICATION.json'), `${JSON.stringify(findingReceipt, null, 2)}\n`);

const paArtifacts = [
  'RELIABILITY_POLICY_REGISTRY.md', 'SAFETY_INVARIANT_CATALOG.md', 'TELEMETRY_COVERAGE_MATRIX.md',
  'OUT_OF_BAND_RECOVERY_REPORT.md', 'FAULT_INJECTION_AND_SOAK_REPORT.md', 'OPERATIONAL_FAILURE_ATLAS.md',
  'AGENTIC_DIAGNOSTIC_BOUNDARY.md', 'ASSURANCE_INSERTION_REQUEST.md', 'IP_ASSURANCE_RECEIPT.md',
  'Q_ASSURANCE_COVERAGE_MATRIX.md', 'fixtures-root/core-assurance-evidence.json', 'fixtures-root/fault-harness-synthetic.json',
];
const paDisposition = {
  schema: 'product-assurance-c2-disposition.v1', candidate_sha: candidate, candidate_token: candidateToken,
  source_state: 'INTEGRATED', root_harness: 'WIRED_LOCAL', formal_action_checks: 131,
  artifacts: paArtifacts.map((artifact) => ({ artifact, prior_generator_artifact: 'REFERENCE_ONLY_NOT_C2_EVIDENCE', c2_disposition: 'DEFERRED_OWNER_GATE', reason: 'EXACT_C2_PRODUCT_ASSURANCE_CLOSURE_GENERATION_AND_ROOT_GATE_ATTESTATION_NOT_YET_SEALED' })),
  preserved_truth: { integrated_operation_registration: '555 files; 205/205; 0 uncovered', behavior_checks: 802, provenance_checks: 4, invariants: 17, synthetic_faults: '103/103 SYNTHETIC_ONLY', real_soak: 'NOT_RUN', incident_corpus: 'UNKNOWN_EMPTY', provider_deployment_paging_private_signed: 'NOT_CONFIGURED_OR_DEFERRED_OWNER_GATE' },
};
writeFileSync(path.join(OUT, 'PRODUCT_ASSURANCE_C2_DISPOSITION.json'), `${JSON.stringify(paDisposition, null, 2)}\n`);

const evidenceSelection = {
  schema: 'product-truth-c2-evidence-selection.v1', source_candidate: candidate, source_candidate_token: candidateToken,
  candidate_embedded_package: candidate === null ? 'SOURCE_UNBOUND' : 'EXACT_SOURCE_CANDIDATE',
  selection_rule: 'The candidate source commit cannot self-name. Select only an evidence descendant whose manifest names exact C2, whose ancestry contains C2, and whose post-C2 diff is limited to declared I00 proof outputs and verification/product-truth-20260716/**. Reject old-C identifiers and ambiguous descendants.',
  valid_chain: 'C2 -> optional bounded I00 proof child -> campaign evidence child',
  final_verifier_handoff: 'BLOCKED_PENDING_WAVE1B',
  old_candidate: '41752d6a87dc1cb1b933bb4460c9cabfc15ff694',
  old_candidate_disposition: 'REJECTED_FOR_FINAL_HANDOFF_CRITICAL_FINDINGS',
};
writeFileSync(path.join(OUT, 'EVIDENCE_SELECTION.json'), `${JSON.stringify(evidenceSelection, null, 2)}\n`);

const aiDisposition = {
  schema: 'ai-ops-c2-acceptance-disposition.v1', candidate_sha: candidate, candidate_token: candidateToken,
  source: 'INTEGRATED', route: 'UNWIRED', provider: 'NOT_CONFIGURED', worker: 'NOT_CONFIGURED',
  sentinel: 'NOT_CONFIGURED', paging: 'NOT_CONFIGURED', root_test_mount: 'NOT_CONFIGURED',
  c2_baseline_acceptance: 'EXCLUDED_FROM_C2_BASELINE',
  note: 'A green npm test or npm run test:all is not AI-Ops acceptance evidence.',
};
writeFileSync(path.join(OUT, 'AI_OPS_C2_DISPOSITION.json'), `${JSON.stringify(aiDisposition, null, 2)}\n`);

const proofArtifacts = [
  'fixtures/i00/closure-evidence.json',
  'fixtures/i00/proof-catalog.json',
  'fixtures/i00/living-director-input-acceptance.json',
  'MISSION_COVERAGE_MATRIX.md',
  'AUTONOMY_CLOSURE_REPORT.md',
  'NO_TERMINAL_DEPENDENCY_REPORT.md',
  'RESOURCE_AND_BACKPRESSURE_REPORT.md',
  'OFFICIAL_INTERFACE_MATRIX.md',
  'integration/reports/i00-proof-evidence.json',
];
const proofBinding = {
  schema: 'product-truth-c2-proof-binding.v1',
  candidate_sha: candidate,
  candidate_token: candidateToken,
  candidate_tree: candidate === null ? null : git('rev-parse', `${candidate}^{tree}`),
  candidate_parent: candidate === null ? null : git('rev-parse', `${candidate}^`),
  binding: candidate === null ? 'SOURCE_COMMIT_CANNOT_SELF_NAME' : 'EXACT_CANDIDATE_GIT_BYTES',
  artifacts: proofArtifacts.map((relativePath) => {
    const bytes = candidateBytes(relativePath);
    return {
      relative_path: relativePath,
      candidate_git_blob: candidateBlob(relativePath),
      sha256: sha256(bytes),
      byte_length: bytes.length,
    };
  }),
  browser_proof: 'DEFERRED_OWNER_GATE; EXACT_C2_RENDERED_BROWSER_RECEIPT_NOT_PRODUCED',
  runtime_proof: 'DEFERRED_OWNER_GATE; EXACT_C2_COMPOSED_RUNTIME_RECEIPT_NOT_PRODUCED',
  real_soak: 'NOT_RUN',
  authority_granted: false,
};
writeFileSync(path.join(OUT, 'C2_PROOF_BINDING.json'), `${JSON.stringify(proofBinding, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({ candidate, candidateToken, inputRows: inputLock.inventory_counts.total_directive_law_lock_and_wave_rows, coverageRows: coverage.rows.length, capabilityRows: capabilities.rows.length, findings: findings.length, proofArtifacts: proofBinding.artifacts.length })}\n`);
