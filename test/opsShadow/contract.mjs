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
export const RECEIPT_PATH = 'fixtures/opsShadow/receipts/OPS_SHADOW_RECEIPT.v1.json';

export const EXPECTED_BASE_SHA = '098f7b9449ab3b1c26bda19f51537bfea01d4c48';
export const EXPECTED_BRANCH = 'ops-shadow-20260715';
export const EXPECTED_DONOR_SHA = '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5';
export const EXPECTED_DONOR_IMPLEMENTATION_SHA = '9a82d4715c73ebe4156638c2bf5e8a2c02373bbf';
export const EXPECTED_DONOR_TREE = 'e401435d6a650aee8a29c3da4495b4db426be017';
export const EXPECTED_DONOR_IMPLEMENTATION_TREE = 'f6715c9a7b1e26121e3f1a9051bdd5290f9bfb07';
export const EXPECTED_OPS_LIVE_TREE = '584163858a0333cb1ccb9eff756e91a851b1cb71';
export const EXPECTED_OPS_TESTS_TREE = 'f3348a74ef22d9ca2faee431ea8cc5df63f552af';
export const EXPECTED_RECEIPT_BLOB = '7fc3520d4fede577937c6dd48c191b1e5d212061';

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

function quoteCommandToken(value) {
  return /^[A-Za-z0-9_./:=*-]+$/u.test(value) ? value : JSON.stringify(value);
}

export const FOCUSED_COMMAND_SPECS = Object.freeze([
  {
    category: 'OPS_SHADOW_CONFORMANCE',
    command: process.execPath,
    args: [
      '--import', './server/test/private-egress-tripwire.mjs',
      '--test',
      '--test-concurrency=1',
      '--test-reporter=spec',
      'test/opsShadow/**/*.test.mjs',
    ],
  },
  { category: 'DONOR_SYSTEMD', command: 'bash', args: ['ops/tests/test-systemd-units.sh'] },
  { category: 'DONOR_WATCHDOG', command: 'bash', args: ['ops/tests/test-watchdog.sh'] },
  { category: 'DONOR_BACKUP_RESTORE', command: 'bash', args: ['ops/tests/test-backup-restore.sh'] },
  { category: 'I00_BACKUP_RESTORE_ADAPTERS', command: 'bash', args: ['ops/tests/i00/test-backup-and-restore-adapters.sh'] },
  { category: 'DONOR_RESTORE_DRILL', command: 'bash', args: ['ops/tests/test-restore-drill.sh'] },
  { category: 'DONOR_ROLLBACK', command: 'bash', args: ['ops/tests/test-rollback.sh'] },
  { category: 'DONOR_DEPLOY', command: 'bash', args: ['ops/tests/test-deploy.sh'] },
  { category: 'I00_STATIC_SAFETY', command: 'bash', args: ['ops/tests/i00/test-static-safety.sh'] },
  { category: 'DONOR_CLOUDFLARE', command: 'bash', args: ['ops/tests/test-cloudflare-templates.sh'] },
  { category: 'DONOR_ENV', command: 'bash', args: ['ops/tests/test-env-templates.sh'] },
  { category: 'DONOR_SECRET_SCAN', command: 'bash', args: ['ops/tests/test-secret-scanner.sh'] },
  { category: 'DONOR_STATIC_SYNTAX', command: 'bash', args: ['ops/tests/test-shell-syntax.sh'] },
  { category: 'I00_FAKE_SECRETS_PROVIDER', command: 'bash', args: ['ops/tests/i00/test-secrets-provider.sh'] },
  { category: 'I00_TEMPLATE_SCHEMA', command: 'bash', args: ['ops/tests/i00/test-templates-and-schemas.sh'] },
].map((entry) => Object.freeze({
  ...entry,
  args: Object.freeze([...entry.args]),
  commandText: [entry.command, ...entry.args].map(quoteCommandToken).join(' '),
})));

