import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L05_BINANCE_MATRIX_SHA256,
  createInitialMarginRiskLifecycleState,
  createInitialUsdmPrivateLifecycleState,
  createSpotSignatureLifecycleState,
  evaluatePrivatePermissions,
  normalizePrivateFactEvidence,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';
import { snapshotPrivateData } from '../../../dist/liveEdge/adapters/binancePrivateTruth/bounds.js';

const T0 = 1_800_000_000_000;
const OPAQUE_BEARER = 'A'.repeat(64);
const COMPACT_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJmaXh0dXJlLXVzZXIifQ',
  'Zml4dHVyZS1zaWduYXR1cmUtbWF0ZXJpYWw',
].join('.');
const UNSECURED_COMPACT_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmaXh0dXJlIn0.';
const PADDED_BASE64 = 'QVBJX1NFQ1JFVD1maXh0dXJlLXNlbnNpdGl2ZS12YWx1ZS0wMDE=';
const BASE64URL_MATERIAL = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOp';
const AWS_ACCESS_KEY_ID = `AKIA${'A1'.repeat(8)}`;
const SHORT_COMPACT_JWT = 'eyJabcde.abcdefgh.ijklmnop';

function permissionPayload(enableReading) {
  return {
    ipRestrict: true,
    enableReading,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    enableMargin: false,
    enableFutures: false,
    permitsUniversalTransfer: false,
    enableVanillaOptions: false,
    enableFixApiTrade: false,
    enableFixReadOnly: false,
    enableSpotAndMarginTrading: false,
    enablePortfolioMarginTrading: false,
  };
}

function permissionProfile(profileClass, profileId, enableReading) {
  return {
    profileClass,
    profileId,
    accountRealmId: 'account-realm:fixture-a',
    accountFingerprintRef: 'account-fingerprint:fixture-a',
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload(enableReading),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
  };
}

function permissionInput() {
  return {
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SUPERVISION_ONLY',
    accountRealmId: 'account-realm:fixture-a',
    accountFingerprintRef: 'account-fingerprint:fixture-a',
    readProfile: permissionProfile('READ_KEY', 'read-profile:fixture-a', true),
    executionProfile: permissionProfile('EXECUTION_KEY', 'execution-profile:fixture-a', false),
  };
}

test('compound camel, snake, and kebab credential fields reject before normalization', () => {
  const forbiddenFields = [
    'apiKeyValue',
    'api_secret',
    'clientSecret',
    'secretValue',
    'privateKeyPem',
    'accessTokenValue',
    'authorizationHeader',
    'databaseCredentialValue',
    'oauth_token_value',
    'userPasswordHash',
    'wallet-passphrase-material',
    'backupMnemonicValue',
    'signingSeedValue',
    'awsClientSecret',
    'apiClientSecret',
    'clientAccessSecretId',
    'secretTokenKey',
    'apiCredentialKey',
    'awsSigningKey',
    'apiKey2',
    'xMbxApiKeyV2',
    'apiKeyBytes',
    'apiKeyCiphertext',
    'privateKeyEncrypted',
    'accessTokenEncrypted',
    'sessionTokenCiphertext',
    'encryptedApiKey',
    'secondaryApiKey',
    'binanceApiKey',
    'backupPrivateKey',
    'legacyXMbxApiKey',
    'nestedAwsClientSecretMaterial',
    'backupSigningKeyValue',
  ];

  for (const field of forbiddenFields) {
    assert.throws(
      () => normalizePrivateFactEvidence({ [field]: 'fixture-sensitive-value' }, T0),
      /secret-shaped field name/i,
      field,
    );
  }
});

test('AWS and sibling access-key fields and assignments reject at nested public boundaries', () => {
  const forbiddenFields = [
    'awsSecretAccessKey',
    'secretAccessKey',
    'AWS_SECRET_ACCESS_KEY',
    'accessKeyId',
    'AWS_ACCESS_KEY_ID',
    'apiKeyId',
    'clientSecretId',
    'clientApiKeyId',
    'apiAccessKeyIdentifier',
    'accessApiKeyId',
  ];
  for (const field of forbiddenFields) {
    assert.throws(
      () => normalizePrivateFactEvidence({
        outer: { credentialEnvelope: { [field]: 'fixture-not-a-real-credential' } },
      }, T0),
      /secret-shaped field name/i,
      field,
    );
  }

  const forbiddenAssignments = [
    ...forbiddenFields.map((field) => `${field}=fixture-not-a-real-credential`),
    'awsSecretAccessKey=fixture-not-a-real-credential',
    'secretAccessKey: fixture-not-a-real-credential',
    'AWS_SECRET_ACCESS_KEY=fixture-not-a-real-credential',
    'accessKeyId = AKIAFIXTURENOTREAL001',
    'AWS_ACCESS_KEY_ID=AKIAFIXTURENOTREAL002',
    'apiKeyId: fixture-not-a-real-credential',
    'clientSecretId=fixture-not-a-real-credential',
    'clientApiKeyId=fixture-not-a-real-credential',
    'accessApiKeyId=fixture-not-a-real-credential',
    '{"AWS_ACCESS_KEY_ID":"AKIAFIXTURENOTREAL003"}',
    'posture=DOCUMENTARY; apiAccessKeyIdentifier=fixture-not-a-real-credential',
    'awsClientSecret=fixture-not-a-real-credential',
    'apiClientSecret: fixture-not-a-real-credential',
    'clientAccessSecretId=fixture-not-a-real-credential',
    'secretTokenKey=fixture-not-a-real-credential',
    'apiCredentialKey: fixture-not-a-real-credential',
    'awsSigningKey=fixture-not-a-real-credential',
    'apiKey2=fixture-not-a-real-credential',
    'xMbxApiKeyV2: fixture-not-a-real-credential',
    'apiKeyBytes=fixture-not-a-real-credential',
    'apiKeyCiphertext: fixture-not-a-real-credential',
    'privateKeyEncrypted=fixture-not-a-real-credential',
    'accessTokenEncrypted: fixture-not-a-real-credential',
    'sessionTokenCiphertext=fixture-not-a-real-credential',
    'encryptedApiKey=fixture-not-a-real-credential',
    'secondaryApiKey: fixture-not-a-real-credential',
    'binanceApiKey=fixture-not-a-real-credential',
    'backupPrivateKey: fixture-not-a-real-credential',
    'legacyXMbxApiKey=fixture-not-a-real-credential',
  ];
  for (const assignment of forbiddenAssignments) {
    assert.throws(
      () => normalizePrivateFactEvidence({
        outer: [{ note: assignment }],
      }, T0),
      /unsafe or secret-shaped text/i,
      assignment,
    );
  }
});

