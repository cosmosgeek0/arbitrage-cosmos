import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_OPS_LIVE_TREE,
  hasIssue,
  loadOwnerArtifacts,
  validateOwnerArtifacts,
} from './contract.mjs';

const owners = loadOwnerArtifacts();

test('landed operational owners plus ordered amendments retain the fail-closed contract', () => {
  assert.deepEqual(validateOwnerArtifacts(owners), []);
});

test('generation-fenced lock-family ownership cannot regress to directory presence', () => {
  const noClassifier = {
    ...owners,
    common: owners.common.replace('classify_lock_family()', 'classify_lock_directory()'),
  };
  assert(hasIssue(validateOwnerArtifacts(noClassifier), 'LOCK_FAMILY_CLASSIFIER_MISSING'));

  const staleWatchdog = {
    ...owners,
    watchdog: owners.watchdog.replace('classify_lock_family "$DEPLOY_LOCK"', 'test -d "$DEPLOY_LOCK"'),
  };
  assert(hasIssue(validateOwnerArtifacts(staleWatchdog), 'WATCHDOG_LOCK_CLASSIFICATION_MISSING'));
});

test('watchdog unverified-lock, readiness, and restart-budget truth cannot be weakened', () => {
  const hostile = {
    ...owners,
    watchdog: owners.watchdog
      .replace('DEPLOY_LOCK_UNVERIFIED', 'DEPLOY_LOCK_OK')
      .replace('process alive but $READY_PATH failing; NOT restarting', 'process alive but restarting')
      .replace('RESTART_BUDGET_EXHAUSTED', 'RESTARTING_ANYWAY'),
  };
  const issues = validateOwnerArtifacts(hostile);
  assert(hasIssue(issues, 'WATCHDOG_UNVERIFIED_LOCK_ALARM_MISSING'));
  assert(hasIssue(issues, 'WATCHDOG_READINESS_ALERT_ONLY_MISSING'));
  assert(hasIssue(issues, 'WATCHDOG_RESTART_BUDGET_MISSING'));
});

test('descriptor-bound restore and report-last publication guards cannot regress', () => {
  const noFollowRemoved = {
    ...owners,
    restore: owners.restore.replaceAll('constants.O_NOFOLLOW', '0'),
  };
  assert(hasIssue(validateOwnerArtifacts(noFollowRemoved), 'RESTORE_GUARD_MISSING'));

  const reportFirst = {
    ...owners,
    restore: owners.restore.replace(
      "publications.push([reportStage, 'restore-report.json'])",
      "publications.unshift([reportStage, 'restore-report.json'])",
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(reportFirst), 'RESTORE_GUARD_MISSING'));
});

test('systemd public bind, inline secret, and weakened credential binding fail closed', () => {
  const publicBind = { ...owners, appService: `${owners.appService}\nEnvironment=HOST=0.0.0.0\n` };
  assert(hasIssue(validateOwnerArtifacts(publicBind), 'SYSTEMD_PUBLIC_BIND_FORBIDDEN'));

  const inlineSecret = { ...owners, appService: `${owners.appService}\nEnvironment=API_KEY=synthetic-forbidden\n` };
  assert(hasIssue(validateOwnerArtifacts(inlineSecret), 'SYSTEMD_INLINE_SECRET_FORBIDDEN'));

  const weakCredential = {
    ...owners,
    appCredentialDropin: owners.appCredentialDropin.replace(
      'LoadCredential=app-secrets:/run/cosmos-secret-source/app-secrets.json',
      'LoadCredential=app-secrets',
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(weakCredential), 'ABSOLUTE_LOAD_CREDENTIAL_MISSING'));
});

test('raw database copy and weakened production restore confirmation fail closed', () => {
  const rawCopy = {
    ...owners,
    backup: `${owners.backup.replace('"$SQLITE" "$DB" ".backup', 'false # removed online backup')}\ncp "$DB" "$WORK/cosmos.db"\n`,
  };
  const backupIssues = validateOwnerArtifacts(rawCopy);
  assert(hasIssue(backupIssues, 'SQLITE_ONLINE_BACKUP_REQUIRED'));
  assert(hasIssue(backupIssues, 'RAW_LIVE_DATABASE_COPY_FORBIDDEN'));

  const weakRestore = {
    ...owners,
    restore: owners.restore.replace(
      '[ "${RESTORE_CONFIRM:-}" = "RESTORE_PRODUCTION" ]',
      '[ "${RESTORE_CONFIRM:-}" = "YES" ]',
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(weakRestore), 'RESTORE_GUARD_MISSING'));
});