const EXPECTED_ROW_CLASSIFICATIONS = new Map([
  ['OPS-SYSTEMD-UNITS', 'ADOPT_EXISTING'],
  ['OPS-WATCHDOG', 'ADOPT_EXISTING'],
  ['OPS-BACKUP', 'ADOPT_EXISTING'],
  ['OPS-RESTORE-ISOLATED', 'ADOPT_EXISTING'],
  ['OPS-RESTORE-PRODUCTION', 'REFERENCE_ONLY'],
  ['OPS-ROLLBACK', 'ADOPT_EXISTING'],
  ['OPS-CLOUDFLARE', 'ADOPT_EXISTING'],
  ['OPS-SECRETS-IAM', 'ADOPT_EXISTING'],
  ['OPS-SECRETS-PROVIDER', 'ADOPT_EXISTING'],
  ['OPS-LOCAL-FAKE-HARNESSES', 'ADOPT_EXISTING'],
  ['OPS-RUN16-CONFORMANCE', 'ADAPT_EXISTING'],
  ['OPS-RUN16-METADATA', 'MISSING_BUILD'],
  ['OPS-REAL-ACTIVATION', 'REFERENCE_ONLY'],
  ['OPS-NEW-OPERATIONAL-OWNER', 'REJECT_DUPLICATE'],
]);