test('compact JWT, base64, base64url, and bearer assignments reject before normalization', () => {
  for (const value of [
    COMPACT_JWT,
    UNSECURED_COMPACT_JWT,
    PADDED_BASE64,
    BASE64URL_MATERIAL,
    `Authorization: Bearer ${OPAQUE_BEARER}`,
    `accessTokenValue=${OPAQUE_BEARER}`,
    `jwt:${SHORT_COMPACT_JWT}`,
    AWS_ACCESS_KEY_ID,
    '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----',
    '-----BEGIN DSA PRIVATE KEY-----\nfixture\n-----END DSA PRIVATE KEY-----',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----\nfixture\n-----END PGP PRIVATE KEY BLOCK-----',
  ]) {
    assert.throws(
      () => normalizePrivateFactEvidence({ note: value }, T0),
      /unsafe or secret-shaped text/i,
    );
  }
});

test('namespaced account, profile, and fingerprint references cannot conceal bearer material', () => {
  assert.throws(
    () => evaluatePrivatePermissions({
      ...permissionInput(),
      accountRealmId: `account-realm:${OPAQUE_BEARER}`,
    }),
    /canonical non-secret identifier|namespaced account-realm/i,
  );
  assert.throws(
    () => evaluatePrivatePermissions({
      ...permissionInput(),
      accountFingerprintRef: `account-fingerprint:${OPAQUE_BEARER}`,
    }),
    /canonical non-secret identifier|namespaced account-fingerprint/i,
  );
  assert.throws(
    () => evaluatePrivatePermissions({
      ...permissionInput(),
      readProfile: permissionProfile('READ_KEY', `profile:${OPAQUE_BEARER}`, true),
    }),
    /canonical non-secret identifier|namespaced profile/i,
  );

  for (const concealedSegment of [
    `prod.${OPAQUE_BEARER}`,
    `prod.jwt:${SHORT_COMPACT_JWT}`,
    `prod.${BASE64URL_MATERIAL}`,
    'encryptedApiKey',
    'backupPrivateKey',
    'binanceApiKey',
  ]) {
    assert.throws(
      () => evaluatePrivatePermissions({
        ...permissionInput(),
        accountRealmId: `account-realm:${concealedSegment}`,
      }),
      /secret-shaped text|canonical non-secret identifier|namespaced account-realm/i,
    );
    assert.throws(
      () => evaluatePrivatePermissions({
        ...permissionInput(),
        readProfile: permissionProfile('READ_KEY', `profile:${concealedSegment}`, true),
      }),
      /secret-shaped text|canonical non-secret identifier|namespaced profile/i,
    );
    assert.throws(
      () => evaluatePrivatePermissions({
        ...permissionInput(),
        accountFingerprintRef: `account-fingerprint:${concealedSegment}`,
      }),
      /secret-shaped text|canonical non-secret identifier|namespaced account-fingerprint/i,
    );
  }
});

test('all public lifecycle constructors reject namespaced secret material before retention', () => {
  for (const concealed of [
    `account-realm:${OPAQUE_BEARER}`,
    `account-realm:${COMPACT_JWT}`,
  ]) {
    assert.throws(() => createSpotSignatureLifecycleState(concealed), /account-realm|safe text/i);
    assert.throws(() => createInitialUsdmPrivateLifecycleState(T0, concealed), /accountRealmId/i);
    assert.throws(() => createInitialMarginRiskLifecycleState(T0, concealed), /accountRealmId|safe text/i);
  }
});

test('closed documentary identifiers and ordinary values remain accepted by the snapshot boundary', () => {
  const input = {
    matrixSha256: 'a'.repeat(64),
    instrumentRevision: `l04-instrument-spec:${'1'.repeat(24)}`,
    privateProjectionRevision: `l05proj_${'2'.repeat(64)}`,
    permissionRevision: `l05perm_${'3'.repeat(64)}`,
    lifecycleRevision: `l05lifecycle_${'4'.repeat(64)}`,
    sourceCutRevision: `l05pcut_${'5'.repeat(64)}`,
    restRevision: `spot_rest_${'6'.repeat(32)}`,
    receiptId: `private-receipt:${'7'.repeat(24)}`,
    subscriptionMethod: 'userDataStream.subscribe.signature',
    signatureKeyType: 'HMAC',
    signatureAuthorized: false,
    listenKeyNotFoundCount: 0,
    externalActionAuthorization: 'NONE',
    accountReadAuthority: 'NONE',
    accessPosture: 'DOCUMENTARY_EVIDENCE_ONLY',
    apiContractId: 'SPOT_ACCOUNT_BALANCES',
    note: 'ordinary bounded documentary value',
  };
  assert.deepEqual({ ...snapshotPrivateData(input) }, input);
});
