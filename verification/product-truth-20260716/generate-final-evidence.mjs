#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const C = '41752d6a87dc1cb1b933bb4460c9cabfc15ff694';
const TREE = 'a770f9f393e6229252731cd5247e9a1abfd2e509';
const MAIN = '2ae812624f20b9bc93fc4ad66cb568929101110f';
const LOCK_SHA256 = '3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf';
const START = '2026-07-16T11:17:11Z';
const END = new Date().toISOString();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: options.encoding ?? 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${String(result.stderr)}`);
  }
  return result;
}

function git(...args) {
  return run('git', args).stdout.trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(path) {
  return sha256(readFileSync(resolve(ROOT, path)));
}

function blobAt(commit, path) {
  const result = run('git', ['rev-parse', `${commit}:${path}`], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function ancestor(left, right) {
  return run('git', ['merge-base', '--is-ancestor', left, right], { allowFailure: true }).status === 0;
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function emitCsv(path, headers, rows) {
  const body = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');
  writeFileSync(resolve(OUT, path), `${body}\n`);
}

function parseCsv(text) {
  const table = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      table.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    table.push(row);
  }
  const [headers, ...values] = table.filter((candidate) => candidate.some(Boolean));
  return {
    headers,
    rows: values.map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] ?? '']))),
  };
}

const environment = Object.freeze({
  os: 'macOS 26.5.2 build 25F84',
  kernel: 'Darwin 25.5.0 arm64',
  node: 'v22.23.1',
  npm: '10.9.8',
  git: '2.50.1 Apple Git-155',
  typescript: '5.9.3',
  vite: '6.4.3',
  shell: 'zsh 5.9',
  default_python: '3.9.6 NOT_AUTHORIZED_FOR_QUANT_ACCEPTANCE',
  managed_python: '3.13.14',
  uv: '0.11.28',
});
const environmentDigest = sha256(`${JSON.stringify(environment)}\n`);

if (git('rev-parse', `${C}^{tree}`) !== TREE) throw new Error('candidate tree drift');
if (!ancestor(MAIN, C)) throw new Error('durable Main is not in candidate ancestry');

const receiptContext = Object.freeze({
  candidate_sha: C,
  candidate_tree_sha: TREE,
  command_or_operator_action: 'Account A evidence generation from immutable candidate C; no source mutation',
  environment_toolchain_digest_sha256: environmentDigest,
  dependency_lock_sha256: LOCK_SHA256,
  start_time_utc: START,
  end_time_utc: END,
  exit_code: 0,
  test_count: 0,
  artifact_hashes: 'MANIFEST.sha256 is generated last and excludes itself; the evidence Git commit binds the manifest',
  actor_role: 'ACCOUNT_A',
  actor_had_candidate_source_write_permission: false,
  actor_write_scope: 'verification/product-truth-20260716/** only after C freeze',
  deviations_skips_unavailable_evidence: [
    'Account B artifacts and reasoning were not read',
    'No independent verification token is issued',
    'Off-machine custody for the candidate bundle is unavailable',
  ],
});

const inputLock = {
  schema: 'product-truth-inputs-lock.v1',
  status: 'BLOCKED',
  reason: 'OFF_MACHINE_CANDIDATE_BUNDLE_CUSTODY_NOT_CONFIGURED',
  candidate: {
    commit: C,
    tree: TREE,
    parent: 'f11531e6637979d6e173f6eb25d04c10a76d20c8',
    branch: 'truth-campaign-20260716',
    source_frozen: true,
    evidence_descendants_may_change_source: false,
  },
  durable_main: {
    local: MAIN,
    origin: MAIN,
    remote: 'git@github.com:cosmosgeek0/arbitrage-cosmos.git',
    state: 'INTEGRATED',
  },
  controlling_inputs: [
    ['campaign', '/Users/cosmosgeek/Desktop/INDEPENDENT_PRODUCT_TRUTH_AND_LIVE_READINESS_CAMPAIGN_20260716.md', 'ae9638ba0b8539711d9dc67bab7ef0cd7b3539b0636fc5d78dd172a6c96c4d1b'],
    ['handoff', 'DIRECTOR_HANDOFF_TRUTH_CAMPAIGN.md', '49211c1f34a84610e356aa4119d156ca1e30892866e335cd3b407ef5da05c37d'],
    ['product-state', 'STATE.md', '9d1e348c65ed95fc3f43c22d469e41071bec473683ed3b68215bfc7bb661584a'],
    ['mission', 'MISSION.md', '95e152d76844aa391b7a28bd45548d7fe58f83ed1ced558dbdbeb01797436362'],
    ['architecture', 'ARCHITECTURE.md', 'beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db'],
    ['design', 'DESIGN.md', '60a1bc8da092cb737826d6a859b1f0eaa7c7c8df8a416e07654cbb1adf80480e'],
    ['director', 'DIRECTOR.md', '6c54e7037d108c0e6a198520740deca13a6d82d677b9aea0137e284ce5752a95'],
    ['agents', 'AGENTS.md', 'db97a7a59e0d5cb4b1b6fe23b9902c6f5756733678085027412e37062b7d82ec'],
  ].map(([id, path, sha256Value]) => ({ id, path, sha256: sha256Value })),
  dependency_inputs: [
    ['package.json', '3868ab98c8d7c78db4ebf7790c26ffbca02e26255e617ed59d16709a23727da9'],
    ['package-lock.json', LOCK_SHA256],
    ['.github/workflows/ci.yml', '138aa764f0efdd7c5c94b35fd7dabf0048fcbdbc0cce133f2dbfc3a01bf28142'],
    ['.nvmrc', 'f14b4987904bcb5814e4459a057ed4d20f58a633152288a761214dcd28780b56'],
    ['quant/uv.lock', '716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29'],
    ['quant/.python-version', 'f8faecf2505680716c6279bf2cdec3d5a5ba2ba852f0d7df45d51ac1ce8d9ade'],
    ['quant/pyproject.toml', 'a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81'],
  ].map(([path, sha256Value]) => ({ path, sha256: sha256Value, git_blob: blobAt(C, path) })),
  environment,
  environment_digest_sha256: environmentDigest,
  clean_clone: {
    path: `/Users/cosmosgeek/Desktop/product-truth-clean-clones-20260716/account-a/${C}/repo`,
    source: 'file:///Users/cosmosgeek/Desktop/truth-a',
    source_state: 'REFERENCE_ONLY',
    full_history: true,
    shallow: false,
    detached_at_candidate: true,
    current_main_ref_present: false,
    object_alternates_present: false,
    reachable_commits: 544,
    tracked_files: 2574,
  },
  bundle: {
    path: '/Users/cosmosgeek/cosmos-arbitrage-truth-candidate-41752d6a.bundle',
    sha256: 'f0641dcbbe7816d55749dd1d2a0fcfbf246c914d9af55f6ad9982f740aa9feab',
    bytes: 62976347,
    complete_history: true,
    candidate_ref: C,
    main_ref: MAIN,
    local_integrity_state: 'SEALED',
    off_machine_custody_state: 'NOT_CONFIGURED',
  },
  first_pass_account_a_matrix: {
    commit: 'a1a67b2a9ab2b693b967fc5a0f047036f90cc593',
    git_blob: 'ac5d274187b590a3a8ea856ba09ab665423c834b',
    sha256: '1d2d228b5e088846bf5962d79e6e5b0606937b6f69b24325de962f1cfdc58ff9',
    account_b_material_read: false,
  },
  receipt: receiptContext,
};
writeFileSync(resolve(OUT, 'INPUTS.lock'), `${JSON.stringify(inputLock, null, 2)}\n`);

const laneRows = [
  ['EGRESS','8db67eee261ea4b8964b5b9c64b22fc3a0c7fbc6','c1a4b835a15aa60152b2ecfa9ae8087f6e159ce6','492e3f69b054c85686bcfc4c09dbff4ababeda3f',8,'docs/archive/egress-patch/EGRESS_PATCH_RECEIPT.md',['docs/archive/egress-patch/EGRESS_PATCH_RECEIPT.md','package.json','server/test/gates.mjs','server/test/perimeter.mjs','server/test/private-egress-tripwire.mjs','server/test/productIntegration/runtime/crash-readback.process.test.mjs','server/test/run-deterministic-network-free.mjs','server/test/systemIntegration/production/restart-truth-process.test.mjs']],
  ['A1','8882644db14fbb924c6a8f97bf5c1d1cebb1453c','4eff62bdd30eceddf39bbbdf417b0eba51c22b7c','492e3f69b054c85686bcfc4c09dbff4ababeda3f',45,'docs/archive/aiOps/a1/PORT_A1_PRESTAGE_RECEIPT.md',['server/src/aiOps/contracts/','server/src/aiOps/policy/','server/src/aiOps/manifests/','server/src/aiOps/identity/','server/src/aiOps/reliability/','server/test/aiOps/a1/','fixtures/aiOps/a1/','docs/archive/aiOps/a1/']],
  ['A2','6e9efe05890174bfe2ebfb9331c0ea9655061b30','9c7e8b16bc8fbaba0110daa391a6e6160dae5802','492e3f69b054c85686bcfc4c09dbff4ababeda3f',35,'docs/archive/aiOps/a2/PORT_A2_PRESTAGE_RECEIPT.md',['server/src/aiOps/runtime/','server/test/aiOps/a2/','fixtures/aiOps/a2/','docs/archive/aiOps/a2/']],
  ['A3','21a0440f32fc28f24c715888e4767632aa9158e4','b3f49616e69ee5036386414030b482b5f02e9c13','492e3f69b054c85686bcfc4c09dbff4ababeda3f',27,'docs/archive/aiOps/a3/PORT_A3_PRESTAGE_RECEIPT.v1.json',['server/src/aiOps/adapters/','server/test/aiOps/a3/','fixtures/aiOps/a3/','docs/archive/aiOps/a3/']],
  ['A4','720d2fe74be83d0d2d83f448637e087c32cafc5b','2787ebf3665c1efe32af9c426504af6b871898f1','492e3f69b054c85686bcfc4c09dbff4ababeda3f',26,'docs/archive/aiOps/a4/PORT_A4_RECEIPT.md',['web/src/aiOps/','web/test/aiOps/','fixtures/aiOps/a4/','docs/archive/aiOps/a4/']],
  ['A5','9769d461f694f12519d7a29483c2f78f4381504d','614e5a8ed20b5c810ee92268a3f3c12c30971519','492e3f69b054c85686bcfc4c09dbff4ababeda3f',28,'docs/archive/aiOps/a5/PORT_A5_PRESTAGE_RECEIPT.md',['fixtures/aiOps/a5/','server/test/aiOps/a5/','test/aiOps/a5/','docs/archive/aiOps/a5/']],
  ['OBS','884526c218f46eb39ce7f23278a421b274160525','9c3bb17638cd8bc5478b813c22c5a7050f046ce3','492e3f69b054c85686bcfc4c09dbff4ababeda3f',11,'fixtures/obsShadow/receipts/PORT_OBS_RECEIPT.v1.json',['fixtures/obsShadow/','test/obsShadow/']],
  ['OPS','c5c9abb549d9dcfa0ef622e2f6790c9805d358ac','955e204964f44246e0c69772578f43180a56b33f','492e3f69b054c85686bcfc4c09dbff4ababeda3f',11,'fixtures/opsShadow/receipts/PORT_OPS_PRESTAGE_RECEIPT.v1.json',['fixtures/opsShadow/','test/opsShadow/']],
  ['REPLAY','12f0934efac2620022a72e179091a2ee87e9b828','611df36d12d00c3fbf041fff4af9cccde03afc91','492e3f69b054c85686bcfc4c09dbff4ababeda3f',9,'fixtures/replayShadow/PORT_REPLAY_RECEIPT.md',['fixtures/replayShadow/','test/replayShadow/']],
  ['RUNBOOK','05d3a1ff3f5bca5c4347e0b4a6f2879f39b9a0a8','e3b84307af010b8b1547418f5f6cb5078039413d','492e3f69b054c85686bcfc4c09dbff4ababeda3f',27,'fixtures/runbookShadow/receipts/PORT_RUNBOOK_PRESTAGE_RECEIPT.v1.json',['fixtures/runbookShadow/','test/runbookShadow/']],
  ['A-FORMAL','b491893416006cf529aef02e5dd4a25d6475e7b8','48a89d9f07574868fc6346725781ba954f488a4c','9785c93102b00389847b77c2f9348c06abc4344b',73,'fixtures/productAssurance/systemic/formal/receipts/D_LAUNCH_22_FORMAL_DEEPENING_BATCH_02.md',['fixtures/productAssurance/systemic/formal/','test/productAssurance/systemic/formal/']],
  ['S2','ca30adf5e97b6697afec49f13073024d953b117b','55b456e19dbbd97548d9beb601dfc8cc7d3c57b7','8c24a4b6ba41fe510913708f6a39557bbe4af0e5',26,'fixtures/productAssurance/systemic/actionEvidence/receipts/ACTION_EVIDENCE_PRESTAGE_RECEIPT.md',['fixtures/productAssurance/systemic/actionEvidence/','test/productAssurance/systemic/actionEvidence/']],
];

const laneEvidence = laneRows.map(([id, tip, merge, deltaBase, expectedCount, receiptPath, grants]) => {
  const parents = git('show', '-s', '--format=%P', merge).split(' ');
  if (parents[1] !== tip) throw new Error(`${id} is not exact second parent`);
  if (!ancestor(tip, C) || !ancestor(merge, C)) throw new Error(`${id} ancestry failure`);
  const paths = git('diff', '--name-only', `${deltaBase}..${tip}`).split('\n').filter(Boolean).sort();
  if (paths.length !== expectedCount) throw new Error(`${id} path count drift`);
  const outOfGrant = paths.filter((path) => !grants.some((grant) => grant.endsWith('/') ? path.startsWith(grant) : path === grant));
  const mismatches = paths.filter((path) => blobAt(tip, path) !== blobAt(C, path));
  if (outOfGrant.length > 0 || mismatches.length > 0) throw new Error(`${id} provenance mismatch`);
  const receiptBytes = run('git', ['show', `${tip}:${receiptPath}`]).stdout;
  if (blobAt(tip, receiptPath) !== blobAt(C, receiptPath)) throw new Error(`${id} receipt drift`);
  return {
    id, status: 'INTEGRATED', tip, merge, merge_tree: git('rev-parse', `${merge}^{tree}`),
    parents, delta_base: deltaBase, changed_path_count: paths.length,
    changed_path_set_sha256: sha256(`${paths.join('\n')}\n`), grants,
    out_of_grant_paths: outOfGrant, donor_tip_in_candidate_ancestry: true,
    merge_in_candidate_ancestry: true, exact_second_parent: true,
    donor_blob_matches_at_merge: paths.length, donor_blob_matches_at_candidate: paths.length,
    changed_paths: paths, receipt: { path: receiptPath, git_blob: blobAt(tip, receiptPath), sha256: sha256(receiptBytes), bytes: Buffer.byteLength(receiptBytes), same_at_candidate: true },
    limitations: id === 'A4' || id === 'EGRESS' ? ['historical receipt remains BLOCKED; source admission is INTEGRATED']
      : id === 'A-FORMAL' ? ['runtime claim REFERENCE_ONLY; TLA tool execution NOT_CONFIGURED']
        : id === 'S2' ? ['supporting evidence only; production consumer NOT_CONFIGURED']
          : id.startsWith('A') || ['OBS','OPS','REPLAY','RUNBOOK'].includes(id) ? ['provider, worker lifecycle, product route, and paging are NOT_CONFIGURED or UNWIRED'] : [],
  };
});

const coreBase = '7383fd89477ed0b3e677e53c57c35d76ac34bbd8';
const coreDonor = 'cf3416bed284ffcd596f451a091985755f5e239b';
const coreMerge = '51efaaa41fbaf85bcbefa9adc6cdbd640d814506';
const corePaths = git('diff', '--name-only', `${coreBase}..${coreDonor}`).split('\n').filter(Boolean).sort();
const coreAdaptations = corePaths.filter((path) => blobAt(coreDonor, path) !== blobAt(C, path)).map((path) => ({
  path,
  donor_blob: blobAt(coreDonor, path),
  landing_blob: blobAt(coreMerge, path),
  candidate_blob: blobAt(C, path),
  latest_candidate_commit: git('log', '-1', '--format=%H', C, '--', path),
}));
if (corePaths.length !== 1687 || coreAdaptations.length !== 21) throw new Error('landed core denominator drift');

const provenance = {
  schema: 'product-truth-merge-provenance.v1',
  status: 'INTEGRATED',
  candidate_sha: C,
  candidate_tree_sha: TREE,
  actor_role: 'ACCOUNT_A',
  account_b_material_read: false,
  aggregate: {
    admitted_lane_count: laneEvidence.length,
    changed_path_occurrences: laneEvidence.reduce((sum, lane) => sum + lane.changed_path_count, 0),
    unique_changed_paths: new Set(laneEvidence.flatMap((lane) => lane.changed_paths)).size,
    cross_lane_overlap_count: laneEvidence.reduce((all, lane) => all.concat(lane.changed_paths), []).length - new Set(laneEvidence.flatMap((lane) => lane.changed_paths)).size,
    out_of_grant_path_count: 0,
    donor_blob_mismatch_at_candidate_count: 0,
    unexplained_edit_count: 0,
  },
  admitted_lanes: laneEvidence,
  landed_core_anchor: {
    status: 'INTEGRATED', donor: coreDonor, donor_tree: git('rev-parse', `${coreDonor}^{tree}`),
    merge: coreMerge, merge_tree: git('rev-parse', `${coreMerge}^{tree}`),
    parents: git('show', '-s', '--format=%P', coreMerge).split(' '), delta_base: coreBase,
    donor_path_count: corePaths.length, exact_at_landing: corePaths.filter((path) => blobAt(coreDonor, path) === blobAt(coreMerge, path)).length,
    exact_at_candidate: corePaths.filter((path) => blobAt(coreDonor, path) === blobAt(C, path)).length,
    adaptations: coreAdaptations,
  },
  candidate_adaptations: [
    { commit: 'cd0aa64db48a9898192b3d886abb5546933064e9', status: 'INTEGRATED', disposition: 'candidate truth blockers, CI parity, invariant families, bounded journal readback' },
    { commit: '9f882170c4347a378c0a2cd60b69ba8f8d8550c5', status: 'INTEGRATED', disposition: 'Product Assurance provenance manifest adaptation' },
    { commit: 'f11531e6637979d6e173f6eb25d04c10a76d20c8', status: 'INTEGRATED', disposition: 'candidate authority scan refresh' },
    { commit: C, status: 'INTEGRATED', disposition: 'atomic current product STATE freeze' },
  ],
  inclusion_rulings: {
    ai_ops: { status: 'INTEGRATED', verification: 'BLOCKED', source_path_count: 161 },
    a_formal: { status: 'INTEGRATED', runtime: 'REFERENCE_ONLY', tla_tool: 'NOT_CONFIGURED' },
    s2_action_evidence: { status: 'INTEGRATED', production_consumer: 'NOT_CONFIGURED' },
    frontier: { status: 'REFERENCE_ONLY', candidate_path_count: 0 },
    ci_hotfix_2: { status: 'REFERENCE_ONLY', tip: '53c6da817d92049c7628aa9f94466a0e1882e801' },
  },
  receipt: receiptContext,
};
writeFileSync(resolve(OUT, 'MERGE_PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);

const moneyEvidence = {
  schema: 'COSMOS_PRODUCT_TRUTH_MONEY_PATH_AUTHORITY_EVIDENCE_V1', version: 1,
  candidate: { commit: C, tree: TREE, production_path_count: 569, production_path_set_sha256: 'a1f696b54457744641f7c73dd8c69490f3305b39b166fe917753f2fa4191edb4' },
  historical_decisions: [
    { id: 'LEDGER_CAS', request_origin_commit: 'a288657d98d6aa8615abd11879e2a097189a3be3', request_path: 'live-edge-receipts/patches/L06-canonical-ledger-cas.request.md', request_git_blob: '494cfc87083103b345e82e11726b8c89d09d07b6', request_sha256: '79740ff5ef2951e96b5e3ea26acdc4aa786425ca3341335e55cef23d230c4f6f', receipt_object: 'cf3416bed284ffcd596f451a091985755f5e239b:docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md', receipt_git_blob: '49cacfc4c67ec264dd445209d435d0d262cd8542', receipt_sha256: 'ce1d7d386a017bb1359a17d139e1d126200d85f9d2c0cd674be7f3081c028ecc', receipt_lines: '1663-1677', disposition: 'IMPLEMENTED_EXISTING_LEDGER_NO_SEND_AUTHORITY' },
    { id: 'FOUNDATION_QUANTITY_BRIDGE', request_origin_commit: 'a288657d98d6aa8615abd11879e2a097189a3be3', request_path: 'live-edge-receipts/patches/L06-foundation-quantity-bridge.request.md', request_git_blob: '697abdc548f3975247244062a79bc176c797be2d', request_sha256: '9db092975a34c001f04412ef94644078009f90e5efc62ed258ced00aa38c4cb0', receipt_object: 'cf3416bed284ffcd596f451a091985755f5e239b:docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md', receipt_git_blob: '49cacfc4c67ec264dd445209d435d0d262cd8542', receipt_sha256: 'ce1d7d386a017bb1359a17d139e1d126200d85f9d2c0cd674be7f3081c028ecc', receipt_lines: '1678-1690', disposition: 'IMPLEMENTED_CONTRACT_NO_AUTHORIZED_PRODUCTION_CONSUMER' },
  ],
  source_objects: [
    ['server/src/ledger.ts','2d16cf8a978046efd37e159152b41b852e3e56fe','a02910cdcea008f3dbc4b3e081c8c18b79fb06ea9b8a007ed8d4e9e617b043ac'],
    ['server/src/liveEdge/adapters/durableMutationJournal/journal.ts','0cd66cef01fbfe9246c48d4efa57d881998067c1','7182ef0cdd5883792fb7958f6c6c58aa972ee5771c3be15fcadd563744c2118b'],
    ['server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts','730e0260d13b3f5ea81e7d058216419372948317','99292f4cf93f1864f7d05e2bd1ba5a53aec26f71174010fbdbd81fa33c643e37'],
    ['server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts','d28300188162d2f96f591e4a4d0f44f7f272ba5b','14122c1409392dbfb468049a69dfb1ff87f54e90bf18ec5cf05de102fa5d8a94'],
    ['server/src/systemIntegration/adapters/foundationQuantityBridge.ts','5e4ffff82e77fa32045192142b0ebbd7365a163d','3888d68bc41e7d636479dbb7d94e75ccbd2dc9ab591bf57115bdac16dcfee22a'],
    ['server/src/index.ts','64c83e395e969c40f2c5d38942cc0270a0b50545','b92aac205f993946e007be152c02bb501a3aa0832e2d9ce3efc69c9a9f41947f'],
  ].map(([path, git_blob, sha256Value]) => ({ path, git_blob, sha256: sha256Value })),
  capabilities: [
    { id: 'LEDGER_CONFIG_EVENT_CAS', state: 'WIRED_LOCAL' },
    { id: 'L06_MUTATION_JOURNAL_READ_INVENTORY', state: 'WIRED_LOCAL' },
    { id: 'L06_MUTATION_JOURNAL_PRODUCTION_APPEND_PRODUCER', state: 'NOT_CONFIGURED' },
    { id: 'FOUNDATION_QUANTITY_COMPARISON_CONTRACT', state: 'INTEGRATED' },
    { id: 'FOUNDATION_QUANTITY_PRODUCTION_CONSUMER', state: 'NOT_CONFIGURED' },
    { id: 'SIGNED_PRIVATE_OR_MONEY_MOVING_EXECUTION', state: 'NOT_CONFIGURED' },
  ],
  authority: { local_sqlite_mutation_available: true, exchange_send_authorized: false, signed_private_call_authorized: false, order_dispatch_authorized: false, capital_mutation_authorized: false, external_action_authorization: 'NONE' },
  probes: [
    { id: 'quantity_all_matches', result_sha256: 'e00e54c41cbcd83f4af0f55b4eabcc7dc7c70ec673de306e14b22eb48419bf90', match_count: 4 },
    { id: 'quantity_call_shape', result_sha256: 'c63a1237b3ade1cf8452be8122f2aa1b9df1dab70a2a3d520375556bddc95ee1', match_count: 1, disposition: 'declaration only' },
    { id: 'production_journal_append_call', exit_code: 1, match_count: 0 },
  ],
  receipt: receiptContext,
};
writeFileSync(resolve(OUT, 'MONEY_PATH_AUTHORITY_EVIDENCE.json'), `${JSON.stringify(moneyEvidence, null, 2)}\n`);

const projectionSource = readFileSync(resolve(ROOT, 'server/src/productIntegration/runtime/projection.ts'), 'utf8');
const surfaceBlock = projectionSource.slice(projectionSource.indexOf('const SURFACE_EVIDENCE'), projectionSource.indexOf('} as const);') + 1);
const surfaceEvidence = Function(`return (${surfaceBlock.slice(surfaceBlock.indexOf('{'))})`)();
const pairs = Object.entries(surfaceEvidence).flatMap(([surface, fields]) => fields.map((field) => [surface, field]));
const inventoryDigest = sha256(`${pairs.map(([surface, field]) => `${surface}\t${field}`).join('\n')}\n`);
if (pairs.length !== 178 || inventoryDigest !== '7ccd601d5df9a21dc6c177b51e857fded440b8547746c8b48988cc08f0e28580') throw new Error('cockpit denominator drift');
const genericFields = new Set(['overall-posture','startup','revisions','mode','capital','root-blocker','attention','material-decisions','machine-graph','dependency-edges','control-registry','authority','correlation','emergency-controls','source-freshness','freshness-completeness','reconciliation','halt-posture','lifecycle-capability','heartbeat-advance','source-event-processing-age','db-ledger','root-blocker-action','bounded-pagination','retention']);
const opsFields = new Set(['deployment-frozen','exposure-state','ambiguity-state','recovery-state','ledger-schema-compatibility','ops-interlock']);
const mountSource = readFileSync(resolve(ROOT, 'web/src/features/productControlRoom/surfaceMounts.ts'), 'utf8');
const mounts = new Map([...mountSource.matchAll(/\{ surfaceId: '([^']+)', existingOwner: '([^']+)', insertionAnchor: '([^']+)', adapterExport: '([^']+)', mountKind: '([^']+)' \}/g)].map((match) => [match[1], { owner: match[2], anchor: match[3], adapter: match[4], kind: match[5] }]));
if (mounts.size !== 18) throw new Error('mount denominator drift');
const cockpitHeaders = ['candidate_sha','surface_id','field_id','component_id','expected_backend_owner','mount_owner','mount_kind','api_event_source','freshness_rule','healthy_logic','degraded_logic','stale_logic','missing_logic','unknown_behavior','permission_requirement','control_validation_safe_range','request_correlation_id','resulting_state_transition','ledger_audit_event','persistence_restart_behavior','canonical_source','runtime_truth_label','unavailable_reason','screenshot_evidence','network_evidence','test_path','status','blocker','disposition'];
const cockpitRows = pairs.map(([surface, field]) => {
  const mapped = genericFields.has(field) || opsFields.has(field);
  const mount = mounts.get(surface);
  return {
    candidate_sha: C, surface_id: surface, field_id: field, component_id: `product-control-room.${surface}.${field}`,
    expected_backend_owner: opsFields.has(field) ? 'SYSTEM_INTEGRATION_OPS_READBACK' : 'SYSTEM_INTEGRATION_CANONICAL_OWNER_PROJECTION',
    mount_owner: mount.owner, mount_kind: mount.kind, api_event_source: '/api/product/supervisor',
    freshness_rule: opsFields.has(field) ? 'canonical readback validity window' : 'canonical supervisor evaluatedAtMs plus owner freshness',
    healthy_logic: mapped ? 'canonical non-stale owner value only; process-alive never suffices' : 'NOT_CONFIGURED',
    degraded_logic: mapped ? 'canonical owner degraded/blocker projection' : 'NOT_CONFIGURED',
    stale_logic: 'stale or expired evidence remains non-green', missing_logic: 'null renders MISSING and stays in denominator',
    unknown_behavior: 'ABSTAIN_UNKNOWN; control remains disabled',
    permission_requirement: 'authenticated product read; control permissions are separate',
    control_validation_safe_range: 'read-only datum; no field-level mutation authority', request_correlation_id: 'canonical supervisor correlationId',
    resulting_state_transition: 'NONE', ledger_audit_event: 'NONE', persistence_restart_behavior: 'recomputed from canonical owner and durable ledger readback',
    canonical_source: opsFields.has(field) ? `canonicalSupervisorOpsReadback:${field}` : `systemIntegration:${surface}:${field}`,
    runtime_truth_label: mapped ? 'WIRED_LOCAL' : 'MISSING', unavailable_reason: mapped ? 'NONE' : 'CANONICAL_OWNER_FIELD_NOT_CONFIGURED',
    screenshot_evidence: 'BLOCKED', network_evidence: 'BLOCKED',
    test_path: 'server/test/productIntegration/runtime/runtime.test.mjs; web/test/productControlRoom/**',
    status: mapped ? 'WIRED_LOCAL' : 'NOT_CONFIGURED',
    blocker: mapped ? 'Account B exact-C cockpit verification remains BLOCKED' : 'canonical owner field is NOT_CONFIGURED',
    disposition: mapped ? 'retain canonical fail-honest projection; independent exact-C browser proof remains BLOCKED' : 'keep visible as NOT_CONFIGURED; never remove from denominator or render green',
  };
});
emitCsv('COCKPIT_BINDING_MATRIX.csv', cockpitHeaders, cockpitRows);

const capabilityHeaders = ['capability_id','scope','owner','implementation_path','runtime_evidence','candidate_sha','status','blocker','disposition'];
const capabilityRows = [
  ['candidate-source','frozen source','ACCOUNT_A','candidate tree','clean clone and Git tree',C,'INTEGRATED','off-machine custody BLOCKED','source frozen; evidence-only descendants cannot alter C'],
  ['landed-core','C2R core','CANONICAL_OWNERS','server/src; web/src; quant','MERGE_PROVENANCE.json',C,'INTEGRATED','Account B verification BLOCKED','1666/1687 core blobs retained; 21 adaptations explicit'],
  ['ai-ops-source','subordinate AI diagnostic plane','AI_OPS','server/src/aiOps; web/src/aiOps','12 exact donor merges',C,'INTEGRATED','Account B verification BLOCKED','included; no implicit runtime activation'],
  ['ai-ops-product-route','AI workspace mount','DIRECTOR_ROUTE_OWNER','web/src/aiOps','no canonical product mount',C,'UNWIRED','product route UNWIRED','A4 remains isolated from 18 canonical mounts'],
  ['ai-provider','provider activation','AI_PROVIDER_GATEWAY','server/src/aiOps/runtime','no owner configuration',C,'NOT_CONFIGURED','owner gate','fake or inactive provider source only'],
  ['ai-worker-lifecycle','subscription workers','AI_WORKER_OWNER','server/src/aiOps/runtime','no started worker',C,'NOT_CONFIGURED','owner signatures and provider gate','source integration precedes activation'],
  ['ai-paging-sentinel','external AI alarm','EXTERNAL_SENTINEL_OWNER','ops/aiOps','no destination',C,'NOT_CONFIGURED','deployment blocker','must remain visibly absent'],
  ['a-formal-source','formal assurance satellite','PRODUCT_ASSURANCE_FORMAL','fixtures/productAssurance/systemic/formal','merge 48a89d9f',C,'INTEGRATED','Account B verification BLOCKED','source included'],
  ['a-formal-runtime','formal runtime claim','PRODUCT_ASSURANCE_FORMAL','fixtures/productAssurance/systemic/formal','bounded reference models',C,'REFERENCE_ONLY','TLA tool NOT_CONFIGURED','no production authority'],
  ['s2-action-evidence','supporting action evidence','PRODUCT_ASSURANCE_ACTION_EVIDENCE','fixtures/productAssurance/systemic/actionEvidence','merge 55b456e1',C,'INTEGRATED','Account B verification BLOCKED','supporting evidence only'],
  ['s2-production-consumer','action-evidence runtime consumer','CANONICAL_ASSURANCE_OWNER','server/src/productAssurance','no production consumer',C,'NOT_CONFIGURED','consumer absent','grants no action authority'],
  ['ledger-cas','local durable CAS','EXISTING_LEDGER','server/src/ledger.ts','MONEY_PATH_AUTHORITY_EVIDENCE.json',C,'WIRED_LOCAL','production L06 append producer NOT_CONFIGURED','local persistence only; no send authority'],
  ['quantity-comparison','closed quantity bridge','SYSTEM_INTEGRATION_ADAPTER','server/src/systemIntegration/adapters/foundationQuantityBridge.ts','MONEY_PATH_AUTHORITY_EVIDENCE.json',C,'INTEGRATED','production consumer NOT_CONFIGURED','comparison only; no action schema'],
  ['canonical-cockpit-mapped','41 mapped slot occurrences','SYSTEM_INTEGRATION','server/src/productIntegration/runtime/projection.ts','COCKPIT_BINDING_MATRIX.csv',C,'WIRED_LOCAL','independent browser proof BLOCKED','29 generic plus 12 ops readback occurrences'],
  ['canonical-cockpit-unmapped','137 slot occurrences','CANONICAL_OWNER_FIELDS','server/src/productIntegration/runtime/projection.ts','COCKPIT_BINDING_MATRIX.csv',C,'NOT_CONFIGURED','137 owner fields absent','visible MISSING runtime labels; denominator preserved'],
  ['frontier','optional future program','NO_CURRENT_OWNER','frontier','no candidate admission',C,'REFERENCE_ONLY','not a baseline blocker','parked and excluded'],
  ['staging','target deployment','DEPLOYMENT_OWNER','ops/i00; ops/live','no deployed SHA',C,'NOT_CONFIGURED','prior gates and owner authority','no deployment claim'],
  ['private-read','private account truth','OWNER_GATE','server/src/liveEdge','no credential use',C,'DEFERRED_OWNER_GATE','separate authorization','no private call attempted'],
  ['signed-test','signed non-money validation','OWNER_GATE','server/src/liveEdge','no signed call',C,'DEFERRED_OWNER_GATE','private read and separate authorization','no signed call attempted'],
  ['test-order','test order lifecycle','OWNER_GATE','NONE','LIVE_EXECUTION_NOT_IMPLEMENTED',C,'NOT_CONFIGURED','repository no-money law','no order path created or exercised'],
  ['composed-runtime','replay/live-public/fault/restart proof','RUNTIME_OPERATOR','server/src','COMPOSED_RUNTIME_RECEIPT.md',C,'BLOCKED','required modes/drills/soak absent','static and root tests do not imply local runtime acceptance'],
  ['economic-edge','forward net edge','RESEARCH_OWNER','quant','no forward runtime evidence',C,'ABSTAIN_UNKNOWN','forward evidence absent','no edge claim'],
].map(([capability_id,scope,owner,implementation_path,runtime_evidence,candidate_sha,status,blocker,disposition]) => ({ capability_id,scope,owner,implementation_path,runtime_evidence,candidate_sha,status,blocker,disposition }));
emitCsv('CAPABILITY_TRUTH_MATRIX.csv', capabilityHeaders, capabilityRows);

const directivePath = resolve(OUT, 'DIRECTIVE_COVERAGE_MATRIX.csv');
const parsed = parseCsv(readFileSync(directivePath, 'utf8'));
const requiredHeaders = ['requirement_id','source_file','source_section','authority','owner','implementation_path','test_path','cockpit_surface','runtime_evidence','donor_sha','candidate_sha','status','blocker','disposition'];
if (JSON.stringify(parsed.headers) !== JSON.stringify(requiredHeaders)) throw new Error('directive matrix header drift');
const aiTips = laneEvidence.filter((lane) => ['A1','A2','A3','A4','A5','OBS','OPS','REPLAY','RUNBOOK'].includes(lane.id)).map((lane) => lane.tip).join('; ');
const statusOverride = {
  'AUTH-001':'INTEGRATED','AUTH-002':'REFERENCE_ONLY','AUTH-003':'BLOCKED','ASR-003':'NOT_CONFIGURED','ASR-005':'INTEGRATED','ASR-006':'INTEGRATED','AIO-001':'INTEGRATED','AIO-002':'NOT_CONFIGURED','AIO-003':'INTEGRATED','AIO-004':'INTEGRATED','AIO-005':'INTEGRATED','AIO-006':'INTEGRATED','AIO-007':'INTEGRATED','AIO-008':'NOT_CONFIGURED','AIO-009':'INTEGRATED','AIO-010':'INTEGRATED','AIO-011':'UNWIRED','AIO-012':'INTEGRATED','AIO-013':'INTEGRATED','AIO-014':'BLOCKED','DEP-003':'NOT_CONFIGURED',
};
const updated = parsed.rows.map((row) => {
  const next = { ...row, candidate_sha: C };
  if (statusOverride[next.requirement_id]) next.status = statusOverride[next.requirement_id];
  next.runtime_evidence = next.runtime_evidence
    .replaceAll('No aiOps paths in current candidate', 'Candidate C contains 161 exact aiOps-segment paths; activation remains separate')
    .replaceAll('No aiOps code', 'AI-Ops source is integrated; runtime activation remains separate')
    .replaceAll('No AI-Ops surface in candidate', 'A4 source is integrated; canonical product route is UNWIRED')
    .replaceAll('PENDING_FREEZE', C);
  next.implementation_path = next.implementation_path.replaceAll('prospective ', 'integrated source: ');
  if (next.requirement_id.startsWith('AIO-')) {
    next.donor_sha = aiTips;
    next.blocker = next.status === 'INTEGRATED' ? 'Account B exact-C verification remains BLOCKED'
      : next.requirement_id === 'AIO-011' ? 'canonical product route UNWIRED'
        : next.status === 'BLOCKED' ? 'independent exact-C AI-Ops acceptance is BLOCKED'
          : 'operational capability NOT_CONFIGURED';
    next.disposition = `Source inclusion is INTEGRATED at C; this row's exact capability state is ${next.status}; no provider, worker, control, deployment, or money authority is inferred`;
    next.runtime_evidence = next.requirement_id === 'AIO-002'
      ? 'Provider activation and provider runtime are NOT_CONFIGURED'
      : next.requirement_id === 'AIO-008'
        ? 'Independent AI verifier, external sentinel, and paging destination are NOT_CONFIGURED'
        : next.requirement_id === 'AIO-011'
          ? 'A4 source is INTEGRATED; the canonical product route is UNWIRED'
          : next.requirement_id === 'AIO-014'
            ? 'Account-A exact-C root npm test exits 0; independent exact-C AI-Ops acceptance remains BLOCKED'
            : 'The named AI-Ops source contract is INTEGRATED at C; operational activation remains separately NOT_CONFIGURED or UNWIRED';
  }
  if (next.requirement_id === 'AUTH-001') {
    next.blocker = 'NONE';
    next.runtime_evidence = 'Root STATE was atomically rewritten by C; campaign STATE is the sole campaign-status authority';
    next.disposition = 'Product state and campaign state are distinct, current, and bound to C';
  }
  if (next.requirement_id === 'AUTH-002') {
    next.blocker = 'Live physical owner inputs remain absent';
    next.disposition = 'Packaged verifier input snapshots are REFERENCE_ONLY and never represented as live owner inputs';
  }
  if (next.requirement_id === 'AUTH-003') {
    next.blocker = 'Off-machine candidate bundle custody is NOT_CONFIGURED';
    next.runtime_evidence = 'C is immutable and local complete-history bundle is SEALED; off-machine custody is absent';
    next.disposition = 'Stop BLOCKED until a director-authorized off-machine custody receipt exists';
  }
  if (next.requirement_id === 'ASR-003') next.blocker = 'Production capacity and paging remain NOT_CONFIGURED';
  if (next.requirement_id === 'ASR-005') next.blocker = 'Operational AI runtime remains UNWIRED';
  if (next.requirement_id === 'ASR-005') next.runtime_evidence = 'Assurance boundary and subordinate AI-Ops source are INTEGRATED; operational activation remains UNWIRED';
  if (next.requirement_id === 'ASR-006') {
    next.blocker = 'Account B exact-C verification remains BLOCKED';
    next.runtime_evidence = 'A-FORMAL b491893 and S2 ca30adf are exact candidate ancestors';
    next.disposition = 'Both are INTEGRATED; formal runtime is REFERENCE_ONLY and S2 production consumer is NOT_CONFIGURED';
  }
  if (next.requirement_id === 'DEP-003') next.blocker = 'External sentinel and paging are NOT_CONFIGURED';
  if (next.blocker.includes('Candidate is not frozen')) next.blocker = 'Account B exact-C verification remains BLOCKED';
  if (next.blocker.includes('Exact candidate not frozen')) next.blocker = 'Full Pass 3 and Account B verification remain BLOCKED';
  if (next.blocker.includes('candidate rerun pending') || next.blocker.includes('Candidate-bound rerun pending')) next.blocker = 'Account B exact-C verification remains BLOCKED';
  return next;
});