export const EXPECTED_INSERTION_REQUEST_IDS = Object.freeze([
  'OPS-SHADOW-IR-RESTORE-001',
  'OPS-SHADOW-IR-SYSTEMD-002',
  'OPS-SHADOW-IR-CLOUDFLARE-003',
  'OPS-SHADOW-IR-WATCHDOG-004',
  'OPS-SHADOW-IR-OWNER-INPUTS-005',
]);

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
  if (value.schema !== 'OPS_SHADOW_ENTRY_GATE_V1') issue(issues, 'ENTRY_GATE_SCHEMA_INVALID', '$.schema', 'schema must be exact');
  if (value.packet !== 'RUN-16' || value.task !== 'OPS-SHADOW') issue(issues, 'PACKET_IDENTITY_INVALID', '$.packet', 'packet identity must be RUN-16 / OPS-SHADOW');
  if (value.shadowStatus !== 'SHADOW_SPECULATIVE') issue(issues, 'SHADOW_STATUS_INVALID', '$.shadowStatus', 'shadow status must stay speculative');
  if (value.targetTerminalState !== 'OPS_SHADOW_READY') issue(issues, 'TARGET_TERMINAL_INVALID', '$.targetTerminalState', 'terminal target must be exact');
  for (const field of [
    'acceptanceClaimed',
    'prestageReadyClaimed',
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
  if (value.launchAuthority?.decision !== 'D-LAUNCH-37'
      || value.launchAuthority?.decisionCommit !== 'd090d006019e21b150fa7b74831240695d8791e3'
      || value.launchAuthority?.orderId !== '90dcac299155') {
    issue(issues, 'LAUNCH_AUTHORITY_MISMATCH', '$.launchAuthority', 'launch authority binding is not exact');
  }
  if (value.base?.branch !== EXPECTED_BRANCH || value.base?.sha !== EXPECTED_BASE_SHA
      || value.base?.opsLiveTree !== EXPECTED_OPS_LIVE_TREE) {
    issue(issues, 'BASE_BINDING_MISMATCH', '$.base', 'base branch, SHA, and ops/live tree must be exact');
  }
  const donor = value.donor ?? {};
  const expectedDonor = {
    acceptedCommit: EXPECTED_DONOR_SHA,
    acceptedCommitTree: EXPECTED_DONOR_TREE,
    implementationCommit: EXPECTED_DONOR_IMPLEMENTATION_SHA,
    implementationTree: EXPECTED_DONOR_IMPLEMENTATION_TREE,
    opsLiveTree: EXPECTED_OPS_LIVE_TREE,
    opsTestsTree: EXPECTED_OPS_TESTS_TREE,
    receiptBlob: EXPECTED_RECEIPT_BLOB,
  };
  for (const [field, expected] of Object.entries(expectedDonor)) {
    if (donor[field] !== expected) issue(issues, 'DONOR_BINDING_MISMATCH', `$.donor.${field}`, `${field} must bind the accepted donor`);
  }
  if (donor.currentBaseParity !== 'EXACT_OPS_LIVE_TREE_MATCH') {
    issue(issues, 'DONOR_PARITY_POSTURE_INVALID', '$.donor.currentBaseParity', 'parity must be an exact tree match');
  }
  if (!sameStringSet(value.classificationVocabulary, CLASSIFICATIONS)) {
    issue(issues, 'CLASSIFICATION_VOCABULARY_INVALID', '$.classificationVocabulary', 'the exact five-value vocabulary is required');
  }
  if (!sameStringSet(value.exclusivePathRoots, EXCLUSIVE_ROOTS)) {
    issue(issues, 'EXCLUSIVE_ROOTS_INVALID', '$.exclusivePathRoots', 'exclusive roots must be exact');
  }
  if (!Array.isArray(value.researchBasis) || value.researchBasis.length < 4) {
    issue(issues, 'RESEARCH_BASIS_INCOMPLETE', '$.researchBasis', 'current official research anchors are required');
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
    const buildPaths = Array.isArray(row?.shadowBuildPaths) ? row.shadowBuildPaths : [];
    const buildable = row?.classification === 'ADAPT_EXISTING' || row?.classification === 'MISSING_BUILD';
    if (buildable && buildPaths.length === 0) issue(issues, 'BUILDABLE_ROW_HAS_NO_PATH', `${rowPath}.shadowBuildPaths`, 'adapt/missing row needs packet-local paths');
    if (!buildable && buildPaths.length !== 0) issue(issues, 'NON_BUILDABLE_ROW_HAS_PATH', `${rowPath}.shadowBuildPaths`, 'only adapt/missing rows may build');
    for (const [pathIndex, path] of buildPaths.entries()) {
      if (!isExclusivePath(path)) issue(issues, 'BUILD_PATH_OUTSIDE_EXCLUSIVE_SCOPE', `${rowPath}.shadowBuildPaths[${pathIndex}]`, `${String(path)} is outside packet scope`);
      if (/\.(?:service|timer|sh|ya?ml|template)$/u.test(path)) {
        issue(issues, 'OPERATIONAL_TEMPLATE_COPY_FORBIDDEN', `${rowPath}.shadowBuildPaths[${pathIndex}]`, 'shadow paths may not copy operational templates');
      }
      validatePathReference(issues, `${rowPath}.shadowBuildPaths[${pathIndex}]`, path, { mayBePendingReceipt: true });
    }
    for (const field of ['ownerPaths', 'adaptationPaths', 'provingTests']) {
      if (!Array.isArray(row?.[field])) issue(issues, 'PATH_LIST_REQUIRED', `${rowPath}.${field}`, `${field} must be an array`);
      for (const [pathIndex, path] of (row?.[field] ?? []).entries()) {
        validatePathReference(issues, `${rowPath}.${field}[${pathIndex}]`, path);
      }
    }
  }
  if (!Array.isArray(value.limitations) || value.limitations.length < 5) {
    issue(issues, 'LIMITATIONS_INCOMPLETE', '$.limitations', 'host, suite, restore, C2, and external-readback limits must remain explicit');
  }
  return issues;
}

export function validateGitBindings(value) {
  const issues = [];
  const checks = [
    ['DONOR_PARENT_MISMATCH', [`${value.donor.acceptedCommit}^`], EXPECTED_DONOR_IMPLEMENTATION_SHA],
    ['DONOR_TREE_MISMATCH', [`${value.donor.acceptedCommit}^{tree}`], EXPECTED_DONOR_TREE],
    ['DONOR_IMPLEMENTATION_TREE_MISMATCH', [`${value.donor.implementationCommit}^{tree}`], EXPECTED_DONOR_IMPLEMENTATION_TREE],
    ['DONOR_OPS_LIVE_TREE_MISMATCH', [`${value.donor.acceptedCommit}:ops/live`], EXPECTED_OPS_LIVE_TREE],
    ['DONOR_OPS_TESTS_TREE_MISMATCH', [`${value.donor.acceptedCommit}:ops/tests`], EXPECTED_OPS_TESTS_TREE],
    ['DONOR_RECEIPT_BLOB_MISMATCH', [`${value.donor.acceptedCommit}:ops/live/RECEIPT.md`], EXPECTED_RECEIPT_BLOB],
    ['BASE_OPS_LIVE_TREE_MISMATCH', [`${value.base.sha}:ops/live`], EXPECTED_OPS_LIVE_TREE],
  ];
  for (const [code, args, expected] of checks) {
    let actual = '';
    try { actual = gitText('rev-parse', ...args); } catch (error) {
      issue(issues, code, '$.donor', error.message);
      continue;
    }
    if (actual !== expected) issue(issues, code, '$.donor', `expected ${expected}, got ${actual}`);
  }
  const ancestor = runGit(['merge-base', '--is-ancestor', value.donor.acceptedCommit, value.base.sha], { allowFailure: true });
  if (ancestor.status !== 0) issue(issues, 'DONOR_NOT_ANCESTOR_OF_BASE', '$.donor.acceptedCommit', 'accepted donor must be an ancestor of the packet base');
  const baseAncestor = runGit(['merge-base', '--is-ancestor', value.base.sha, 'HEAD'], { allowFailure: true });
  if (baseAncestor.status !== 0) issue(issues, 'BASE_NOT_ANCESTOR_OF_HEAD', '$.base.sha', 'packet HEAD must descend from the exact base');
  let branch = '';
  try { branch = gitText('branch', '--show-current'); } catch (error) { issue(issues, 'BRANCH_READ_FAILED', '$.base.branch', error.message); }
  if (branch !== value.base.branch) issue(issues, 'BRANCH_MISMATCH', '$.base.branch', `expected ${value.base.branch}, got ${branch || 'DETACHED_HEAD'}`);
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
  opsState: 'IP_OPS_STATE.md',
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

  requireText(issues, artifacts.watchdog, 'RESTART_BUDGET_EXHAUSTED', 'WATCHDOG_RESTART_BUDGET_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'process alive but $READY_PATH failing; NOT restarting', 'WATCHDOG_READINESS_ALERT_ONLY_MISSING', 'watchdog');
  requireText(issues, artifacts.watchdog, 'if [ -d "$DEPLOY_LOCK" ]', 'WATCHDOG_DEPLOY_LOCK_STANDDOWN_MISSING', 'watchdog');
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
    'sha256 mismatch',
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
  requireText(issues, artifacts.opsState, '| Production restore | `BLOCKED_DONOR_AMENDMENT` |', 'PRODUCTION_RESTORE_BLOCKER_NOT_RECORDED', 'opsState');
  return issues;
}

export function validateInsertionRequests(value) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, 'INSERTION_REQUEST_OBJECT_REQUIRED', '$', 'insertion requests must be an object');
    return issues;
  }
  if (value.schema !== 'OPS_SHADOW_INSERTION_REQUESTS_V1') issue(issues, 'INSERTION_SCHEMA_INVALID', '$.schema', 'schema must be exact');
  if (value.packet !== 'RUN-16' || value.shadowStatus !== 'SHADOW_SPECULATIVE') issue(issues, 'INSERTION_PACKET_POSTURE_INVALID', '$', 'packet and shadow posture must be exact');
  if (value.authorityEffect !== 'NONE' || value.requestsApplied !== false) issue(issues, 'INSERTION_AUTHORITY_FORBIDDEN', '$', 'requests must grant no authority and remain unapplied');
  const requests = Array.isArray(value.requests) ? value.requests : [];
  const ids = requests.map((request) => request?.id);
  if (!sameStringSet(ids, EXPECTED_INSERTION_REQUEST_IDS)) issue(issues, 'INSERTION_REQUEST_SET_INVALID', '$.requests', 'exact request set is required');
  if (new Set(ids).size !== ids.length) issue(issues, 'DUPLICATE_INSERTION_REQUEST', '$.requests', 'request IDs must be unique');
  for (const [index, request] of requests.entries()) {
    const path = `$.requests[${index}]`;
    if (request?.status !== 'DRAFT_NOT_APPLIED' || request?.classification !== 'REFERENCE_ONLY') issue(issues, 'INSERTION_REQUEST_STATUS_INVALID', path, 'request must remain draft and reference-only');
    if (typeof request?.targetOwner !== 'string' || /OPS-SHADOW|RUN-16/u.test(request.targetOwner)) issue(issues, 'INSERTION_TARGET_OWNER_INVALID', `${path}.targetOwner`, 'target must be an accepted external owner');
    if (typeof request?.request !== 'string' || request.request.length < 80) issue(issues, 'INSERTION_REQUEST_INCOMPLETE', `${path}.request`, 'request must be precise');
    if (!Array.isArray(request?.requiredEvidence) || request.requiredEvidence.length < 3) issue(issues, 'INSERTION_EVIDENCE_INCOMPLETE', `${path}.requiredEvidence`, 'required evidence must be explicit');
    if (!Array.isArray(request?.forbiddenEffects) || request.forbiddenEffects.length < 2) issue(issues, 'INSERTION_PROHIBITIONS_INCOMPLETE', `${path}.forbiddenEffects`, 'forbidden effects must be explicit');
  }
  const restore = requests.find((request) => request.id === 'OPS-SHADOW-IR-RESTORE-001');
  if (restore) {
    for (const required of ['target filesystem', 'retains the prior set', 'atomic generation switch', 'every app connection inactive']) {
      if (!restore.request.includes(required)) issue(issues, 'RESTORE_INSERTION_INCOMPLETE', '$.requests[restore]', `missing ${required}`);
    }
    if (restore.currentBlocker !== 'BLOCKED_DONOR_AMENDMENT') issue(issues, 'RESTORE_BLOCKER_MISMATCH', '$.requests[restore].currentBlocker', 'current blocker must remain exact');
  }
  return issues;
}

