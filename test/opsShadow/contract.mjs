import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ENTRY_GATE_PATH = 'fixtures/opsShadow/OPS_SHADOW_ENTRY_GATE.v1.json';
export const INSERTION_REQUESTS_PATH = 'fixtures/opsShadow/OPS_SHADOW_INSERTION_REQUESTS.v1.json';
export const SOURCE_RECEIPT_PATH = 'fixtures/opsShadow/receipts/OPS_SHADOW_RECEIPT.v1.json';
export const PORT_RECEIPT_PATH = 'fixtures/opsShadow/receipts/PORT_OPS_PRESTAGE_RECEIPT.v1.json';
export const RECEIPT_PATH = PORT_RECEIPT_PATH;

export const EXPECTED_IMPLEMENTATION_PATHS = Object.freeze([
  ENTRY_GATE_PATH,
  INSERTION_REQUESTS_PATH,
  SOURCE_RECEIPT_PATH,
  'test/opsShadow/contract.mjs',
  'test/opsShadow/entry-gate.test.mjs',
  'test/opsShadow/network-boundary.test.mjs',
  'test/opsShadow/owner-conformance.test.mjs',
  'test/opsShadow/receipt-binding.test.mjs',
  'test/opsShadow/run-focused.mjs',
  'test/opsShadow/validate-receipt.mjs',
]);

export const EXPECTED_BASE_SHA = '492e3f69b054c85686bcfc4c09dbff4ababeda3f';
export const EXPECTED_BRANCH = 'port-ops-20260716';
export const EXPECTED_SOURCE_BASE_SHA = '098f7b9449ab3b1c26bda19f51537bfea01d4c48';
export const EXPECTED_SOURCE_IMPLEMENTATION_SHA = 'd5f2fc86acc7367902009cfe01c7bf9a50ecb1f1';
export const EXPECTED_SOURCE_IMPLEMENTATION_TREE = 'b104dbddb9ad80a415e085c38b6939c8b83f93ac';
export const EXPECTED_SOURCE_SEAL_SHA = 'cdf64b678539a7d63cb406d70b0ca491d40d1a05';
export const EXPECTED_SOURCE_SEAL_TREE = '72f370735ff46b83dfa7add38aa55f249a4f20cb';
export const EXPECTED_SOURCE_RECEIPT_BLOB = 'b1ddb6dab6ce267271c2e60a8f77a76897f9f5bf';
export const EXPECTED_SOURCE_RECEIPT_SHA256 = 'b717f2a04455367a73aaa2a0fb0fcb2af64ba0266ae52d5b2796c2c9b00f4d85';
export const EXPECTED_SOURCE_PATCH_SHA256 = '74f611787ff24c934116864ea466b5331c7ba0779df09b8583d5c1ccd2a4b2c3';
export const EXPECTED_DONOR_SHA = '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5';
export const EXPECTED_DONOR_IMPLEMENTATION_SHA = '9a82d4715c73ebe4156638c2bf5e8a2c02373bbf';
export const EXPECTED_DONOR_TREE = 'e401435d6a650aee8a29c3da4495b4db426be017';
export const EXPECTED_DONOR_IMPLEMENTATION_TREE = 'f6715c9a7b1e26121e3f1a9051bdd5290f9bfb07';
export const EXPECTED_DONOR_OPS_LIVE_TREE = '584163858a0333cb1ccb9eff756e91a851b1cb71';
export const EXPECTED_DONOR_OPS_TESTS_TREE = 'f3348a74ef22d9ca2faee431ea8cc5df63f552af';
export const EXPECTED_DONOR_RECEIPT_BLOB = '7fc3520d4fede577937c6dd48c191b1e5d212061';
export const EXPECTED_OPS_LIVE_TREE = 'd016e6ffb2b805cf52d31728c8635221db56c2f6';
export const EXPECTED_OPS_TESTS_TREE = '10f102b212dd0a31249723c2d87aaa4aaca1e057';
export const EXPECTED_OPS_I00_TREE = 'ddba7c3a4f59c60af5e0f2cae11de2451bf516d9';
export const EXPECTED_AMENDMENT_PATH = 'ops/i00/l15-amendment-contract.json';
export const EXPECTED_AMENDMENT_BLOB = '8ca3277a5cc69d1976e33a5cd2110c638db9f467';
export const EXPECTED_AMENDMENT_SHA256 = '05e5c817ab638c78b726a18708620dfb850e315779c73a5964db2ecb2f03a4d7';
export const EXPECTED_EFFECTIVE_ROOT_SHA256 = '94f7dffc6583b471e8d193f8ec95c3f5dc12a2a0081b8e10a342e9ac5c26e524';
export const EXPECTED_REGISTRY_SHA = '08e0beaa54c4c3ca9c24276785d6a302f751a226';
export const EXPECTED_REGISTRY_BLOB = '5f76b29a81b6af4eee7a156afc16979fea02635e';
export const EXPECTED_AGENT_BOUNDARY_BLOB = '042456c58b1cd5b6eb179c0c9c289f6e69d06034';
export const EXPECTED_AGENT_BOUNDARY_SHA256 = 'abc7f76af710c08abf43b2b3f67a083861e131eadbeb5bcce8b7b4c72db372bc';

export const CLASSIFICATIONS = Object.freeze([
  'ADOPT_EXISTING',
  'ADAPT_EXISTING',
  'MISSING_BUILD',
  'REFERENCE_ONLY',
  'REJECT_DUPLICATE',
]);

export const EXCLUSIVE_ROOTS = Object.freeze([
  'fixtures/opsShadow',
  'test/opsShadow',
]);

export const REPOSITORY_GATE_COMMANDS = Object.freeze([
  'npm test',
  'npm run test:all',
]);

export const EXPECTED_TEST_ALL_SHARED_BLOCKER = Object.freeze({
  code: 'OUT_OF_SCOPE_SHARED_OWNER_QL_REPIN_DRIFT',
  owner: 'I00_ACCEPTANCE_AND_DIRECTOR_INPUT_OWNER',
  failingTestCount: 2,
  i00ProofPassed: 45,
  i00ProofFailed: 2,
  affectedInputs: Object.freeze([
    Object.freeze({
      path: 'QL_DIRECTOR_STATE.md',
      assignedBaseSha256: '57eaf6d10e5a4c3fe9dc60324fb906ebe1385aeb082283930853cbfdf19d0494',
      proofExpectedSha256: '77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc',
    }),
    Object.freeze({
      path: 'QL_PARALLEL_DAG.md',
      assignedBaseSha256: '89a13c8a6a6b00a834d3dc586cc45c29eb4f7f32b2106fb5dea10fd2be3742a0',
      proofExpectedSha256: 'cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec',
    }),
  ]),
  failingTests: Object.freeze([
    'server/test/i00Acceptance/authority-protocol.test.mjs::final D-LAUNCH-7 repin accepts exact current-main objects while historical packet pins stay immutable',
    'server/test/i00Acceptance/closure-evidence.test.mjs::current machine evidence is input-driven for both legal candidate phases and historical IP-PROOF evidence stays historical',
  ]),
  unchangedFromAssignedBase: true,
  requiredInsertionRequestIds: Object.freeze([
    'AIOPS-IR-DOCS-017',
    'AIOPS-IR-TEST-MOUNT-026',
  ]),
  broaderRootGreenClaimed: false,
});

export function validateLoopbackCurlArgs(args) {
  if (!Array.isArray(args)) return { valid: false, reason: 'ARGUMENT_ARRAY_REQUIRED' };
  let urlCount = 0;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (typeof value !== 'string' || value.length === 0) return { valid: false, reason: 'EMPTY_OR_NON_STRING_ARGUMENT' };
    if (/^-[fsS]+$/u.test(value)) continue;
    if (value === '-m' || value === '--max-time') {
      const timeout = args[++index];
      if (!/^[1-9][0-9]*$/u.test(timeout ?? '')) return { valid: false, reason: 'INVALID_TIMEOUT' };
      continue;
    }
    if (value === '-o' || value === '--output') {
      if (args[++index] !== '/dev/null') return { valid: false, reason: 'OUTPUT_MUST_BE_DEV_NULL' };
      continue;
    }
    if (value.startsWith('-')) return { valid: false, reason: 'CURL_OPTION_NOT_ALLOWLISTED' };
    let parsed;
    try { parsed = new URL(value); } catch { return { valid: false, reason: 'URL_INVALID' }; }
    const port = Number(parsed.port);
    if (parsed.protocol !== 'http:'
        || parsed.hostname !== '127.0.0.1'
        || parsed.username !== ''
        || parsed.password !== ''
        || !Number.isInteger(port)
        || port < 1
        || port > 65535) {
      return { valid: false, reason: 'EXACT_NUMERIC_LOOPBACK_HTTP_REQUIRED' };
    }
    urlCount += 1;
  }
  if (urlCount !== 1) return { valid: false, reason: 'EXACTLY_ONE_URL_REQUIRED' };
  return { valid: true, reason: null };
}

function quoteCommandToken(value) {
  return /^[A-Za-z0-9_./:=*-]+$/u.test(value) ? value : JSON.stringify(value);
}

const DENY_ALL_SANDBOX_PROFILE = '(version 1)(allow default)(deny network*)';
export const LOOPBACK_ONLY_SANDBOX_PROFILE = '(version 1)(allow default)(deny network*)(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))(allow process-exec (with no-sandbox) (literal "/bin/ps"))';

export const FOCUSED_COMMAND_SPECS = Object.freeze([
  {
    category: 'PORT_OPS_CONFORMANCE_DENY_ALL',
    evidenceKind: 'PACKET_DENY_ALL',
    command: '/usr/bin/sandbox-exec',
    args: [
      '-p', DENY_ALL_SANDBOX_PROFILE,
      process.execPath,
      '--import', './server/test/private-egress-tripwire.mjs',
      '--test',
      '--test-concurrency=1',
      '--test-reporter=spec',
      'test/opsShadow/**/*.test.mjs',
    ],
  },
  {
    category: 'PORT_OPS_CANONICAL_DONOR',
    evidenceKind: 'STATIC_CANONICAL_OWNER_DENY_ALL',
    command: '/usr/bin/sandbox-exec',
    args: ['-p', DENY_ALL_SANDBOX_PROFILE, process.execPath, 'ops/i00/bin/verify-donor.mjs', '--repo', '.', '--integrated'],
  },
  {
    category: 'PORT_OPS_LIVE_AGGREGATE',
    evidenceKind: 'LOCAL_FAKE_LOOPBACK_KERNEL_EXTERNAL_DENY_FIXED_PS_EXCEPTION',
    command: '/usr/bin/sandbox-exec',
    args: ['-p', LOOPBACK_ONLY_SANDBOX_PROFILE, 'bash', 'ops/tests/run-all.sh'],
  },
  {
    category: 'PORT_OPS_I00_AGGREGATE',
    evidenceKind: 'LOCAL_FAKE_LOOPBACK_KERNEL_EXTERNAL_DENY_FIXED_PS_EXCEPTION',
    command: '/usr/bin/sandbox-exec',
    args: ['-p', LOOPBACK_ONLY_SANDBOX_PROFILE, 'bash', 'ops/tests/i00/run-all.sh'],
  },
].map((entry) => Object.freeze({
  ...entry,
  args: Object.freeze([...entry.args]),
  commandText: [entry.command, ...entry.args].map(quoteCommandToken).join(' '),
})));