const p0 = [
  ['P0-01-CI-HOTFIX','§2.1 item 1','CI hotfix truth','INTEGRATED','6c6d1edd is in Main and C; hotfix2 53c6da81 is REFERENCE_ONLY'],
  ['P0-02-ACTIVE-WRITERS','§2.1 item 2','writer ledger','INTEGRATED','ACTIVE_DIRTY=0; mandatory SEALED_UNMERGED=0; former writers are clean'],
  ['P0-03-CANONICAL-STATE','§2.1 item 3','state authority','INTEGRATED','root STATE blob 9546d70f owns product state; campaign STATE owns campaign status'],
  ['P0-04-AIOPS-COUNT','§2.1 item 4','AI-Ops Git census','INTEGRATED','Main 2ae has 0; C has 161 exact aiOps-segment paths'],
  ['P0-05-A4-EGRESS','§2.1 item 5','durability','INTEGRATED','A4 720d2fe7 and egress 8db67eee are clean, receipted, exact ancestors'],
  ['P0-06-SIGNATURE-ORDER','§2.1 item 6','owner gate ordering','DEFERRED_OWNER_GATE','inert source may integrate; worker/provider activation requires signed manifests'],
  ['P0-07-LEDGER-CAS','§2.1 item 7','ledger CAS disposition','WIRED_LOCAL','receipt lines 1663-1677; local CAS/read inventory only; append producer NOT_CONFIGURED'],
  ['P0-08-QUANTITY-BRIDGE','§2.1 item 8','quantity disposition','INTEGRATED','receipt lines 1678-1690; closed comparison; production consumer NOT_CONFIGURED'],
  ['P0-09-CLEAN-CHECKOUT','§2.1 item 9','clean checkout','INTEGRATED','Account A full-history single-branch clone npm test exit 0; independent token reserved to B'],
  ['CAMP-05-CENSUS','§5','worktree census','INTEGRATED','96/96 rows, exact fields/classification, UNKNOWN=0, unexplained source dirt=0'],
  ['CAMP-06-ARTIFACTS','§6','campaign artifacts','INTEGRATED','all 15 required filenames present with honest later-gate receipts'],
  ['CAMP-07-PASS0','§7','Pass 0 duties','BLOCKED','off-machine candidate bundle custody NOT_CONFIGURED'],
  ['CAMP-08-COVERAGE','§8','independent directive coverage','INTEGRATED','Account A first pass sealed before reconciliation; Account B matrix not read'],
  ['CAMP-09-PROVENANCE','§9','Git provenance','INTEGRATED','12 admitted donors exact; 326/326 blobs and grants; core adaptations explicit'],
  ['CAMP-10-CLEAN-CLONE','§10','full Pass 3','BLOCKED','Account A npm test passed; quant/browser/restore/rollback and B acceptance remain BLOCKED'],
  ['CAMP-17-TWO-ACCOUNT','§17','two-account separation','INTEGRATED','A assembled and froze C; B material not read; A issues no VERIFIED token'],
  ['CAMP-19-BLOCKERS','§19','release blocker law','BLOCKED','included AI-Ops and exact-C candidate await Account B verification'],
  ['CAMP-20-LADDER','§20','acceptance ladder','BLOCKED','BASELINE gate is blocked by off-machine custody; later gates are not implied'],
  ['CAMP-21-STOP','§21','precise stop law','BLOCKED','stop at exact missing off-machine custody evidence'],
].map(([requirement_id,source_section,authority,status,runtime_evidence]) => ({
  requirement_id, source_file: 'INDEPENDENT_PRODUCT_TRUTH_AND_LIVE_READINESS_CAMPAIGN_20260716.md', source_section,
  authority, owner: status === 'DEFERRED_OWNER_GATE' ? 'OWNER' : 'ACCOUNT_A', implementation_path: 'verification/product-truth-20260716/**',
  test_path: 'campaign evidence validation; exact Git probes', cockpit_surface: 'campaign status only', runtime_evidence,
  donor_sha: status === 'WIRED_LOCAL' ? coreDonor : 'NONE', candidate_sha: C, status,
  blocker: status === 'BLOCKED' ? runtime_evidence : 'NONE',
  disposition: status === 'BLOCKED' ? 'retain precise BLOCKED state; do not infer a later token' : 'binding requirement has an explicit exact-C disposition',
}));
const allDirectiveRows = [...updated.filter((row) => !p0.some((entry) => entry.requirement_id === row.requirement_id)), ...p0];
if (allDirectiveRows.some((row) => row.status === 'MISSING' || row.status === 'CONFLICTING' || row.candidate_sha !== C)) throw new Error('directive matrix release-state drift');
emitCsv('DIRECTIVE_COVERAGE_MATRIX.csv', requiredHeaders, allDirectiveRows);

const independentFindings = {
  schema: 'product-truth-independent-findings.v1', candidate_sha: C, status: 'BLOCKED',
  actor_role: 'ACCOUNT_A', account_b_material_read: false,
  findings: [],
  empty_findings_meaning: 'No Account B findings have been ingested; this is not a zero-findings claim',
  required_next_actor: 'ACCOUNT_B',
  account_b_write_permission_to_candidate: false,
  verification_gate: 'BLOCKED',
  receipt: { ...receiptContext, test_count: 0, deviations_skips_unavailable_evidence: ['Account B has not verified exact C', 'Empty findings do not imply acceptance'] },
};
writeFileSync(resolve(OUT, 'INDEPENDENT_FINDINGS.json'), `${JSON.stringify(independentFindings, null, 2)}\n`);

console.log(JSON.stringify({ candidate: C, provenance_lanes: laneEvidence.length, donor_paths: 326, core_adaptations: coreAdaptations.length, cockpit_rows: cockpitRows.length, directive_rows: allDirectiveRows.length, capability_rows: capabilityRows.length, environment_digest_sha256: environmentDigest }));