function isHex(value, length) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'u').test(value);
}

export function validateReceiptShape(value) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, 'RECEIPT_OBJECT_REQUIRED', '$', 'receipt must be an object');
    return issues;
  }
  if (value.schema !== 'OPS_SHADOW_RECEIPT_V1') issue(issues, 'RECEIPT_SCHEMA_INVALID', '$.schema', 'receipt schema must be exact');
  if (value.packet !== 'RUN-16' || value.shadowStatus !== 'SHADOW_SPECULATIVE' || value.terminalState !== 'OPS_SHADOW_READY') issue(issues, 'RECEIPT_POSTURE_INVALID', '$', 'receipt packet, posture, and terminal must be exact');
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
    if (value[field] !== false) issue(issues, 'RECEIPT_FORBIDDEN_AFFIRMATIVE_CLAIM', `$.${field}`, `${field} must be false`);
  }
  if (value.authorityEffect !== 'NONE') issue(issues, 'RECEIPT_AUTHORITY_EFFECT_FORBIDDEN', '$.authorityEffect', 'authority effect must be NONE');
  if (value.baseSha !== EXPECTED_BASE_SHA || value.implementationBranch !== EXPECTED_BRANCH) issue(issues, 'RECEIPT_BASE_OR_BRANCH_MISMATCH', '$', 'base and branch must be exact');
  if (!isHex(value.implementationCommitSha, 40) || !isHex(value.implementationTreeSha, 40)) issue(issues, 'RECEIPT_IMPLEMENTATION_ID_INVALID', '$', 'implementation commit and tree must be full SHA-1 values');
  if (value.receiptSealCommit !== 'ENCLOSING_COMMIT_NOT_SELF_REFERENTIAL') issue(issues, 'RECEIPT_SELF_REFERENCE_INVALID', '$.receiptSealCommit', 'receipt must state the non-self-referential seal law');
  if (value.receiptPath !== RECEIPT_PATH) issue(issues, 'RECEIPT_PATH_INVALID', '$.receiptPath', 'receipt path must be exact');
  if (!sameStringSet(value.scope?.exclusivePathRoots, EXCLUSIVE_ROOTS)) issue(issues, 'RECEIPT_EXCLUSIVE_ROOTS_INVALID', '$.scope.exclusivePathRoots', 'exclusive roots must be exact');
  const changed = Array.isArray(value.scope?.implementationChangedPaths) ? value.scope.implementationChangedPaths : [];
  if (value.scope?.implementationChangedPathCount !== changed.length || changed.length === 0) issue(issues, 'RECEIPT_CHANGED_PATH_COUNT_INVALID', '$.scope', 'changed path count must be exact and nonzero');
  const paths = changed.map((entry) => entry?.path);
  if (new Set(paths).size !== paths.length) issue(issues, 'RECEIPT_DUPLICATE_CHANGED_PATH', '$.scope.implementationChangedPaths', 'changed paths must be unique');
  if ([...paths].sort().some((path, index) => path !== paths[index])) issue(issues, 'RECEIPT_CHANGED_PATHS_NOT_SORTED', '$.scope.implementationChangedPaths', 'changed paths must be sorted');
  for (const [index, entry] of changed.entries()) {
    const path = `$.scope.implementationChangedPaths[${index}]`;
    if (!isExclusivePath(entry?.path) || entry?.path === RECEIPT_PATH) issue(issues, 'RECEIPT_IMPLEMENTATION_PATH_INVALID', `${path}.path`, 'implementation path must be exclusive and exclude the later receipt');
    if (!isHex(entry?.gitBlob, 40) || !isHex(entry?.sha256, 64)) issue(issues, 'RECEIPT_PATH_DIGEST_INVALID', path, 'blob and SHA-256 must be full values');
  }
  const tests = Array.isArray(value.tests) ? value.tests : [];
  if (tests.length < 2) issue(issues, 'RECEIPT_TEST_EVIDENCE_INCOMPLETE', '$.tests', 'shadow and reused focused tests must be recorded');
  const actualTestKeys = tests.map((entry) => `${entry?.category}\0${entry?.command}`);
  const expectedTestKeys = FOCUSED_COMMAND_SPECS.map((entry) => `${entry.category}\0${entry.commandText}`);
  if (actualTestKeys.length !== expectedTestKeys.length
      || actualTestKeys.some((key, index) => key !== expectedTestKeys[index])) {
    issue(issues, 'RECEIPT_TEST_COMMAND_SET_INVALID', '$.tests', 'receipt must bind the exact ordered focused command set');
  }
  for (const [index, testEvidence] of tests.entries()) {
    const path = `$.tests[${index}]`;
    if (typeof testEvidence?.command !== 'string' || testEvidence.command.length < 3) issue(issues, 'RECEIPT_TEST_COMMAND_INVALID', `${path}.command`, 'test command is required');
    if (testEvidence?.outcome !== 'PASS' || testEvidence?.exitCode !== 0) issue(issues, 'RECEIPT_TEST_NOT_GREEN', path, 'only measured focused passes may be recorded');
    if (!isHex(testEvidence?.stdoutSha256, 64) || !isHex(testEvidence?.stderrSha256, 64)) issue(issues, 'RECEIPT_TEST_OUTPUT_DIGEST_INVALID', path, 'test output hashes must be exact');
  }
  if (!sameStringSet(value.insertionRequestIds, EXPECTED_INSERTION_REQUEST_IDS)) issue(issues, 'RECEIPT_INSERTION_REQUEST_SET_INVALID', '$.insertionRequestIds', 'receipt must bind every insertion request');
  if (!Array.isArray(value.limitations) || value.limitations.length < 5) issue(issues, 'RECEIPT_LIMITATIONS_INCOMPLETE', '$.limitations', 'limitations must remain explicit');
  if (value.donor?.acceptedCommit !== EXPECTED_DONOR_SHA || value.donor?.opsLiveTree !== EXPECTED_OPS_LIVE_TREE || value.donor?.parity !== 'EXACT_OPS_LIVE_TREE_MATCH') {
    issue(issues, 'RECEIPT_DONOR_BINDING_MISMATCH', '$.donor', 'receipt must bind donor and exact parity');
  }
  return issues;
}