test('weakened rollback exposure policy fails closed', () => {
  const hostile = {
    ...owners,
    rollback: owners.rollback.replaceAll(
      'if [ "$EXPOSURE" != "NONE" ]; then',
      'if [ "$EXPOSURE" = "UNKNOWN" ]; then',
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(hostile), 'ROLLBACK_EXPOSURE_GATE_MISSING'));
});

test('Cloudflare public origin, missing terminal refusal, or broad credential fails closed', () => {
  const publicOrigin = { ...owners, cloudflare: owners.cloudflare.replace('127.0.0.1:8080', '0.0.0.0:8080') };
  assert(hasIssue(validateOwnerArtifacts(publicOrigin), 'CLOUDFLARE_PUBLIC_ORIGIN_FORBIDDEN'));
  assert(hasIssue(validateOwnerArtifacts(publicOrigin), 'CLOUDFLARE_LOOPBACK_ORIGIN_REQUIRED'));

  const noCatchAll = { ...owners, cloudflare: owners.cloudflare.replace('- service: http_status:404', '- service: hello_world') };
  assert(hasIssue(validateOwnerArtifacts(noCatchAll), 'CLOUDFLARE_TERMINAL_404_REQUIRED'));

  const broadCredential = { ...owners, cloudflare: `${owners.cloudflare}\ntoken: synthetic-forbidden\n` };
  assert(hasIssue(validateOwnerArtifacts(broadCredential), 'CLOUDFLARE_BROAD_CREDENTIAL_FORBIDDEN'));
});

test('wildcard or writable Secrets Manager policy fails closed', () => {
  const wildcard = JSON.stringify({
    PolicyDocument: {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: '*' }],
    },
  });
  assert(hasIssue(validateOwnerArtifacts({ ...owners, donorIam: wildcard }), 'IAM_RESOURCE_NOT_EXACT_PLACEHOLDER'));

  const writable = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: 'secretsmanager:PutSecretValue', Resource: 'REPLACE_ME_EXACT_SECRET_ARN_WITH_SIX_CHARACTER_SUFFIX' }],
  });
  assert(hasIssue(validateOwnerArtifacts({ ...owners, i00Iam: writable }), 'IAM_ACTION_TOO_BROAD'));
});

test('missing AWSCURRENT or ambient-credential refusal fails closed', () => {
  const noStage = { ...owners, secretsProvider: owners.secretsProvider.replace("'--version-stage', 'AWSCURRENT'", "'--version-stage', 'AWSPREVIOUS'") };
  assert(hasIssue(validateOwnerArtifacts(noStage), 'SECRETS_PROVIDER_FAIL_CLOSED_GUARD_MISSING'));

  const acceptsAmbient = { ...owners, secretsProvider: owners.secretsProvider.replace("'AWS_ACCESS_KEY_ID'", "'AWS_ACCESS_KEY_ID_ALLOWED'") };
  assert(hasIssue(validateOwnerArtifacts(acceptsAmbient), 'SECRETS_PROVIDER_FAIL_CLOSED_GUARD_MISSING'));
});

test('amendment order or effective tree drift fails closed', () => {
  const amendment = JSON.parse(owners.amendment);
  amendment.amendments.reverse();
  amendment.effectiveLive.tree = '0'.repeat(40);
  const issues = validateOwnerArtifacts({ ...owners, amendment: JSON.stringify(amendment) });
  assert(hasIssue(issues, 'AMENDMENT_BYTES_INVALID'));
  assert(hasIssue(issues, 'AMENDMENT_ORDER_INVALID'));
  assert(hasIssue(issues, 'AMENDMENT_LINEAGE_INVALID'));
  assert.notEqual(amendment.effectiveLive.tree, EXPECTED_OPS_LIVE_TREE);
});