const EXPECTED_ROW_CLASSIFICATIONS = new Map([
  ['OPS-SYSTEMD-UNITS', 'ADOPT_EXISTING'],
  ['OPS-WATCHDOG', 'ADAPT_EXISTING'],
  ['OPS-BACKUP', 'ADOPT_EXISTING'],
  ['OPS-RESTORE-ISOLATED', 'ADAPT_EXISTING'],
  ['OPS-RESTORE-PRODUCTION', 'REFERENCE_ONLY'],
  ['OPS-ROLLBACK', 'ADOPT_EXISTING'],
  ['OPS-CLOUDFLARE', 'ADOPT_EXISTING'],
  ['OPS-SECRETS-IAM', 'ADOPT_EXISTING'],
  ['OPS-SECRETS-PROVIDER', 'ADOPT_EXISTING'],
  ['OPS-LOCAL-FAKE-HARNESSES', 'ADAPT_EXISTING'],
  ['OPS-RUN16-CONFORMANCE', 'ADAPT_EXISTING'],
  ['OPS-RUN16-METADATA', 'MISSING_BUILD'],
  ['OPS-REAL-ACTIVATION', 'REFERENCE_ONLY'],
  ['OPS-NEW-OPERATIONAL-OWNER', 'REJECT_DUPLICATE'],
]);

export const EXPECTED_INSERTION_REQUEST_IDS = Object.freeze([
  'AIOPS-IR-DEPLOYMENT-007',
  'AIOPS-IR-TELEMETRY-012',
  'AIOPS-IR-NOTIFY-014',
  'AIOPS-IR-EGRESS-016',
  'AIOPS-IR-DOCS-017',
  'AIOPS-IR-SENTINEL-020',
  'AIOPS-IR-MANAGED-INVENTORY-022',
  'AIOPS-IR-APPROVAL-023',
  'AIOPS-IR-BROWSER-PROBE-024',
  'AIOPS-IR-CONFIG-025',
  'AIOPS-IR-TEST-MOUNT-026',
]);

export const EXPECTED_ADVERSARIAL_REVIEW_IDS = Object.freeze([
  'ADV-SCOPE-001',
  'ADV-SOURCE-002',
  'ADV-REGISTRY-003',
  'ADV-NETWORK-004',
  'ADV-DONOR-005',
  'ADV-WATCHDOG-006',
  'ADV-RESTORE-007',
  'ADV-RECEIPT-008',
  'ADV-ROOT-GATES-009',
  'ADV-SECRETS-010',
]);

export const EXPECTED_LIMITATION_IDS = Object.freeze([
  'HOST_NATIVE_VALIDATION',
  'NETWORK_BOUNDARY',
  'RESTORE_ATOMICITY',
  'EXTERNAL_ACTIVATION',
  'SHARED_SEAMS',
  'INTEGRATION_STATUS',
  'MONEY_AND_CREDENTIALS',
]);

const EXPECTED_DEDUP_DISPOSITIONS = new Map([
  ['OPS-PORT-PLAN-DESTINATION', 'REJECT_DUPLICATE'],
  ['OPS-WATCHDOG-CORRECTION-OWNER', 'ADAPT_EXISTING'],
  ['OPS-RESTORE-CORRECTION-OWNER', 'ADAPT_EXISTING'],
  ['OPS-SHARED-TRUTH-OWNERS', 'REFERENCE_ONLY'],
  ['OPS-STATE-DOCUMENT-RECONCILIATION', 'REFERENCE_ONLY'],
]);

const EXPECTED_SOURCE_DISPOSITIONS = new Map([
  ['OPS-SHADOW-IR-RESTORE-001', ['DEDUP_AND_NARROW_TO_CURRENT_OWNER', ['AIOPS-IR-DEPLOYMENT-007', 'AIOPS-IR-DOCS-017']]],
  ['OPS-SHADOW-IR-SYSTEMD-002', ['RETAIN_AS_TYPED_REGISTRY_HANDOFF', ['AIOPS-IR-DEPLOYMENT-007']]],
  ['OPS-SHADOW-IR-CLOUDFLARE-003', ['RETAIN_AS_TYPED_REGISTRY_HANDOFF', ['AIOPS-IR-DEPLOYMENT-007', 'AIOPS-IR-EGRESS-016', 'AIOPS-IR-CONFIG-025']]],
  ['OPS-SHADOW-IR-WATCHDOG-004', ['DEDUP_TO_EXISTING_TRUTH_OWNERS', ['AIOPS-IR-TELEMETRY-012', 'AIOPS-IR-NOTIFY-014', 'AIOPS-IR-SENTINEL-020', 'AIOPS-IR-MANAGED-INVENTORY-022', 'AIOPS-IR-BROWSER-PROBE-024']]],
  ['OPS-SHADOW-IR-OWNER-INPUTS-005', ['DEDUP_TO_CONFIGURATION_AND_HUMAN_AUTHORITY', ['AIOPS-IR-DEPLOYMENT-007', 'AIOPS-IR-APPROVAL-023', 'AIOPS-IR-CONFIG-025']]],
  ['PORT-OPS-ROOT-TEST-MOUNT', ['NEW_TYPED_HANDOFF', ['AIOPS-IR-TEST-MOUNT-026']]],
]);

function stripRegistryMarkdown(value) {
  return value.replaceAll('`', '').trim();
}

function splitRegistryArray(value) {
  return stripRegistryMarkdown(value).split(/;\s+/u).map((entry) => entry.trim()).filter(Boolean);
}

export function loadPinnedInsertionRequestRows() {
  const registry = runGit(['show', `${EXPECTED_REGISTRY_SHA}:AI_OPS_COLLISION_MAP.md`]).stdout;
  const rows = new Map();
  for (const line of registry.split(/\r?\n/u)) {
    if (!line.startsWith('| `AIOPS-IR-')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 8) throw new Error(`pinned registry row has ${cells.length} cells, expected 8`);
    const [rowIdCell, , requestedOwnerCell, targetSeamCell, reasonCell, contractCell, testsCell, expectedBehaviorCell] = cells;
    const rowId = stripRegistryMarkdown(rowIdCell);
    if (!EXPECTED_INSERTION_REQUEST_IDS.includes(rowId)) continue;
    rows.set(rowId, {
      schema: 'InsertionRequestRowV1',
      version: 1,
      rowId,
      status: 'DRAFT',
      requestedOwner: stripRegistryMarkdown(requestedOwnerCell),
      targetSeam: stripRegistryMarkdown(targetSeamCell),
      reason: stripRegistryMarkdown(reasonCell),
      contract: splitRegistryArray(contractCell),
      tests: splitRegistryArray(testsCell),
      expectedBehavior: splitRegistryArray(expectedBehaviorCell),
      wiringState: `PENDING_BACKEND:${rowId}`,
      authorityCreated: false,
    });
  }
  if (!sameStringSet([...rows.keys()], EXPECTED_INSERTION_REQUEST_IDS)) {
    throw new Error(`pinned registry row set mismatch: ${[...rows.keys()].join(', ')}`);
  }
  return EXPECTED_INSERTION_REQUEST_IDS.map((rowId) => rows.get(rowId));
}

function issue(list, code, path, message) {
  list.push({ code, path, message });
}

export function hasIssue(issues, code) {
  return issues.some((entry) => entry.code === code);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function loadJson(repoPath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, repoPath), 'utf8'));
}