export function validateReceiptGit(value, { sealedAt = null } = {}) {
  const issues = [];
  const work = value.implementationCommitSha;
  try {
    const parent = gitText('rev-parse', `${work}^`);
    if (parent !== value.baseSha) issue(issues, 'IMPLEMENTATION_PARENT_MISMATCH', '$.implementationCommitSha', `expected parent ${value.baseSha}, got ${parent}`);
    const tree = gitText('rev-parse', `${work}^{tree}`);
    if (tree !== value.implementationTreeSha) issue(issues, 'IMPLEMENTATION_TREE_MISMATCH', '$.implementationTreeSha', `expected ${value.implementationTreeSha}, got ${tree}`);
    const actualPaths = gitText('diff', '--name-only', `${value.baseSha}..${work}`).split('\n').filter(Boolean).sort();
    const receiptPaths = value.scope.implementationChangedPaths.map((entry) => entry.path).sort();
    if (!sameStringSet(actualPaths, receiptPaths)) issue(issues, 'IMPLEMENTATION_PATH_SET_MISMATCH', '$.scope.implementationChangedPaths', `actual ${actualPaths.join(', ')}`);
    for (const entry of value.scope.implementationChangedPaths) {
      const blob = gitText('rev-parse', `${work}:${entry.path}`);
      if (blob !== entry.gitBlob) issue(issues, 'IMPLEMENTATION_BLOB_MISMATCH', entry.path, `expected ${entry.gitBlob}, got ${blob}`);
      const bytes = runGit(['show', `${work}:${entry.path}`], { binary: true }).stdout;
      const digest = sha256(bytes);
      if (digest !== entry.sha256) issue(issues, 'IMPLEMENTATION_SHA256_MISMATCH', entry.path, `expected ${entry.sha256}, got ${digest}`);
    }
  } catch (error) {
    issue(issues, 'IMPLEMENTATION_GIT_PROOF_FAILED', '$.implementationCommitSha', error.message);
  }
  if (sealedAt) {
    try {
      const seal = gitText('rev-parse', sealedAt);
      const parent = gitText('rev-parse', `${seal}^`);
      if (parent !== work) issue(issues, 'SEAL_PARENT_MISMATCH', '$.receiptSealCommit', `seal parent ${parent} is not work commit ${work}`);
      const sealPaths = gitText('diff', '--name-only', `${work}..${seal}`).split('\n').filter(Boolean);
      if (sealPaths.length !== 1 || sealPaths[0] !== value.receiptPath) issue(issues, 'SEAL_PATH_SET_INVALID', '$.receiptPath', `seal changed ${sealPaths.join(', ')}`);
      const sealedBytes = runGit(['show', `${seal}:${value.receiptPath}`], { binary: true }).stdout;
      const workingBytes = readFileSync(join(REPO_ROOT, value.receiptPath));
      if (!sealedBytes.equals(workingBytes)) issue(issues, 'SEALED_RECEIPT_BYTES_MISMATCH', '$.receiptPath', 'working receipt differs from the sealed commit');
    } catch (error) {
      issue(issues, 'SEAL_GIT_PROOF_FAILED', '$.receiptSealCommit', error.message);
    }
  }
  return issues;
}

export function listShadowFiles() {
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
