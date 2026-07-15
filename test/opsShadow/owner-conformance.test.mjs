import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasIssue,
  loadOwnerArtifacts,
  validateOwnerArtifacts,
} from './contract.mjs';

const owners = loadOwnerArtifacts();

test('accepted operational owners retain the fail-closed conformance contract', () => {
  assert.deepEqual(validateOwnerArtifacts(owners), []);
});

test('systemd public bind and inline secret mutations fail closed', () => {
  const publicBind = { ...owners, appService: `${owners.appService}\nEnvironment=HOST=0.0.0.0\n` };
  assert(hasIssue(validateOwnerArtifacts(publicBind), 'SYSTEMD_PUBLIC_BIND_FORBIDDEN'));

  const inlineSecret = { ...owners, appService: `${owners.appService}\nEnvironment=API_KEY=synthetic-forbidden\n` };
  assert(hasIssue(validateOwnerArtifacts(inlineSecret), 'SYSTEMD_INLINE_SECRET_FORBIDDEN'));
});

test('missing absolute systemd credential binding fails closed', () => {
  const hostile = {
    ...owners,
    appCredentialDropin: owners.appCredentialDropin.replace(
      'LoadCredential=app-secrets:/run/cosmos-secret-source/app-secrets.json',
      'LoadCredential=app-secrets',
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(hostile), 'ABSOLUTE_LOAD_CREDENTIAL_MISSING'));
});

test('watchdog readiness restart mutation fails closed', () => {
  const hostile = {
    ...owners,
    watchdog: owners.watchdog.replace(
      'process alive but $READY_PATH failing; NOT restarting',
      'process alive but $READY_PATH failing; restarting',
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(hostile), 'WATCHDOG_READINESS_ALERT_ONLY_MISSING'));
});

test('raw database copy mutation fails closed', () => {
  const hostile = {
    ...owners,
    backup: owners.backup.replace('"$SQLITE" "$DB" ".backup \'$WORK/cosmos.db\'"', 'cp "$DB" "$WORK/cosmos.db"'),
  };
  const issues = validateOwnerArtifacts(hostile);
  assert(hasIssue(issues, 'SQLITE_ONLINE_BACKUP_REQUIRED'));
  assert(hasIssue(issues, 'RAW_LIVE_DATABASE_COPY_FORBIDDEN'));
});

test('weakened production restore guard fails closed', () => {
  const hostile = {
    ...owners,
    restore: owners.restore.replace(
      '[ "${RESTORE_CONFIRM:-}" = "RESTORE_PRODUCTION" ]',
      '[ "${RESTORE_CONFIRM:-}" = "YES" ]',
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(hostile), 'RESTORE_GUARD_MISSING'));
});

test('weakened rollback exposure policy fails closed', () => {
  const hostile = {
    ...owners,
    rollback: owners.rollback.replace(
      'if [ "$EXPOSURE" != "NONE" ]; then',
      'if [ "$EXPOSURE" = "UNKNOWN" ]; then',
    ),
  };
  assert(hasIssue(validateOwnerArtifacts(hostile), 'ROLLBACK_EXPOSURE_GATE_MISSING'));
});

test('Cloudflare public origin, missing terminal 404, or broad credential fails closed', () => {
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

test('removing the production restore blocker fails closed', () => {
  const hostile = { ...owners, opsState: owners.opsState.replace('`BLOCKED_DONOR_AMENDMENT`', '`OPS_READY`') };
  assert(hasIssue(validateOwnerArtifacts(hostile), 'PRODUCTION_RESTORE_BLOCKER_NOT_RECORDED'));
});