export function runGit(args, { binary = false, allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: binary ? null : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    const detail = binary ? String(result.stderr ?? '') : result.stderr;
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${detail}`);
  }
  return result;
}

export function gitText(...args) {
  return runGit(args).stdout.trim();
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

export function captureImplementationContext() {
  const testedCommitSha = gitText('rev-parse', 'HEAD');
  const testedTreeSha = gitText('rev-parse', 'HEAD^{tree}');
  const branch = gitText('branch', '--show-current');
  const lineage = gitText('rev-list', '--parents', '-n', '1', 'HEAD').split(/\s+/u);
  const parentSha = lineage.length === 2 ? lineage[1] : null;
  const changeRows = gitText(
    'diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', EXPECTED_BASE_SHA, 'HEAD',
  ).split('\n').filter(Boolean).sort();
  const expectedChangeRows = EXPECTED_IMPLEMENTATION_PATHS.map((path) => `A\t${path}`).sort();
  const changedPaths = changeRows.map((row) => row.split('\t').at(-1)).sort();
  const status = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout;
  const prematureReceipt = runGit(['cat-file', '-e', `HEAD:${PORT_RECEIPT_PATH}`], { allowFailure: true }).status === 0;
  const valid = branch === EXPECTED_BRANCH
    && lineage.length === 2
    && lineage[0] === testedCommitSha
    && parentSha === EXPECTED_BASE_SHA
    && status.length === 0
    && !prematureReceipt
    && JSON.stringify(changeRows) === JSON.stringify(expectedChangeRows);
  return {
    valid,
    testedCommitSha,
    testedTreeSha,
    branch,
    parentSha,
    worktreeState: valid ? 'CLEAN_EXACT_IMPLEMENTATION_COMMIT' : 'INVALID_IMPLEMENTATION_CONTEXT',
    changedPaths,
    changeRows,
    statusByteLength: Buffer.byteLength(status),
    prematureReceipt,
  };
}

function isRepoRelative(repoPath) {
  return typeof repoPath === 'string'
    && repoPath.length > 0
    && !repoPath.startsWith('/')
    && !repoPath.includes('\\')
    && !repoPath.split('/').includes('..');
}

export function isExclusivePath(repoPath) {
  return isRepoRelative(repoPath)
    && EXCLUSIVE_ROOTS.some((root) => repoPath === root || repoPath.startsWith(`${root}/`));
}

function validatePathReference(issues, repoPath, path, { mayBePendingReceipt = false } = {}) {
  if (!isRepoRelative(path)) {
    issue(issues, 'REPO_RELATIVE_PATH_REQUIRED', repoPath, `invalid repository path ${String(path)}`);
    return;
  }
  if (mayBePendingReceipt && path === RECEIPT_PATH) return;
  if (!existsSync(join(REPO_ROOT, path))) {
    issue(issues, 'REFERENCED_PATH_MISSING', repoPath, `${path} does not exist`);
  }
}

export function validateEntryGate(value) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, 'ENTRY_GATE_OBJECT_REQUIRED', '$', 'entry gate must be an object');
    return issues;
  }
  if (value.schema !== 'PORT_OPS_ENTRY_GATE_V1') issue(issues, 'ENTRY_GATE_SCHEMA_INVALID', '$.schema', 'schema must be exact');
  if (value.packet !== 'RUN-16-PORT' || value.task !== 'PORT-OPS' || value.phase !== 'POST_LANDING_PRESTAGE') {
    issue(issues, 'PACKET_IDENTITY_INVALID', '$', 'packet identity must be the real post-landing PORT OPS lane');
  }
  if (value.targetTerminalState !== 'PORT_OPS_PRESTAGE_READY' || value.laneAcceptanceTarget !== 'PASS' || value.prestageOnly !== true) {
    issue(issues, 'TARGET_TERMINAL_INVALID', '$.targetTerminalState', 'terminal, lane target, and prestage posture must be exact');
  }
  for (const field of [
    'integratedAcceptedClaimed',
    'authorityGranted',
    'deploymentPerformed',
    'networkMutationPerformed',
    'credentialMutationPerformed',
    'moneyMutationPerformed',
  ]) {
    if (value[field] !== false) issue(issues, 'FORBIDDEN_AFFIRMATIVE_CLAIM', `$.${field}`, `${field} must be false`);
  }
  if (value.authorityEffect !== 'NONE') issue(issues, 'AUTHORITY_EFFECT_FORBIDDEN', '$.authorityEffect', 'authority effect must be NONE');
  if (value.launchAuthority?.decision !== 'D-LAUNCH-51'
      || value.launchAuthority?.decisionCommit !== 'e619ff18ef159c27061cfaf318036e18a4fac131'
      || value.launchAuthority?.landedBaseDecision !== 'D-LAUNCH-50'
      || value.launchAuthority?.landedBase !== EXPECTED_BASE_SHA) {
    issue(issues, 'LAUNCH_AUTHORITY_MISMATCH', '$.launchAuthority', 'launch authority binding is not exact');
  }
  if (value.portBase?.branch !== EXPECTED_BRANCH || value.portBase?.sha !== EXPECTED_BASE_SHA
      || value.portBase?.opsLiveTree !== EXPECTED_OPS_LIVE_TREE
      || value.portBase?.opsTestsTree !== EXPECTED_OPS_TESTS_TREE
      || value.portBase?.opsI00Tree !== EXPECTED_OPS_I00_TREE) {
    issue(issues, 'BASE_BINDING_MISMATCH', '$.portBase', 'base branch, SHA, and current operational trees must be exact');
  }
  const source = value.sourceShadow ?? {};
  const expectedSource = {
    status: 'SHADOW_SPECULATIVE',
    acceptanceTransferred: false,
    baseSha: EXPECTED_SOURCE_BASE_SHA,
    implementationCommit: EXPECTED_SOURCE_IMPLEMENTATION_SHA,
    implementationTree: EXPECTED_SOURCE_IMPLEMENTATION_TREE,
    sealCommit: EXPECTED_SOURCE_SEAL_SHA,
    sealTree: EXPECTED_SOURCE_SEAL_TREE,
    filteredPatchSha256: EXPECTED_SOURCE_PATCH_SHA256,
    receiptPath: SOURCE_RECEIPT_PATH,
    receiptBlob: EXPECTED_SOURCE_RECEIPT_BLOB,
    receiptSha256: EXPECTED_SOURCE_RECEIPT_SHA256,
    receiptUse: 'HISTORICAL_PROVENANCE_ONLY',
  };
  for (const [field, expected] of Object.entries(expectedSource)) {
    if (source[field] !== expected) issue(issues, 'SOURCE_SHADOW_BINDING_MISMATCH', `$.sourceShadow.${field}`, `${field} must bind the sealed source without transferring acceptance`);
  }
  const donor = value.operationalOwner?.immutableDonor ?? {};
  const expectedDonor = {
    acceptedCommit: EXPECTED_DONOR_SHA,
    implementationCommit: EXPECTED_DONOR_IMPLEMENTATION_SHA,
    acceptedCommitTree: EXPECTED_DONOR_TREE,
    implementationTree: EXPECTED_DONOR_IMPLEMENTATION_TREE,
    acceptedOpsLiveTree: EXPECTED_DONOR_OPS_LIVE_TREE,
    acceptedOpsTestsTree: EXPECTED_DONOR_OPS_TESTS_TREE,
    acceptedReceiptBlob: EXPECTED_DONOR_RECEIPT_BLOB,
  };
  for (const [field, expected] of Object.entries(expectedDonor)) {
    if (donor[field] !== expected) issue(issues, 'DONOR_BINDING_MISMATCH', `$.donor.${field}`, `${field} must bind the accepted donor`);
  }
  const amendments = value.operationalOwner?.authorizedAmendments ?? {};
  if (amendments.contractPath !== EXPECTED_AMENDMENT_PATH
      || amendments.contractGitBlob !== EXPECTED_AMENDMENT_BLOB
      || amendments.contractSha256 !== EXPECTED_AMENDMENT_SHA256
      || amendments.effectiveOpsLiveTree !== EXPECTED_OPS_LIVE_TREE
      || amendments.effectiveRootDigestSha256 !== EXPECTED_EFFECTIVE_ROOT_SHA256
      || !sameStringSet(amendments.findingIds, ['R3-D-WATCHDOG-007', 'R3-D-BACKUP-008'])) {
    issue(issues, 'AMENDMENT_BINDING_MISMATCH', '$.operationalOwner.authorizedAmendments', 'ordered authorized corrections must be exact');
  }
  if (value.operationalOwner?.posture !== 'IMMUTABLE_DONOR_PLUS_ORDERED_AUTHORIZED_CORRECTIONS'
      || value.operationalOwner?.canonicalVerifier !== 'ops/i00/bin/verify-donor.mjs') {
    issue(issues, 'OWNER_POSTURE_INVALID', '$.operationalOwner', 'canonical owner posture and verifier must be exact');
  }
  if (!sameStringSet(value.classificationVocabulary, CLASSIFICATIONS)) {
    issue(issues, 'CLASSIFICATION_VOCABULARY_INVALID', '$.classificationVocabulary', 'the exact five-value vocabulary is required');
  }
  if (!sameStringSet(value.exclusivePathRoots, EXCLUSIVE_ROOTS)) {
    issue(issues, 'EXCLUSIVE_ROOTS_INVALID', '$.exclusivePathRoots', 'exclusive roots must be exact');
  }
  if (!Array.isArray(value.researchBasis) || value.researchBasis.length < 5) {
    issue(issues, 'RESEARCH_BASIS_INCOMPLETE', '$.researchBasis', 'current official research anchors are required');
  } else {
    for (const [index, research] of value.researchBasis.entries()) {
      if (research?.reviewedAt !== '2026-07-16' || !Array.isArray(research?.sources) || research.sources.length === 0
          || research.sources.some((url) => typeof url !== 'string' || !url.startsWith('https://'))) {
        issue(issues, 'RESEARCH_BASIS_INVALID', `$.researchBasis[${index}]`, 'research must bind dated official HTTPS sources');
      }
    }
  }
  const rows = Array.isArray(value.rows) ? value.rows : [];
  if (!Array.isArray(value.rows)) issue(issues, 'CLASSIFICATION_ROWS_REQUIRED', '$.rows', 'rows must be an array');
  const rowIds = rows.map((row) => row?.id);
  if (new Set(rowIds).size !== rowIds.length) issue(issues, 'DUPLICATE_ROW_ID', '$.rows', 'classification row IDs must be unique');
  if (!sameStringSet(rowIds, [...EXPECTED_ROW_CLASSIFICATIONS.keys()])) {
    issue(issues, 'CLASSIFICATION_ROW_SET_INVALID', '$.rows', 'every proposed item must have exactly one classification row');
  }
  for (const [index, row] of rows.entries()) {
    const rowPath = `$.rows[${index}]`;
    if (!CLASSIFICATIONS.includes(row?.classification)) {
      issue(issues, 'CLASSIFICATION_INVALID', `${rowPath}.classification`, 'classification is outside the five-value vocabulary');
    }
    if (EXPECTED_ROW_CLASSIFICATIONS.get(row?.id) !== row?.classification) {
      issue(issues, 'CLASSIFICATION_RULING_MISMATCH', rowPath, `${String(row?.id)} has the wrong donor-first ruling`);
    }
    if (typeof row?.proposedItem !== 'string' || row.proposedItem.length < 12) issue(issues, 'PROPOSED_ITEM_REQUIRED', `${rowPath}.proposedItem`, 'proposed item must be explicit');
    if (typeof row?.rationale !== 'string' || row.rationale.length < 20) issue(issues, 'RATIONALE_REQUIRED', `${rowPath}.rationale`, 'classification rationale must be explicit');
    const buildPaths = Array.isArray(row?.portBuildPaths) ? row.portBuildPaths : [];
    const buildable = row?.classification === 'ADAPT_EXISTING' || row?.classification === 'MISSING_BUILD';
    if (buildable && buildPaths.length === 0) issue(issues, 'BUILDABLE_ROW_HAS_NO_PATH', `${rowPath}.portBuildPaths`, 'adapt/missing row needs packet-local paths');
    if (!buildable && buildPaths.length !== 0) issue(issues, 'NON_BUILDABLE_ROW_HAS_PATH', `${rowPath}.portBuildPaths`, 'only adapt/missing rows may build');
    for (const [pathIndex, path] of buildPaths.entries()) {
      if (!isExclusivePath(path)) issue(issues, 'BUILD_PATH_OUTSIDE_EXCLUSIVE_SCOPE', `${rowPath}.portBuildPaths[${pathIndex}]`, `${String(path)} is outside packet scope`);
      if (/\.(?:service|timer|sh|ya?ml|template)$/u.test(path)) {
        issue(issues, 'OPERATIONAL_TEMPLATE_COPY_FORBIDDEN', `${rowPath}.portBuildPaths[${pathIndex}]`, 'port paths may not copy operational templates');
      }
      validatePathReference(issues, `${rowPath}.portBuildPaths[${pathIndex}]`, path, { mayBePendingReceipt: true });
    }
    for (const field of ['ownerPaths', 'adaptationPaths', 'provingTests']) {
      if (!Array.isArray(row?.[field])) issue(issues, 'PATH_LIST_REQUIRED', `${rowPath}.${field}`, `${field} must be an array`);
      for (const [pathIndex, path] of (row?.[field] ?? []).entries()) {
        validatePathReference(issues, `${rowPath}.${field}[${pathIndex}]`, path);
      }
    }
  }
  if (!Array.isArray(value.dedupEvidence) || value.dedupEvidence.length < 5
      || !value.dedupEvidence.some((entry) => entry?.id === 'OPS-PORT-PLAN-DESTINATION' && entry?.disposition === 'REJECT_DUPLICATE')) {
    issue(issues, 'DEDUP_EVIDENCE_INCOMPLETE', '$.dedupEvidence', 'live owner and stale planner dedup evidence is required');
  }
  if (!Array.isArray(value.limitations) || value.limitations.length < 6) {
    issue(issues, 'LIMITATIONS_INCOMPLETE', '$.limitations', 'host, suite, restore, activation, shared-seam, and integration limits must remain explicit');
  }
  return issues;
}

export function validateGitBindings(value) {
  const issues = [];
  const checks = [
    ['SOURCE_IMPLEMENTATION_PARENT_MISMATCH', [`${EXPECTED_SOURCE_IMPLEMENTATION_SHA}^`], EXPECTED_SOURCE_BASE_SHA],
    ['SOURCE_IMPLEMENTATION_TREE_MISMATCH', [`${EXPECTED_SOURCE_IMPLEMENTATION_SHA}^{tree}`], EXPECTED_SOURCE_IMPLEMENTATION_TREE],
    ['SOURCE_SEAL_PARENT_MISMATCH', [`${EXPECTED_SOURCE_SEAL_SHA}^`], EXPECTED_SOURCE_IMPLEMENTATION_SHA],
    ['SOURCE_SEAL_TREE_MISMATCH', [`${EXPECTED_SOURCE_SEAL_SHA}^{tree}`], EXPECTED_SOURCE_SEAL_TREE],
    ['SOURCE_RECEIPT_BLOB_MISMATCH', [`${EXPECTED_SOURCE_SEAL_SHA}:${SOURCE_RECEIPT_PATH}`], EXPECTED_SOURCE_RECEIPT_BLOB],
    ['DONOR_PARENT_MISMATCH', [`${EXPECTED_DONOR_SHA}^`], EXPECTED_DONOR_IMPLEMENTATION_SHA],
    ['DONOR_TREE_MISMATCH', [`${EXPECTED_DONOR_SHA}^{tree}`], EXPECTED_DONOR_TREE],
    ['DONOR_IMPLEMENTATION_TREE_MISMATCH', [`${EXPECTED_DONOR_IMPLEMENTATION_SHA}^{tree}`], EXPECTED_DONOR_IMPLEMENTATION_TREE],
    ['DONOR_OPS_LIVE_TREE_MISMATCH', [`${EXPECTED_DONOR_SHA}:ops/live`], EXPECTED_DONOR_OPS_LIVE_TREE],
    ['DONOR_OPS_TESTS_TREE_MISMATCH', [`${EXPECTED_DONOR_SHA}:ops/tests`], EXPECTED_DONOR_OPS_TESTS_TREE],
    ['DONOR_RECEIPT_BLOB_MISMATCH', [`${EXPECTED_DONOR_SHA}:ops/live/RECEIPT.md`], EXPECTED_DONOR_RECEIPT_BLOB],
    ['BASE_OPS_LIVE_TREE_MISMATCH', [`${EXPECTED_BASE_SHA}:ops/live`], EXPECTED_OPS_LIVE_TREE],
    ['BASE_OPS_TESTS_TREE_MISMATCH', [`${EXPECTED_BASE_SHA}:ops/tests`], EXPECTED_OPS_TESTS_TREE],
    ['BASE_OPS_I00_TREE_MISMATCH', [`${EXPECTED_BASE_SHA}:ops/i00`], EXPECTED_OPS_I00_TREE],
    ['BASE_AMENDMENT_BLOB_MISMATCH', [`${EXPECTED_BASE_SHA}:${EXPECTED_AMENDMENT_PATH}`], EXPECTED_AMENDMENT_BLOB],
    ['REGISTRY_BLOB_MISMATCH', [`${EXPECTED_REGISTRY_SHA}:AI_OPS_COLLISION_MAP.md`], EXPECTED_REGISTRY_BLOB],
    ['AGENT_BOUNDARY_BLOB_MISMATCH', [`${EXPECTED_BASE_SHA}:fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json`], EXPECTED_AGENT_BOUNDARY_BLOB],
  ];
  for (const [code, args, expected] of checks) {
    let actual = '';
    try { actual = gitText('rev-parse', ...args); } catch (error) {
      issue(issues, code, '$.donor', error.message);
      continue;
    }
    if (actual !== expected) issue(issues, code, '$.donor', `expected ${expected}, got ${actual}`);
  }
  try {
    const sourceFork = gitText('merge-base', EXPECTED_SOURCE_SEAL_SHA, EXPECTED_BASE_SHA);
    if (sourceFork !== EXPECTED_SOURCE_BASE_SHA) issue(issues, 'SOURCE_FORK_MISMATCH', '$.sourceShadow.baseSha', `expected source fork ${EXPECTED_SOURCE_BASE_SHA}, got ${sourceFork}`);
  } catch (error) {
    issue(issues, 'SOURCE_FORK_PROOF_FAILED', '$.sourceShadow.baseSha', error.message);
  }
  const donorAncestor = runGit(['merge-base', '--is-ancestor', EXPECTED_DONOR_SHA, EXPECTED_BASE_SHA], { allowFailure: true });
  if (donorAncestor.status !== 0) issue(issues, 'DONOR_NOT_ANCESTOR_OF_BASE', '$.operationalOwner.immutableDonor', 'accepted donor must be an ancestor of the packet base');
  const baseAncestor = runGit(['merge-base', '--is-ancestor', EXPECTED_BASE_SHA, 'HEAD'], { allowFailure: true });
  if (baseAncestor.status !== 0) issue(issues, 'BASE_NOT_ANCESTOR_OF_HEAD', '$.portBase.sha', 'packet HEAD must descend from the exact base');
  let branch = '';
  try { branch = gitText('branch', '--show-current'); } catch (error) { issue(issues, 'BRANCH_READ_FAILED', '$.portBase.branch', error.message); }
  if (branch !== EXPECTED_BRANCH) issue(issues, 'BRANCH_MISMATCH', '$.portBase.branch', `expected ${EXPECTED_BRANCH}, got ${branch || 'DETACHED_HEAD'}`);
  const basePacketRoot = runGit(['cat-file', '-e', `${EXPECTED_BASE_SHA}:fixtures/opsShadow`], { allowFailure: true });
  if (basePacketRoot.status === 0) issue(issues, 'BASE_PACKET_ROOT_NOT_ABSENT', '$.portBase.sha', 'port fixtures must be additive on the exact base');
  try {
    const amendmentBytes = runGit(['show', `${EXPECTED_BASE_SHA}:${EXPECTED_AMENDMENT_PATH}`], { binary: true }).stdout;
    if (sha256(amendmentBytes) !== EXPECTED_AMENDMENT_SHA256) issue(issues, 'AMENDMENT_SHA256_MISMATCH', '$.operationalOwner.authorizedAmendments', 'amendment bytes are not exact');
    const schemaBytes = runGit(['show', `${EXPECTED_BASE_SHA}:fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json`], { binary: true }).stdout;
    if (sha256(schemaBytes) !== EXPECTED_AGENT_BOUNDARY_SHA256) issue(issues, 'AGENT_BOUNDARY_SHA256_MISMATCH', '$.registryAuthority', 'landed boundary schema bytes are not exact');
  } catch (error) {
    issue(issues, 'BOUND_BYTES_PROOF_FAILED', '$', error.message);
  }
  return issues;
}

const OWNER_PATHS = Object.freeze({
  appService: 'ops/live/systemd/cosmos-app.service',
  tunnelService: 'ops/live/systemd/cloudflared.service',
  watchdogService: 'ops/live/systemd/cosmos-watchdog.service',
  watchdogTimer: 'ops/live/systemd/cosmos-watchdog.timer',
  backupService: 'ops/live/systemd/cosmos-backup.service',
  backupTimer: 'ops/live/systemd/cosmos-backup.timer',
  restoreDrillService: 'ops/live/systemd/cosmos-restore-drill.service',
  restoreDrillTimer: 'ops/live/systemd/cosmos-restore-drill.timer',
  appCredentialDropin: 'ops/templates/i00/systemd/cosmos-app-i00.conf.template',
  secretsProviderService: 'ops/templates/i00/systemd/cosmos-secrets-provider.service.template',
  common: 'ops/live/bin/common.sh',
  watchdog: 'ops/live/bin/watchdog.sh',
  backup: 'ops/live/bin/backup.sh',
  restore: 'ops/live/bin/restore.sh',
  restoreDrill: 'ops/live/bin/restore-drill.sh',
  rollback: 'ops/live/bin/rollback.sh',
  cloudflare: 'ops/live/cloudflare/cloudflared-config.yml.template',
  accessApp: 'ops/live/cloudflare/access-app.json.template',
  donorIam: 'ops/live/aws/iam-secrets-policy.json.template',
  i00Iam: 'ops/templates/i00/aws/iam-secrets-exact-policy.json.template',
  secretsProvider: 'ops/i00/bin/secrets-provider.mjs',
  amendment: EXPECTED_AMENDMENT_PATH,
});

export function loadOwnerArtifacts() {
  return Object.fromEntries(Object.entries(OWNER_PATHS).map(([key, repoPath]) => [key, readFileSync(join(REPO_ROOT, repoPath), 'utf8')]));
}

function requireText(issues, text, required, code, path) {
  if (!text.includes(required)) issue(issues, code, path, `required text missing: ${required}`);
}

function validateIamPolicy(issues, raw, path, expectedResource) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    issue(issues, 'IAM_JSON_INVALID', path, 'IAM template must parse as JSON');
    return;
  }
  const document = parsed.PolicyDocument ?? parsed;
  const statements = document.Statement;
  if (!Array.isArray(statements) || statements.length !== 1) {
    issue(issues, 'IAM_SINGLE_STATEMENT_REQUIRED', path, 'one exact allow statement is required');
    return;
  }
  const statement = statements[0];
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  if (actions.length !== 1 || actions[0] !== 'secretsmanager:GetSecretValue') {
    issue(issues, 'IAM_ACTION_TOO_BROAD', path, 'only GetSecretValue is allowed');
  }
  if (statement.Resource !== expectedResource || String(statement.Resource).includes('*')) {
    issue(issues, 'IAM_RESOURCE_NOT_EXACT_PLACEHOLDER', path, 'resource must be one exact unresolved secret ARN placeholder');
  }
  if (statement.Effect !== 'Allow') issue(issues, 'IAM_EFFECT_INVALID', path, 'effect must be Allow');
}

export function validateOwnerArtifacts(artifacts) {
  const issues = [];
  const services = [
    ['appService', artifacts.appService],
    ['tunnelService', artifacts.tunnelService],
    ['watchdogService', artifacts.watchdogService],
    ['backupService', artifacts.backupService],
    ['restoreDrillService', artifacts.restoreDrillService],
  ];
  for (const [name, text] of services) {
    requireText(issues, text, '[Unit]', 'SYSTEMD_UNIT_SECTION_MISSING', name);
    requireText(issues, text, '[Service]', 'SYSTEMD_SERVICE_SECTION_MISSING', name);
    requireText(issues, text, 'NoNewPrivileges=yes', 'SYSTEMD_NO_NEW_PRIVILEGES_MISSING', name);
    requireText(issues, text, 'ProtectSystem=strict', 'SYSTEMD_PROTECT_SYSTEM_MISSING', name);
    if (/^Environment=.*(?:TOKEN|SECRET|PASSWORD|API_KEY)=/mu.test(text)) {
      issue(issues, 'SYSTEMD_INLINE_SECRET_FORBIDDEN', name, 'unit contains a sensitive inline environment assignment');
    }
    if (text.includes('0.0.0.0')) issue(issues, 'SYSTEMD_PUBLIC_BIND_FORBIDDEN', name, 'unit may not bind publicly');
  }
  requireText(issues, artifacts.appService, 'User=cosmos', 'APP_NON_ROOT_USER_MISSING', 'appService');
  requireText(issues, artifacts.appService, 'EnvironmentFile=/etc/cosmos/cosmos-app.env', 'APP_ENV_FILE_FAIL_CLOSED_MISSING', 'appService');
  requireText(issues, artifacts.appService, 'RuntimeDirectory=cosmos-app', 'APP_LEASE_RUNTIME_MISSING', 'appService');
  requireText(issues, artifacts.appService, 'RuntimeDirectoryMode=0700', 'APP_LEASE_RUNTIME_MODE_INVALID', 'appService');
  requireText(issues, artifacts.appService, 'RuntimeDirectoryPreserve=restart', 'APP_LEASE_RUNTIME_RESTART_PRESERVE_MISSING', 'appService');
  requireText(
    issues,
    artifacts.appService,
    'UnsetEnvironment=NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_ICU_DATA NODE_V8_COVERAGE NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN',
    'APP_RUNTIME_INJECTION_ENV_UNSET_MISSING',
    'appService',
  );
  requireText(
    issues,
    artifacts.appService,
    'UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR',
    'APP_LOADER_INJECTION_ENV_UNSET_MISSING',
    'appService',
  );
  requireText(
    issues,
    artifacts.appService,
    'UnsetEnvironment=NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy',
    'APP_NETWORK_ENV_UNSET_MISSING',
    'appService',
  );
  const expectedAppExecStart = 'ExecStart=/usr/bin/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases /usr/bin/node server/dist/index.js';
  const appExecStarts = artifacts.appService.match(/^ExecStart=.*$/gmu) ?? [];
  if (appExecStarts.length !== 1 || appExecStarts[0] !== expectedAppExecStart) {
    issue(
      issues,
      'APP_LOGICAL_LEASE_ROOT_EXEC_PIN_MISSING',
      'appService',
      'one exact ExecStart must pin the logical lease root after EnvironmentFile precedence',
    );
  }
  if (/^Environment=DATA_DIR_LOGICAL_LEASE_ROOT=/mu.test(artifacts.appService)) {
    issue(
      issues,
      'APP_LOGICAL_LEASE_ROOT_OVERRIDEABLE',
      'appService',
      'EnvironmentFile overrides Environment; pin the lease root in ExecStart argv',
    );
  }
  if (/^\s*PrivatePIDs\s*=/mu.test(artifacts.appService)) {
    issue(
      issues,
      'APP_PID_LIVENESS_NAMESPACE_UNSUPPORTED',
      'appService',
      'PrivatePIDs is unsupported; cooperating lease processes must share one PID liveness namespace',
    );
  }
  requireText(issues, artifacts.appService, 'Restart=on-failure', 'APP_RESTART_POLICY_MISSING', 'appService');
  requireText(issues, artifacts.appService, 'StartLimitIntervalSec=', 'APP_RESTART_LIMIT_MISSING', 'appService');
  requireText(issues, artifacts.tunnelService, '--no-autoupdate', 'TUNNEL_AUTOUPDATE_NOT_DISABLED', 'tunnelService');
  requireText(issues, artifacts.tunnelService, 'User=cloudflared', 'TUNNEL_NON_ROOT_USER_MISSING', 'tunnelService');
  requireText(issues, artifacts.watchdogService, '/usr/local/lib/cosmos-ops/bin/watchdog.sh', 'WATCHDOG_OUTSIDE_RELEASE_PATH_REQUIRED', 'watchdogService');
  requireText(issues, artifacts.backupService, '/usr/local/lib/cosmos-ops/bin/backup.sh', 'BACKUP_OUTSIDE_RELEASE_PATH_REQUIRED', 'backupService');
  requireText(issues, artifacts.restoreDrillService, '/usr/local/lib/cosmos-ops/bin/restore-drill.sh', 'RESTORE_DRILL_OUTSIDE_RELEASE_PATH_REQUIRED', 'restoreDrillService');
  requireText(issues, artifacts.watchdogTimer, 'OnUnitActiveSec=1min', 'WATCHDOG_TIMER_CADENCE_INVALID', 'watchdogTimer');
  requireText(issues, artifacts.backupTimer, 'OnCalendar=hourly', 'BACKUP_TIMER_CADENCE_INVALID', 'backupTimer');
  requireText(issues, artifacts.backupTimer, 'Persistent=true', 'BACKUP_TIMER_PERSISTENCE_MISSING', 'backupTimer');
  requireText(issues, artifacts.restoreDrillTimer, 'OnCalendar=weekly', 'RESTORE_TIMER_CADENCE_INVALID', 'restoreDrillTimer');
  requireText(issues, artifacts.appCredentialDropin, 'Requires=cosmos-secrets-provider.service', 'SECRET_PROVIDER_REQUIREMENT_MISSING', 'appCredentialDropin');
  requireText(issues, artifacts.appCredentialDropin, 'LoadCredential=app-secrets:/run/cosmos-secret-source/app-secrets.json', 'ABSOLUTE_LOAD_CREDENTIAL_MISSING', 'appCredentialDropin');
  requireText(issues, artifacts.secretsProviderService, 'Environment=AWS_EC2_METADATA_DISABLED=false', 'PRODUCTION_IMDS_ROLE_CHAIN_DISABLED', 'secretsProviderService');
  for (const forbidden of ['AWS_ACCESS_KEY_ID=', 'AWS_SECRET_ACCESS_KEY=', 'AWS_SESSION_TOKEN=', 'AWS_PROFILE=']) {
    if (artifacts.secretsProviderService.includes(forbidden)) issue(issues, 'STATIC_AWS_CREDENTIAL_FORBIDDEN', 'secretsProviderService', forbidden);
  }

  requireText(issues, artifacts.common, 'classify_lock_family()', 'LOCK_FAMILY_CLASSIFIER_MISSING', 'common');
  requireText(issues, artifacts.common, '_lock_owner_tool claim', 'LOCK_GENERATION_CLAIM_MISSING', 'common');
  requireText(issues, artifacts.common, 'refusing to release lock not owned by this exact process generation', 'LOCK_GENERATION_RELEASE_GUARD_MISSING', 'common');
  requireText(issues, artifacts.watchdog, 'classify_lock_family "$DEPLOY_LOCK"', 'WATCHDOG_LOCK_CLASSIFICATION_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'LIVE|INITIALIZING)', 'WATCHDOG_LIVE_LOCK_STANDDOWN_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'DEAD|STALE|MALFORMED)', 'WATCHDOG_RECLAIMABLE_LOCK_PATH_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'DEPLOY_LOCK_UNVERIFIED', 'WATCHDOG_UNVERIFIED_LOCK_ALARM_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'wd_alert critical RESTART_BUDGET_EXHAUSTED', 'WATCHDOG_RESTART_BUDGET_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'process alive but $READY_PATH failing; NOT restarting', 'WATCHDOG_READINESS_ALERT_ONLY_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'BACKUP_STALE', 'WATCHDOG_BACKUP_STALENESS_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'DEPLOY_FROZEN', 'WATCHDOG_FREEZE_ALARM_MISSING', 'watchdog');

  requireText(issues, artifacts.backup, '"$SQLITE" "$DB" ".backup', 'SQLITE_ONLINE_BACKUP_REQUIRED', 'backup');
  requireText(issues, artifacts.backup, 'PRAGMA integrity_check;', 'BACKUP_INTEGRITY_CHECK_MISSING', 'backup');
  requireText(issues, artifacts.backup, '.partial-', 'BACKUP_PARTIAL_PUBLICATION_MISSING', 'backup');
  requireText(issues, artifacts.backup, 'renameSync', 'BACKUP_ATOMIC_PUBLICATION_MISSING', 'backup');
  if (/\bcp\s+"?\$DB"?/u.test(artifacts.backup)) issue(issues, 'RAW_LIVE_DATABASE_COPY_FORBIDDEN', 'backup', 'live DB must use SQLite online backup');

  for (const required of [
    '--allow-production',
    '[ "${RESTORE_CONFIRM:-}" = "RESTORE_PRODUCTION" ]',
    '"$SYSTEMCTL" is-active "$APP_UNIT"',
    'constants.O_NOFOLLOW',
    'sha256 does not match manifest',
    'assertExactProof',
    "const publications = [[dbStage, 'cosmos.db']]",
    "publications.push([reportStage, 'restore-report.json'])",
    'RESTORE ROLLBACK INCOMPLETE',
    'PRAGMA integrity_check;',
    'cosmos.db-wal',
    'cosmos.db-shm',
  ]) requireText(issues, artifacts.restore, required, 'RESTORE_GUARD_MISSING', 'restore');
  requireText(issues, artifacts.restoreDrill, 'DRILL_TARGET_NOT_ISOLATED', 'RESTORE_DRILL_ISOLATION_MISSING', 'restoreDrill');
  requireText(issues, artifacts.restoreDrill, 'DRILL_FAILED', 'RESTORE_DRILL_FAILURE_NOT_LOUD', 'restoreDrill');

  requireText(issues, artifacts.rollback, 'rollbackFloor', 'ROLLBACK_SCHEMA_FLOOR_MISSING', 'rollback');
  requireText(issues, artifacts.rollback, 'if [ -e "$MONEY_READY_MARKER" ]', 'ROLLBACK_MONEY_MARKER_GATE_MISSING', 'rollback');
  if (artifacts.rollback.split('if [ "$EXPOSURE" != "NONE" ]').length - 1 !== 2) {
    issue(issues, 'ROLLBACK_EXPOSURE_GATE_MISSING', 'rollback', 'automatic and manual rollback paths must both gate non-NONE exposure');
  }
  requireText(issues, artifacts.rollback, 'atomic_symlink "$TARGET_DIR" "$CURRENT_LINK"', 'ROLLBACK_ATOMIC_SWITCH_MISSING', 'rollback');

  requireText(issues, artifacts.cloudflare, 'tunnel: REPLACE_ME_TUNNEL_UUID', 'CLOUDFLARE_TUNNEL_PLACEHOLDER_MISSING', 'cloudflare');
  requireText(issues, artifacts.cloudflare, 'hostname: REPLACE_ME_APP_HOSTNAME', 'CLOUDFLARE_HOST_PLACEHOLDER_MISSING', 'cloudflare');
  requireText(issues, artifacts.cloudflare, 'service: http://127.0.0.1:8080', 'CLOUDFLARE_LOOPBACK_ORIGIN_REQUIRED', 'cloudflare');
  if (artifacts.cloudflare.includes('0.0.0.0')) issue(issues, 'CLOUDFLARE_PUBLIC_ORIGIN_FORBIDDEN', 'cloudflare', 'origin must be numeric loopback');
  if (/\b(?:token|token-file):/u.test(artifacts.cloudflare) || artifacts.cloudflare.includes('cert.pem')) {
    issue(issues, 'CLOUDFLARE_BROAD_CREDENTIAL_FORBIDDEN', 'cloudflare', 'local tunnel template must not embed token or account certificate');
  }
  const serviceLines = artifacts.cloudflare.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.startsWith('service:') || line.startsWith('- service:'));
  if (serviceLines.at(-1) !== '- service: http_status:404') {
    issue(issues, 'CLOUDFLARE_TERMINAL_404_REQUIRED', 'cloudflare', 'last ingress service must be the catch-all 404');
  }
  let access;
  try { access = JSON.parse(artifacts.accessApp); } catch { issue(issues, 'ACCESS_APP_JSON_INVALID', 'accessApp', 'Access template must parse'); }
  if (access) {
    if (access.application?.domain !== 'REPLACE_ME_APP_HOSTNAME') issue(issues, 'ACCESS_HOST_PLACEHOLDER_REQUIRED', 'accessApp', 'domain must remain unresolved');
    if (access.policies?.length !== 1 || access.policies[0]?.decision !== 'allow') issue(issues, 'ACCESS_OPERATOR_POLICY_INVALID', 'accessApp', 'one explicit operator allow policy is required');
    if (access.policies?.[0]?.include?.[0]?.email?.email !== 'REPLACE_ME_OPERATOR_EMAIL') issue(issues, 'ACCESS_OPERATOR_PLACEHOLDER_REQUIRED', 'accessApp', 'operator must remain a placeholder');
  }

  validateIamPolicy(issues, artifacts.donorIam, 'donorIam', 'REPLACE_ME_SECRET_ARN');
  validateIamPolicy(issues, artifacts.i00Iam, 'i00Iam', 'REPLACE_ME_EXACT_SECRET_ARN_WITH_SIX_CHARACTER_SUFFIX');
  for (const required of [
    "'--version-stage', 'AWSCURRENT'",
    "'AWS_ACCESS_KEY_ID'",
    "'AWS_SECRET_ACCESS_KEY'",
    "'AWS_SESSION_TOKEN'",
    "'AWS_PROFILE'",
    'AWS_CLI provider command is not configured',
    'mode: 0o600',
    'SECRET_MATERIALIZED_WITHOUT_DISCLOSURE',
  ]) requireText(issues, artifacts.secretsProvider, required, 'SECRETS_PROVIDER_FAIL_CLOSED_GUARD_MISSING', 'secretsProvider');
  let amendment;
  try { amendment = JSON.parse(artifacts.amendment); } catch { issue(issues, 'AMENDMENT_JSON_INVALID', 'amendment', 'amendment contract must parse'); }
  if (sha256(artifacts.amendment) !== EXPECTED_AMENDMENT_SHA256) {
    issue(issues, 'AMENDMENT_BYTES_INVALID', 'amendment', 'amendment contract bytes must be exact');
  }
  if (amendment) {
    const findings = amendment.amendments?.map((entry) => entry.findingId);
    if (JSON.stringify(findings) !== JSON.stringify(['R3-D-WATCHDOG-007', 'R3-D-BACKUP-008'])) {
      issue(issues, 'AMENDMENT_ORDER_INVALID', 'amendment', 'WATCHDOG-007 must precede BACKUP-008');
    }
    if (amendment.immutableDonor?.acceptedCommit !== EXPECTED_DONOR_SHA
        || amendment.immutableDonor?.acceptedLiveTree !== EXPECTED_DONOR_OPS_LIVE_TREE
        || amendment.effectiveLive?.tree !== EXPECTED_OPS_LIVE_TREE
        || amendment.effectiveLive?.rootDigestSha256 !== EXPECTED_EFFECTIVE_ROOT_SHA256) {
      issue(issues, 'AMENDMENT_LINEAGE_INVALID', 'amendment', 'donor and effective lineage must be exact');
    }
  }
  return issues;
}

export function validateInsertionRequests(value) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, 'INSERTION_REQUEST_OBJECT_REQUIRED', '$', 'insertion requests must be an object');
    return issues;
  }
  if (value.schema !== 'PORT_OPS_INSERTION_REQUESTS_V1') issue(issues, 'INSERTION_SCHEMA_INVALID', '$.schema', 'schema must be exact');
  if (value.packet !== 'RUN-16-PORT' || value.phase !== 'POST_LANDING_PRESTAGE') issue(issues, 'INSERTION_PACKET_POSTURE_INVALID', '$', 'packet and port posture must be exact');
  if (value.authorityEffect !== 'NONE' || value.requestsApplied !== false || value.directSharedEditsPerformed !== false) {
    issue(issues, 'INSERTION_AUTHORITY_FORBIDDEN', '$', 'rows must grant no authority, remain unapplied, and make no shared edit');
  }
  const authority = value.registryAuthority ?? {};
  if (authority.branch !== 'aiops-prestage-20260714'
      || authority.commit !== EXPECTED_REGISTRY_SHA
      || authority.path !== 'AI_OPS_COLLISION_MAP.md'
      || authority.gitBlob !== EXPECTED_REGISTRY_BLOB
      || authority.rowSchema !== 'InsertionRequestRowV1'
      || authority.landedSchemaPath !== 'fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json'
      || authority.landedSchemaGitBlob !== EXPECTED_AGENT_BOUNDARY_BLOB
      || authority.landedSchemaSha256 !== EXPECTED_AGENT_BOUNDARY_SHA256) {
    issue(issues, 'INSERTION_REGISTRY_BINDING_INVALID', '$.registryAuthority', 'AIOPS registry and landed schema bindings must be exact');
  }
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const ids = rows.map((row) => row?.rowId);
  if (!sameStringSet(ids, EXPECTED_INSERTION_REQUEST_IDS)) issue(issues, 'INSERTION_REQUEST_SET_INVALID', '$.rows', 'exact registry row set is required');
  if (new Set(ids).size !== ids.length) issue(issues, 'DUPLICATE_INSERTION_REQUEST', '$.rows', 'row IDs must be unique');
  const expectedKeys = [
    'schema', 'version', 'rowId', 'status', 'requestedOwner', 'targetSeam', 'reason',
    'contract', 'tests', 'expectedBehavior', 'wiringState', 'authorityCreated',
  ];
  let pinnedRows = [];
  try {
    pinnedRows = loadPinnedInsertionRequestRows();
  } catch (error) {
    issue(issues, 'INSERTION_REGISTRY_READ_FAILED', '$.registryAuthority', error.message);
  }
  const pinnedRowsById = new Map(pinnedRows.map((row) => [row.rowId, row]));
  for (const [index, row] of rows.entries()) {
    const path = `$.rows[${index}]`;
    if (!sameStringSet(Object.keys(row ?? {}), expectedKeys)) issue(issues, 'INSERTION_ROW_SHAPE_INVALID', path, 'row must use only the authoritative typed schema fields');
    if (row?.schema !== 'InsertionRequestRowV1' || row?.version !== 1 || row?.status !== 'DRAFT') {
      issue(issues, 'INSERTION_REQUEST_STATUS_INVALID', path, 'row schema, version, and draft status must be exact');
    }
    if (typeof row?.requestedOwner !== 'string' || row.requestedOwner.length < 8 || /PORT[-_]OPS|OPS_SHADOW/u.test(row.requestedOwner)) {
      issue(issues, 'INSERTION_TARGET_OWNER_INVALID', `${path}.requestedOwner`, 'target must be an external canonical or explicitly missing owner');
    }
    if (typeof row?.targetSeam !== 'string' || row.targetSeam.length < 12 || typeof row?.reason !== 'string' || row.reason.length < 20) {
      issue(issues, 'INSERTION_REQUEST_INCOMPLETE', path, 'target seam and reason must be precise');
    }
    for (const field of ['contract', 'tests', 'expectedBehavior']) {
      if (!Array.isArray(row?.[field]) || row[field].length === 0
          || row[field].some((entry) => typeof entry !== 'string' || entry.length < 12)) {
        issue(issues, 'INSERTION_EVIDENCE_INCOMPLETE', `${path}.${field}`, `${field} must contain concrete typed evidence`);
      }
    }
    if (row?.wiringState !== `PENDING_BACKEND:${row?.rowId}` || row?.authorityCreated !== false) {
      issue(issues, 'INSERTION_WIRING_STATE_INVALID', path, 'wiring state must bind the literal row ID and create no authority');
    }
    const pinned = pinnedRowsById.get(row?.rowId);
    if (!pinned) {
      issue(issues, 'INSERTION_ROW_NOT_IN_PINNED_REGISTRY', path, 'row must exist in the pinned immutable registry');
    } else {
      for (const field of expectedKeys) {
        if (JSON.stringify(row?.[field]) !== JSON.stringify(pinned[field])) {
          issue(issues, 'INSERTION_ROW_REGISTRY_VALUE_MISMATCH', `${path}.${field}`, `${field} must be byte-semantically exact to the pinned registry row`);
        }
      }
    }
  }
  const dispositions = Array.isArray(value.sourceRequestDispositions) ? value.sourceRequestDispositions : [];
  const expectedSources = [
    'OPS-SHADOW-IR-RESTORE-001',
    'OPS-SHADOW-IR-SYSTEMD-002',
    'OPS-SHADOW-IR-CLOUDFLARE-003',
    'OPS-SHADOW-IR-WATCHDOG-004',
    'OPS-SHADOW-IR-OWNER-INPUTS-005',
    'PORT-OPS-ROOT-TEST-MOUNT',
  ];
  if (!sameStringSet(dispositions.map((entry) => entry?.sourceId), expectedSources)) {
    issue(issues, 'SOURCE_DISPOSITION_SET_INVALID', '$.sourceRequestDispositions', 'every shadow request plus the root test mount must be dispositioned');
  }
  for (const [index, disposition] of dispositions.entries()) {
    const path = `$.sourceRequestDispositions[${index}]`;
    const expectedDisposition = EXPECTED_SOURCE_DISPOSITIONS.get(disposition?.sourceId);
    if (!expectedDisposition
        || disposition?.disposition !== expectedDisposition[0]
        || JSON.stringify(disposition?.registryRowIds) !== JSON.stringify(expectedDisposition[1])) {
      issue(issues, 'SOURCE_DISPOSITION_RULING_MISMATCH', path, 'source disposition and ordered registry row mapping must be exact');
    }
    if (!Array.isArray(disposition?.registryRowIds) || disposition.registryRowIds.length === 0
        || disposition.registryRowIds.some((rowId) => !EXPECTED_INSERTION_REQUEST_IDS.includes(rowId))) {
      issue(issues, 'SOURCE_DISPOSITION_REGISTRY_ROW_INVALID', `${path}.registryRowIds`, 'disposition must bind known registry rows');
    }
    if (!Array.isArray(disposition?.evidence) || disposition.evidence.length === 0
        || typeof disposition?.remainingNeed !== 'string' || disposition.remainingNeed.length < 30) {
      issue(issues, 'SOURCE_DISPOSITION_EVIDENCE_INCOMPLETE', path, 'dedup evidence and remaining need must be explicit');
    }
  }
  return issues;
}

function isHex(value, length) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'u').test(value);
}

export function validateHistoricalSourceReceipt(value) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, 'SOURCE_RECEIPT_OBJECT_REQUIRED', '$', 'historical source receipt must be an object');
    return issues;
  }
  if (value.schema !== 'OPS_SHADOW_RECEIPT_V1' || value.packet !== 'RUN-16' || value.task !== 'OPS-SHADOW'
      || value.shadowStatus !== 'SHADOW_SPECULATIVE' || value.terminalState !== 'OPS_SHADOW_READY') {
    issue(issues, 'SOURCE_RECEIPT_POSTURE_INVALID', '$', 'historical shadow posture must remain exact');
  }
  for (const field of [
    'acceptanceClaimed',
    'prestageReadyClaimed',
    'integratedAcceptedClaimed',
    'authorityGranted',
    'deploymentPerformed',
    'networkMutationPerformed',
    'credentialMutationPerformed',
    'moneyMutationPerformed',
    'mergePerformed',
    'pushPerformed',
  ]) {
    if (value[field] !== false) issue(issues, 'SOURCE_RECEIPT_ACCEPTANCE_TRANSFER_FORBIDDEN', `$.${field}`, `${field} must remain false`);
  }
  if (value.authorityEffect !== 'NONE'
      || value.baseSha !== EXPECTED_SOURCE_BASE_SHA
      || value.implementationBranch !== 'ops-shadow-20260715'
      || value.implementationCommitSha !== EXPECTED_SOURCE_IMPLEMENTATION_SHA
      || value.implementationTreeSha !== EXPECTED_SOURCE_IMPLEMENTATION_TREE
      || value.receiptSealCommit !== 'ENCLOSING_COMMIT_NOT_SELF_REFERENTIAL'
      || value.receiptPath !== SOURCE_RECEIPT_PATH) {
    issue(issues, 'SOURCE_RECEIPT_LINEAGE_INVALID', '$', 'historical receipt lineage and no-authority posture must be exact');
  }
  return issues;
}

export function validateHistoricalSourceReceiptBytes() {
  const issues = [];
  try {
    const workingBytes = readFileSync(join(REPO_ROOT, SOURCE_RECEIPT_PATH));
    const sealedBytes = runGit(['show', `${EXPECTED_SOURCE_SEAL_SHA}:${SOURCE_RECEIPT_PATH}`], { binary: true }).stdout;
    if (!workingBytes.equals(sealedBytes)) issue(issues, 'SOURCE_RECEIPT_BYTES_MISMATCH', SOURCE_RECEIPT_PATH, 'ported historical receipt must be byte-identical to its source seal');
    if (sha256(workingBytes) !== EXPECTED_SOURCE_RECEIPT_SHA256) issue(issues, 'SOURCE_RECEIPT_SHA256_MISMATCH', SOURCE_RECEIPT_PATH, 'historical receipt SHA-256 must be exact');
    if (gitText('rev-parse', `${EXPECTED_SOURCE_SEAL_SHA}:${SOURCE_RECEIPT_PATH}`) !== EXPECTED_SOURCE_RECEIPT_BLOB) {
      issue(issues, 'SOURCE_RECEIPT_BLOB_MISMATCH', SOURCE_RECEIPT_PATH, 'historical receipt blob must be exact');
    }
  } catch (error) {
    issue(issues, 'SOURCE_RECEIPT_PROOF_FAILED', SOURCE_RECEIPT_PATH, error.message);
  }
  return issues;
}

export function validatePortReceiptShape(value) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, 'RECEIPT_OBJECT_REQUIRED', '$', 'port receipt must be an object');
    return issues;
  }
  if (value.schema !== 'PORT_OPS_PRESTAGE_RECEIPT_V1'
      || value.packet !== 'RUN-16-PORT'
      || value.phase !== 'POST_LANDING_PRESTAGE'
      || value.terminalState !== 'PORT_OPS_PRESTAGE_READY'
      || value.laneAcceptance !== 'PASS'
      || value.prestageReady !== true
      || value.prestageOnly !== true) {
    issue(issues, 'RECEIPT_POSTURE_INVALID', '$', 'real lane acceptance and prestage posture must be exact');
  }
  for (const field of [
    'integratedAcceptedClaimed',
    'authorityGranted',
    'deploymentPerformed',
    'networkMutationPerformed',
    'credentialMutationPerformed',
    'moneyMutationPerformed',
    'mergePerformed',
    'pushPerformed',
  ]) {
    if (value[field] !== false) issue(issues, 'RECEIPT_FORBIDDEN_AFFIRMATIVE_CLAIM', `$.${field}`, `${field} must be false`);
  }
  if (value.authorityEffect !== 'NONE') issue(issues, 'RECEIPT_AUTHORITY_EFFECT_FORBIDDEN', '$.authorityEffect', 'authority effect must be NONE');
  if (value.baseSha !== EXPECTED_BASE_SHA || value.implementationBranch !== EXPECTED_BRANCH) issue(issues, 'RECEIPT_BASE_OR_BRANCH_MISMATCH', '$', 'base and branch must be exact');
  if (value.launchAuthority?.decision !== 'D-LAUNCH-51'
      || value.launchAuthority?.decisionCommit !== 'e619ff18ef159c27061cfaf318036e18a4fac131'
      || value.launchAuthority?.landedBaseDecision !== 'D-LAUNCH-50'
      || value.launchAuthority?.landedBase !== EXPECTED_BASE_SHA) {
    issue(issues, 'RECEIPT_LAUNCH_AUTHORITY_MISMATCH', '$.launchAuthority', 'receipt must bind D-LAUNCH-51 and the exact landed base');
  }
  if (value.registryAuthority?.commit !== EXPECTED_REGISTRY_SHA
      || value.registryAuthority?.gitBlob !== EXPECTED_REGISTRY_BLOB
      || value.registryAuthority?.rowSchema !== 'InsertionRequestRowV1'
      || value.registryAuthority?.landedSchemaGitBlob !== EXPECTED_AGENT_BOUNDARY_BLOB
      || value.registryAuthority?.landedSchemaSha256 !== EXPECTED_AGENT_BOUNDARY_SHA256) {
    issue(issues, 'RECEIPT_REGISTRY_AUTHORITY_MISMATCH', '$.registryAuthority', 'receipt must bind the immutable insertion registry and landed row schema');
  }
  if (!isHex(value.implementationCommitSha, 40) || !isHex(value.implementationTreeSha, 40)) issue(issues, 'RECEIPT_IMPLEMENTATION_ID_INVALID', '$', 'implementation commit and tree must be full SHA-1 values');
  if (value.receiptSealCommit !== 'ENCLOSING_COMMIT_NOT_SELF_REFERENTIAL') issue(issues, 'RECEIPT_SELF_REFERENCE_INVALID', '$.receiptSealCommit', 'receipt must state the non-self-referential seal law');
  if (value.receiptPath !== PORT_RECEIPT_PATH) issue(issues, 'RECEIPT_PATH_INVALID', '$.receiptPath', 'receipt path must be exact');
  const source = value.sourceShadow ?? {};
  if (source.status !== 'SHADOW_SPECULATIVE' || source.acceptanceTransferred !== false
      || source.sealCommit !== EXPECTED_SOURCE_SEAL_SHA || source.receiptPath !== SOURCE_RECEIPT_PATH
      || source.receiptBlob !== EXPECTED_SOURCE_RECEIPT_BLOB || source.receiptSha256 !== EXPECTED_SOURCE_RECEIPT_SHA256
      || source.use !== 'HISTORICAL_PROVENANCE_ONLY') {
    issue(issues, 'RECEIPT_SOURCE_SHADOW_INVALID', '$.sourceShadow', 'source shadow must remain historical and non-transferring');
  }
  const owner = value.operationalOwner ?? {};
  if (owner.immutableDonorCommit !== EXPECTED_DONOR_SHA
      || owner.acceptedOpsLiveTree !== EXPECTED_DONOR_OPS_LIVE_TREE
      || owner.amendmentContractBlob !== EXPECTED_AMENDMENT_BLOB
      || owner.effectiveOpsLiveTree !== EXPECTED_OPS_LIVE_TREE
      || owner.effectiveRootDigestSha256 !== EXPECTED_EFFECTIVE_ROOT_SHA256) {
    issue(issues, 'RECEIPT_OWNER_BINDING_MISMATCH', '$.operationalOwner', 'receipt must bind immutable donor plus authorized corrections');
  }
  if (!sameStringSet(value.scope?.exclusivePathRoots, EXCLUSIVE_ROOTS)) issue(issues, 'RECEIPT_EXCLUSIVE_ROOTS_INVALID', '$.scope.exclusivePathRoots', 'exclusive roots must be exact');
  const changed = Array.isArray(value.scope?.implementationChangedPaths) ? value.scope.implementationChangedPaths : [];
  if (value.scope?.implementationChangedPathCount !== changed.length || changed.length === 0) issue(issues, 'RECEIPT_CHANGED_PATH_COUNT_INVALID', '$.scope', 'changed path count must be exact and nonzero');
  const paths = changed.map((entry) => entry?.path);
  if (new Set(paths).size !== paths.length) issue(issues, 'RECEIPT_DUPLICATE_CHANGED_PATH', '$.scope.implementationChangedPaths', 'changed paths must be unique');
  if ([...paths].sort().some((path, index) => path !== paths[index])) issue(issues, 'RECEIPT_CHANGED_PATHS_NOT_SORTED', '$.scope.implementationChangedPaths', 'changed paths must be sorted');
  if (!sameStringSet(paths, EXPECTED_IMPLEMENTATION_PATHS)) issue(issues, 'RECEIPT_IMPLEMENTATION_PATH_SET_INVALID', '$.scope.implementationChangedPaths', 'receipt must bind exactly the ten authorized implementation paths');
  for (const [index, entry] of changed.entries()) {
    const path = `$.scope.implementationChangedPaths[${index}]`;
    if (!isExclusivePath(entry?.path) || entry?.path === PORT_RECEIPT_PATH) issue(issues, 'RECEIPT_IMPLEMENTATION_PATH_INVALID', `${path}.path`, 'implementation path must be exclusive and exclude the later receipt');
    if (!isHex(entry?.gitBlob, 40) || !isHex(entry?.sha256, 64)) issue(issues, 'RECEIPT_PATH_DIGEST_INVALID', path, 'blob and SHA-256 must be full values');
  }
  const tests = Array.isArray(value.tests) ? value.tests : [];
  if (tests.length !== FOCUSED_COMMAND_SPECS.length) issue(issues, 'RECEIPT_TEST_EVIDENCE_INCOMPLETE', '$.tests', 'the entire focused acceptance loop must be recorded');
  const actualTestKeys = tests.map((entry) => `${entry?.category}\0${entry?.command}`);
  const expectedTestKeys = FOCUSED_COMMAND_SPECS.map((entry) => `${entry.category}\0${entry.commandText}`);
  if (actualTestKeys.length !== expectedTestKeys.length
      || actualTestKeys.some((key, index) => key !== expectedTestKeys[index])) {
    issue(issues, 'RECEIPT_TEST_COMMAND_SET_INVALID', '$.tests', 'receipt must bind the exact ordered focused command set');
  }
  for (const [index, testEvidence] of tests.entries()) {
    const path = `$.tests[${index}]`;
    if (typeof testEvidence?.command !== 'string' || testEvidence.command.length < 3) issue(issues, 'RECEIPT_TEST_COMMAND_INVALID', `${path}.command`, 'test command is required');
    if (testEvidence?.evidenceKind !== FOCUSED_COMMAND_SPECS[index]?.evidenceKind) issue(issues, 'RECEIPT_TEST_BOUNDARY_INVALID', `${path}.evidenceKind`, 'test boundary classification must be exact');
    if (testEvidence?.outcome !== 'PASS' || testEvidence?.exitCode !== 0 || testEvidence?.signal !== null
        || !Number.isInteger(testEvidence?.positiveProofCount) || testEvidence.positiveProofCount < 1) {
      issue(issues, 'RECEIPT_TEST_NOT_GREEN', path, 'only measured, signalless focused passes with positive proof counts may be recorded');
    }
    if (testEvidence?.testedCommitSha !== value.implementationCommitSha
        || testEvidence?.testedTreeSha !== value.implementationTreeSha
        || testEvidence?.worktreeState !== 'CLEAN_EXACT_IMPLEMENTATION_COMMIT') {
      issue(issues, 'RECEIPT_TEST_CONTEXT_MISMATCH', path, 'focused evidence must bind the clean exact implementation commit and tree');
    }
    if (!isHex(testEvidence?.stdoutSha256, 64) || !isHex(testEvidence?.stderrSha256, 64)) issue(issues, 'RECEIPT_TEST_OUTPUT_DIGEST_INVALID', path, 'test output hashes must be exact');
  }
  const repositoryGates = Array.isArray(value.repositoryGates) ? value.repositoryGates : [];
  if (repositoryGates.length !== REPOSITORY_GATE_COMMANDS.length
      || repositoryGates.some((gate, index) => gate?.command !== REPOSITORY_GATE_COMMANDS[index])) {
    issue(issues, 'RECEIPT_REPOSITORY_GATE_SET_INVALID', '$.repositoryGates', 'npm test and npm run test:all must both be recorded in exact order');
  }
  for (const [index, repositoryGate] of repositoryGates.entries()) {
    const path = `$.repositoryGates[${index}]`;
    const passed = repositoryGate?.outcome === 'PASS'
      && repositoryGate?.exitCode === 0
      && repositoryGate?.signal === null
      && repositoryGate?.sharedBlocker === null;
    const exactSharedOwnerBlock = index === 1
      && repositoryGate?.outcome === 'BLOCKED_SHARED_OWNER'
      && repositoryGate?.exitCode === 1
      && repositoryGate?.signal === null
      && JSON.stringify(repositoryGate?.sharedBlocker) === JSON.stringify(EXPECTED_TEST_ALL_SHARED_BLOCKER);
    if ((index === 0 && !passed) || (index === 1 && !passed && !exactSharedOwnerBlock)) {
      issue(issues, 'RECEIPT_REPOSITORY_GATE_NOT_GREEN', path, 'npm test must pass; test:all must pass or carry the exact fixed-base shared-owner blocker without a broader-green claim');
    }
    if (repositoryGate?.testedCommitSha !== value.implementationCommitSha
        || repositoryGate?.testedTreeSha !== value.implementationTreeSha
        || repositoryGate?.worktreeState !== 'CLEAN_EXACT_IMPLEMENTATION_COMMIT') {
      issue(issues, 'RECEIPT_REPOSITORY_GATE_CONTEXT_MISMATCH', path, 'repository evidence must bind the clean exact implementation commit and tree');
    }
    if (!isHex(repositoryGate?.stdoutSha256, 64) || !isHex(repositoryGate?.stderrSha256, 64)) {
      issue(issues, 'RECEIPT_REPOSITORY_GATE_OUTPUT_DIGEST_INVALID', path, 'repository gate output hashes must be exact');
    }
    if (!Number.isInteger(repositoryGate?.stdoutBytes) || repositoryGate.stdoutBytes < 1
        || !Number.isInteger(repositoryGate?.stderrBytes) || repositoryGate.stderrBytes < 0) {
      issue(issues, 'RECEIPT_REPOSITORY_GATE_OUTPUT_SIZE_INVALID', path, 'repository gate output byte counts must be measured');
    }
  }
  const testAllBlocked = repositoryGates[1]?.outcome === 'BLOCKED_SHARED_OWNER';
  if (value.rootGateDisposition !== (testAllBlocked
    ? 'FOCUSED_LANE_GREEN_SHARED_ROOT_HANDOFF_REQUIRED'
    : 'ALL_REPOSITORY_GATES_GREEN')
      || value.broaderRootGreenClaimed !== !testAllBlocked) {
    issue(issues, 'RECEIPT_ROOT_GATE_DISPOSITION_INVALID', '$.rootGateDisposition', 'root gate disposition and broader-green claim must match the measured repository evidence');
  }
  const review = value.adversarialReview ?? {};
  const reviewChecks = Array.isArray(review.checks) ? review.checks : [];
  if (review.outcome !== 'PASS' || !sameStringSet(reviewChecks.map((entry) => entry?.id), EXPECTED_ADVERSARIAL_REVIEW_IDS)
      || new Set(reviewChecks.map((entry) => entry?.id)).size !== reviewChecks.length
      || reviewChecks.some((entry) => entry?.outcome !== 'PASS' || typeof entry?.evidence !== 'string' || entry.evidence.length < 20)) {
    issue(issues, 'RECEIPT_ADVERSARIAL_REVIEW_INVALID', '$.adversarialReview', 'the exact unique hostile review set must pass with concrete evidence');
  }
  if (!sameStringSet(value.insertionRequestIds, EXPECTED_INSERTION_REQUEST_IDS)) issue(issues, 'RECEIPT_INSERTION_REQUEST_SET_INVALID', '$.insertionRequestIds', 'receipt must bind every insertion request');
  const dedupEvidence = Array.isArray(value.dedupEvidence) ? value.dedupEvidence : [];
  if (!sameStringSet(dedupEvidence.map((entry) => entry?.id), [...EXPECTED_DEDUP_DISPOSITIONS.keys()])
      || new Set(dedupEvidence.map((entry) => entry?.id)).size !== dedupEvidence.length
      || dedupEvidence.some((entry) => entry?.disposition !== EXPECTED_DEDUP_DISPOSITIONS.get(entry?.id)
        || typeof entry?.evidence !== 'string' || entry.evidence.length < 20)) {
    issue(issues, 'RECEIPT_DEDUP_EVIDENCE_INCOMPLETE', '$.dedupEvidence', 'the exact unique dedup rulings must be recorded with concrete evidence');
  }
  const limitations = Array.isArray(value.limitations) ? value.limitations : [];
  if (!sameStringSet(limitations.map((entry) => entry?.id), EXPECTED_LIMITATION_IDS)
      || new Set(limitations.map((entry) => entry?.id)).size !== limitations.length
      || limitations.some((entry) => typeof entry?.statement !== 'string' || entry.statement.length < 30)) {
    issue(issues, 'RECEIPT_LIMITATIONS_INCOMPLETE', '$.limitations', 'the exact unique limitation categories must remain explicit');
  }
  return issues;
}

export const validateReceiptShape = validatePortReceiptShape;

export function validatePortReceiptGit(value, { sealedAt = null } = {}) {
  const issues = [];
  const work = value.implementationCommitSha;
  try {
    const workLineage = gitText('rev-list', '--parents', '-n', '1', work).split(/\s+/u);
    if (workLineage.length !== 2 || workLineage[0] !== work || workLineage[1] !== value.baseSha) {
      issue(issues, 'IMPLEMENTATION_PARENT_MISMATCH', '$.implementationCommitSha', `expected one parent ${value.baseSha}, got ${workLineage.slice(1).join(', ')}`);
    }
    const tree = gitText('rev-parse', `${work}^{tree}`);
    if (tree !== value.implementationTreeSha) issue(issues, 'IMPLEMENTATION_TREE_MISMATCH', '$.implementationTreeSha', `expected ${value.implementationTreeSha}, got ${tree}`);
    const implementationChanges = gitText(
      'diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', value.baseSha, work,
    ).split('\n').filter(Boolean).sort();
    const expectedImplementationChanges = EXPECTED_IMPLEMENTATION_PATHS.map((path) => `A\t${path}`).sort();
    if (JSON.stringify(implementationChanges) !== JSON.stringify(expectedImplementationChanges)) {
      issue(issues, 'IMPLEMENTATION_CHANGESET_INVALID', '$.scope.implementationChangedPaths', `actual ${implementationChanges.join(', ')}`);
    }
    const actualPaths = implementationChanges.map((row) => row.split('\t').at(-1)).sort();
    const receiptPaths = value.scope.implementationChangedPaths.map((entry) => entry.path).sort();
    if (!sameStringSet(actualPaths, receiptPaths)) issue(issues, 'IMPLEMENTATION_PATH_SET_MISMATCH', '$.scope.implementationChangedPaths', `actual ${actualPaths.join(', ')}`);
    for (const entry of value.scope.implementationChangedPaths) {
      const blob = gitText('rev-parse', `${work}:${entry.path}`);
      if (blob !== entry.gitBlob) issue(issues, 'IMPLEMENTATION_BLOB_MISMATCH', entry.path, `expected ${entry.gitBlob}, got ${blob}`);
      const bytes = runGit(['show', `${work}:${entry.path}`], { binary: true }).stdout;
      const digest = sha256(bytes);
      if (digest !== entry.sha256) issue(issues, 'IMPLEMENTATION_SHA256_MISMATCH', entry.path, `expected ${entry.sha256}, got ${digest}`);
    }
    const prematureReceipt = runGit(['cat-file', '-e', `${work}:${PORT_RECEIPT_PATH}`], { allowFailure: true });
    if (prematureReceipt.status === 0) issue(issues, 'IMPLEMENTATION_CONTAINS_PORT_RECEIPT', '$.receiptPath', 'implementation commit must precede its receipt-only seal');
    const implementationSourceBytes = runGit(['show', `${work}:${SOURCE_RECEIPT_PATH}`], { binary: true }).stdout;
    const sealedSourceBytes = runGit(['show', `${EXPECTED_SOURCE_SEAL_SHA}:${SOURCE_RECEIPT_PATH}`], { binary: true }).stdout;
    if (!implementationSourceBytes.equals(sealedSourceBytes)
        || gitText('rev-parse', `${work}:${SOURCE_RECEIPT_PATH}`) !== EXPECTED_SOURCE_RECEIPT_BLOB
        || sha256(implementationSourceBytes) !== EXPECTED_SOURCE_RECEIPT_SHA256) {
      issue(issues, 'SOURCE_RECEIPT_IMPLEMENTATION_BYTES_MISMATCH', SOURCE_RECEIPT_PATH, 'implementation must carry the exact historical receipt bytes, blob, and SHA-256');
    }
    try {
      issues.push(...validateHistoricalSourceReceipt(JSON.parse(implementationSourceBytes.toString('utf8'))));
    } catch (error) {
      issue(issues, 'SOURCE_RECEIPT_IMPLEMENTATION_METADATA_INVALID', SOURCE_RECEIPT_PATH, error.message);
    }
  } catch (error) {
    issue(issues, 'IMPLEMENTATION_GIT_PROOF_FAILED', '$.implementationCommitSha', error.message);
  }
  if (!sealedAt) {
    issue(issues, 'SEAL_REQUIRED', '$.receiptSealCommit', 'final receipt validation requires --sealed-at at the clean branch tip');
    return issues;
  }
  try {
    const seal = gitText('rev-parse', '--verify', `${sealedAt}^{commit}`);
    const head = gitText('rev-parse', 'HEAD');
    const branch = gitText('branch', '--show-current');
    const status = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout;
    if (branch !== EXPECTED_BRANCH) issue(issues, 'SEAL_BRANCH_MISMATCH', '$.implementationBranch', `expected ${EXPECTED_BRANCH}, got ${branch}`);
    if (seal !== head) issue(issues, 'SEAL_NOT_BRANCH_TIP', '$.receiptSealCommit', `seal ${seal} is not HEAD ${head}`);
    if (status.length !== 0) issue(issues, 'SEAL_WORKTREE_NOT_CLEAN', '$.receiptSealCommit', `working tree has ${Buffer.byteLength(status)} status bytes`);

    const sealLineage = gitText('rev-list', '--parents', '-n', '1', seal).split(/\s+/u);
    if (sealLineage.length !== 2 || sealLineage[0] !== seal || sealLineage[1] !== work) {
      issue(issues, 'SEAL_PARENT_MISMATCH', '$.receiptSealCommit', `seal must have exactly one parent ${work}, got ${sealLineage.slice(1).join(', ')}`);
    }
    const sealChanges = gitText(
      'diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', work, seal,
    ).split('\n').filter(Boolean);
    if (sealChanges.length !== 1 || sealChanges[0] !== `A\t${value.receiptPath}`) {
      issue(issues, 'SEAL_CHANGESET_INVALID', '$.receiptPath', `seal changed ${sealChanges.join(', ')}`);
    }
    const receiptTreeEntry = gitText('ls-tree', seal, '--', value.receiptPath);
    if (!receiptTreeEntry.startsWith(`100644 blob `) || !receiptTreeEntry.endsWith(`\t${value.receiptPath}`)) {
      issue(issues, 'SEALED_RECEIPT_MODE_INVALID', '$.receiptPath', `expected regular non-executable blob, got ${receiptTreeEntry}`);
    }
    const fullPathSet = gitText('diff', '--name-only', `${value.baseSha}..${seal}`).split('\n').filter(Boolean);
    if (!sameStringSet(fullPathSet, [...EXPECTED_IMPLEMENTATION_PATHS, PORT_RECEIPT_PATH])) {
      issue(issues, 'SEALED_LANE_PATH_SET_INVALID', '$.scope', `sealed lane changed ${fullPathSet.join(', ')}`);
    }
    const sealedBytes = runGit(['show', `${seal}:${value.receiptPath}`], { binary: true }).stdout;
    const workingBytes = readFileSync(join(REPO_ROOT, value.receiptPath));
    if (!sealedBytes.equals(workingBytes)) issue(issues, 'SEALED_RECEIPT_BYTES_MISMATCH', '$.receiptPath', 'working receipt differs from the sealed commit');
    issues.push(...validateHistoricalSourceReceiptBytes());
  } catch (error) {
    issue(issues, 'SEAL_GIT_PROOF_FAILED', '$.receiptSealCommit', error.message);
  }
  return issues;
}

export const validateReceiptGit = validatePortReceiptGit;

export function listPacketFiles() {
  const output = [];
  const walk = (absoluteRoot) => {
    if (!existsSync(absoluteRoot)) return;
    for (const entry of readdirSync(absoluteRoot)) {
      const absolute = join(absoluteRoot, entry);
      const stat = lstatSync(absolute);
      const repoPath = relative(REPO_ROOT, absolute).split(sep).join('/');
      if (stat.isSymbolicLink()) output.push({ path: repoPath, kind: 'symlink' });
      else if (stat.isDirectory()) walk(absolute);
      else output.push({ path: repoPath, kind: 'file' });
    }
  };
  for (const root of EXCLUSIVE_ROOTS) walk(join(REPO_ROOT, root));
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

export const listShadowFiles = listPacketFiles;

export function validateWorkingTreeScope() {
  const issues = [];
  const result = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const records = result.stdout.split('\0').filter(Boolean);
  for (const record of records) {
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (!isExclusivePath(path)) issue(issues, 'WORKTREE_PATH_OUTSIDE_EXCLUSIVE_SCOPE', path, `status ${status}`);
  }
  return issues;
}
