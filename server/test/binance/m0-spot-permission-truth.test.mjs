import assert from 'node:assert/strict';
import test from 'node:test';

import * as m0PermissionModule from '../../dist/binance/m0SpotPermissionTruth.js';
import {
  L05_BINANCE_MATRIX_SHA256,
} from '../../dist/liveEdge/adapters/binancePrivateTruth/contracts.js';
import {
  evaluatePrivatePermissions,
} from '../../dist/liveEdge/adapters/binancePrivateTruth/permissions.js';

const {
  calculateM0SpotPermissionEnvelopeDigest,
  M0_SPOT_PERMISSION_ENVELOPE_SCHEMA,
  M0_SPOT_PERMISSION_TRUTH_SCHEMA,
  projectM0SpotPermissionTruth,
} = m0PermissionModule;

const NOW = 1_900_000_000_000;
const ACCOUNT_REALM = 'account-realm-m0';
const ACCOUNT_FINGERPRINT = 'account-fingerprint-m0';
const READ_PROFILE = 'read-profile-m0';
const EXECUTION_PROFILE = 'execution-profile-m0';
const READ_SIGNER_FINGERPRINT = `sha256:${'b'.repeat(64)}`;
const EXECUTION_SIGNER_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function permissionPayload(overrides = {}) {
  return {
    ipRestrict: true,
    enableReading: false,
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
    ...overrides,
  };
}

function readProfile(overrides = {}) {
  return {
    profileClass: 'READ_KEY',
    profileId: READ_PROFILE,
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload({ enableReading: true }),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
    ...overrides,
  };
}

function executionProfile(overrides = {}) {
  return {
    profileClass: 'EXECUTION_KEY',
    profileId: EXECUTION_PROFILE,
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload({
      enableSpotAndMarginTrading: true,
    }),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
    ...overrides,
  };
}

function canonicalDecisions({
  posture = 'SPOT_NEW_EXPOSURE',
  read = readProfile(),
  execution = executionProfile(),
  accountRealmId = ACCOUNT_REALM,
  accountFingerprintRef = ACCOUNT_FINGERPRINT,
} = {}) {
  return evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId,
    accountFingerprintRef,
    readProfile: read,
    executionProfile: execution,
  });
}

function permissionEnvelope({
  permissionDecisions = canonicalDecisions(),
  accountCanTradeEvidence = {},
  readSignerEvidence = {},
  executionSignerEvidence = {},
  contentOverrides = {},
} = {}) {
  const fallback = canonicalDecisions();
  const read = permissionDecisions[0] ?? fallback[0];
  const execution = permissionDecisions[1] ?? fallback[1];
  const content = {
    schema: M0_SPOT_PERMISSION_ENVELOPE_SCHEMA,
    version: 1,
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    permissionDecisions,
    accountCanTradeEvidence: {
      profileId: read.profileId,
      accountRealmId: ACCOUNT_REALM,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      permissionRevision: read.revision,
      canTrade: true,
      evidenceRevision: 'spot-account-revision-m0',
      observedAtMs: NOW - 1_000,
      validUntilMs: NOW + 30_000,
      ...accountCanTradeEvidence,
    },
    readSignerEvidence: {
      endpointClass: 'USER_DATA',
      profileId: read.profileId,
      accountRealmId: ACCOUNT_REALM,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      permissionRevision: read.revision,
      signerFingerprint: READ_SIGNER_FINGERPRINT,
      signerRevision: 'read-signer-revision-m0',
      observedAtMs: NOW - 950,
      validUntilMs: NOW + 25_000,
      ...readSignerEvidence,
    },
    executionSignerEvidence: {
      endpointClass: 'TRADE',
      profileId: execution.profileId,
      accountRealmId: ACCOUNT_REALM,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      permissionRevision: execution.revision,
      signerFingerprint: EXECUTION_SIGNER_FINGERPRINT,
      signerRevision: 'execution-signer-revision-m0',
      observedAtMs: NOW - 900,
      validUntilMs: NOW + 20_000,
      ...executionSignerEvidence,
    },
    ...contentOverrides,
  };
  return {
    ...content,
    evidenceDigest:
      calculateM0SpotPermissionEnvelopeDigest(content),
  };
}

function assertNoAuthority(value) {
  assert.equal(value.sendEligible, false);
  assert.equal(value.accountReadAuthority, 'NONE');
  assert.equal(value.mutationAuthority, 'NONE');
  assert.equal(value.reconciliationAuthority, 'NONE');
  assert.equal(value.capitalAuthority, 'NONE');
  assert.equal(value.riskAuthority, 'NONE');
  assert.equal(value.externalActionAuthorization, 'NONE');
  assert.equal(value.actionAuthority, 'NONE_RECORD_ONLY');
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (Object.hasOwn(descriptor, 'value')) {
      assertDeeplyFrozen(descriptor.value, seen);
    }
  }
}

test('M0 verifies only two distinct canonical SPOT profiles in one current digest-bound envelope', () => {
  const envelope = permissionEnvelope();
  const truth = projectM0SpotPermissionTruth(envelope, NOW);

  assert.equal(m0PermissionModule.decodeM0SpotPermissionTruth, undefined);
  assert.equal(truth.schema, M0_SPOT_PERMISSION_TRUTH_SCHEMA);
  assert.equal(truth.version, 2);
  assert.equal(truth.state, 'VERIFIED');
  assert.equal(truth.posture, 'SPOT_NEW_EXPOSURE');
  for (const decision of envelope.permissionDecisions) {
    assert.equal(decision.acceptableForOwnerReview, true);
    assert.deepEqual(decision.reasonCodes, []);
  }
  assert.equal(truth.evidenceDigest, envelope.evidenceDigest);
  assert.equal(truth.accountRealmId, ACCOUNT_REALM);
  assert.equal(truth.accountFingerprintRef, ACCOUNT_FINGERPRINT);
  assert.deepEqual(truth.readProfile, {
    profileId: READ_PROFILE,
    permissionRevision:
      envelope.permissionDecisions[0].revision,
  });
  assert.deepEqual(truth.executionProfile, {
    profileId: EXECUTION_PROFILE,
    permissionRevision:
      envelope.permissionDecisions[1].revision,
  });
  assert.equal(truth.accountCanTradeEvidence.canTrade, true);
  assert.equal(
    truth.readSignerEvidence.signerFingerprint,
    READ_SIGNER_FINGERPRINT,
  );
  assert.equal(
    truth.executionSignerEvidence.signerFingerprint,
    EXECUTION_SIGNER_FINGERPRINT,
  );
  assert.equal(
    truth.readApiKeyFingerprint,
    READ_SIGNER_FINGERPRINT,
  );
  assert.equal(
    truth.executionApiKeyFingerprint,
    EXECUTION_SIGNER_FINGERPRINT,
  );
  assert.equal(truth.validUntilMs, NOW + 20_000);
  assert.deepEqual(truth.reasonCodes, []);
  assertNoAuthority(truth);
  assertDeeplyFrozen(truth);
});

test('the envelope digest is deterministic and rejects every post-digest change', () => {
  const first = permissionEnvelope();
  const same = permissionEnvelope();
  assert.equal(first.evidenceDigest, same.evidenceDigest);

  for (const tampered of [
    {
      ...first,
      accountRealmId: 'account-realm-other',
    },
    {
      ...first,
      accountCanTradeEvidence: {
        ...first.accountCanTradeEvidence,
        canTrade: false,
      },
    },
    {
      ...first,
      readSignerEvidence: {
        ...first.readSignerEvidence,
        signerRevision: 'read-signer-revision-other',
      },
    },
    {
      ...first,
      executionSignerEvidence: {
        ...first.executionSignerEvidence,
        signerRevision: 'execution-signer-revision-other',
      },
    },
  ]) {
    assert.throws(
      () => projectM0SpotPermissionTruth(tampered, NOW),
      /digest mismatch/u,
    );
  }
});

test('raw, reordered, augmented, or revision-tampered permission rows are not canonical M0 input', () => {
  const valid = permissionEnvelope();
  const [read, execution] = valid.permissionDecisions;
  const cases = [
    [],
    [read],
    [execution, read],
    [{ ...read, revision: `l05perm_${'f'.repeat(64)}` }, execution],
    [{ ...read, inventedAuthority: false }, execution],
    [
      {
        profileClass: 'READ_KEY',
        permissions: permissionPayload({ enableReading: true }),
      },
      execution,
    ],
  ];

  for (const permissionDecisions of cases) {
    const content = {
      schema: valid.schema,
      version: valid.version,
      accountRealmId: valid.accountRealmId,
      accountFingerprintRef: valid.accountFingerprintRef,
      permissionDecisions,
      accountCanTradeEvidence: valid.accountCanTradeEvidence,
      readSignerEvidence: valid.readSignerEvidence,
      executionSignerEvidence: valid.executionSignerEvidence,
    };
    const envelope = {
      ...content,
      evidenceDigest:
        calculateM0SpotPermissionEnvelopeDigest(content),
    };
    assert.throws(
      () => projectM0SpotPermissionTruth(envelope, NOW),
      /permission decisions|private evidence/u,
    );
  }
});

test('withdrawal, transfer, Margin, Futures, Options, FIX and Portfolio permissions must be exactly false on both profiles', () => {
  const unsafeFields = [
    'enableWithdrawals',
    'enableInternalTransfer',
    'permitsUniversalTransfer',
    'enableMargin',
    'enableFutures',
    'enableVanillaOptions',
    'enableFixApiTrade',
    'enableFixReadOnly',
    'enablePortfolioMarginTrading',
  ];

  for (const profileClass of ['READ_KEY', 'EXECUTION_KEY']) {
    for (const field of unsafeFields) {
      const read = readProfile();
      const execution = executionProfile();
      const target = profileClass === 'READ_KEY' ? read : execution;
      target.permissions = {
        ...target.permissions,
        [field]: true,
      };
      const truth = projectM0SpotPermissionTruth(
        permissionEnvelope({
          permissionDecisions: canonicalDecisions({
            read,
            execution,
          }),
        }),
        NOW,
      );
      assert.equal(
        truth.state,
        'BLOCKED',
        `${profileClass}.${field} must block`,
      );
      assert.equal(truth.reasonCodes.length > 0, true);
      assertNoAuthority(truth);
    }
  }
});

test('read key is read-only and execution key is Spot-only without read capability', () => {
  const cases = [
    canonicalDecisions({
      read: readProfile({
        permissions: permissionPayload({
          enableReading: true,
          enableSpotAndMarginTrading: true,
        }),
      }),
    }),
    canonicalDecisions({
      execution: executionProfile({
        permissions: permissionPayload({
          enableReading: true,
          enableSpotAndMarginTrading: true,
        }),
      }),
    }),
    canonicalDecisions({
      execution: executionProfile({
        permissions: permissionPayload(),
      }),
    }),
  ];
  for (const permissionDecisions of cases) {
    const truth = projectM0SpotPermissionTruth(
      permissionEnvelope({ permissionDecisions }),
      NOW,
    );
    assert.equal(truth.state, 'BLOCKED');
    assertNoAuthority(truth);
  }
});

test('combined profile, non-Spot posture, bad egress, abnormal account and API lock are blocked', () => {
  const combined = canonicalDecisions({
    execution: executionProfile({ profileId: READ_PROFILE }),
  });
  const combinedTruth = projectM0SpotPermissionTruth(
    permissionEnvelope({ permissionDecisions: combined }),
    NOW,
  );
  assert.equal(combinedTruth.state, 'BLOCKED');
  assert.equal(
    combinedTruth.reasonCodes.includes('COMBINED_PROFILE_BLOCKED'),
    true,
  );

  const cases = [
    canonicalDecisions({
      posture: 'USDM_NEW_EXPOSURE',
      read: readProfile({
        usdmDualSidePosition: false,
        usdmMultiAssetsMargin: false,
      }),
      execution: executionProfile({
        permissions: permissionPayload({ enableFutures: true }),
        usdmDualSidePosition: false,
        usdmMultiAssetsMargin: false,
      }),
    }),
    canonicalDecisions({
      read: readProfile({ deployedEgressMatch: false }),
    }),
    canonicalDecisions({
      execution: executionProfile({ accountStatus: 'ABNORMAL' }),
    }),
    canonicalDecisions({
      execution: executionProfile({ apiTradingLocked: true }),
    }),
    canonicalDecisions({
      read: readProfile({
        permissions: permissionPayload({
          enableReading: true,
          ipRestrict: false,
        }),
      }),
    }),
  ];
  for (const permissionDecisions of cases) {
    const truth = projectM0SpotPermissionTruth(
      permissionEnvelope({ permissionDecisions }),
      NOW,
    );
    assert.equal(truth.state, 'BLOCKED');
    assertNoAuthority(truth);
  }
});

test('account canTrade evidence is bound to the read profile, account, permission revision and current time', () => {
  const cases = [
    [{ canTrade: false }, 'ACCOUNT_CAN_TRADE_FALSE'],
    [{ profileId: EXECUTION_PROFILE }, 'ACCOUNT_CAN_TRADE_BINDING_MISMATCH'],
    [{ accountRealmId: 'account-realm-other' }, 'ACCOUNT_CAN_TRADE_BINDING_MISMATCH'],
    [{ accountFingerprintRef: 'account-fingerprint-other' }, 'ACCOUNT_CAN_TRADE_BINDING_MISMATCH'],
    [{ permissionRevision: 'read-permission-revision-other' }, 'ACCOUNT_CAN_TRADE_BINDING_MISMATCH'],
    [{ observedAtMs: NOW + 1 }, 'ACCOUNT_CAN_TRADE_EVIDENCE_FROM_FUTURE'],
    [{ validUntilMs: NOW }, 'ACCOUNT_CAN_TRADE_EVIDENCE_NOT_CURRENT'],
  ];
  for (const [accountCanTradeEvidence, reason] of cases) {
    const truth = projectM0SpotPermissionTruth(
      permissionEnvelope({ accountCanTradeEvidence }),
      NOW,
    );
    assert.equal(truth.state, 'BLOCKED');
    assert.equal(truth.reasonCodes.includes(reason), true);
    assertNoAuthority(truth);
  }
});

test('execution signer evidence is bound to the execution profile, account, permission revision, fingerprint and current time', () => {
  const cases = [
    [{ endpointClass: 'USER_DATA' }, 'EXECUTION_SIGNER_BINDING_MISMATCH'],
    [{ profileId: READ_PROFILE }, 'EXECUTION_SIGNER_BINDING_MISMATCH'],
    [{ accountRealmId: 'account-realm-other' }, 'EXECUTION_SIGNER_BINDING_MISMATCH'],
    [{ accountFingerprintRef: 'account-fingerprint-other' }, 'EXECUTION_SIGNER_BINDING_MISMATCH'],
    [{ permissionRevision: 'execution-permission-revision-other' }, 'EXECUTION_SIGNER_BINDING_MISMATCH'],
    [{ observedAtMs: NOW + 1 }, 'EXECUTION_SIGNER_EVIDENCE_FROM_FUTURE'],
    [{ validUntilMs: NOW }, 'EXECUTION_SIGNER_EVIDENCE_NOT_CURRENT'],
  ];
  for (const [executionSignerEvidence, reason] of cases) {
    const truth = projectM0SpotPermissionTruth(
      permissionEnvelope({ executionSignerEvidence }),
      NOW,
    );
    assert.equal(truth.state, 'BLOCKED');
    assert.equal(truth.reasonCodes.includes(reason), true);
    assertNoAuthority(truth);
  }

  assert.throws(
    () => projectM0SpotPermissionTruth(
      permissionEnvelope({
        executionSignerEvidence: {
          signerFingerprint: 'sha256:not-a-fingerprint',
        },
      }),
      NOW,
    ),
    /fingerprint/u,
  );
});

test('read signer evidence is independently bound to USER_DATA and can never share the execution fingerprint', () => {
  const cases = [
    [{ endpointClass: 'TRADE' }, 'READ_SIGNER_BINDING_MISMATCH'],
    [{ profileId: EXECUTION_PROFILE }, 'READ_SIGNER_BINDING_MISMATCH'],
    [{ accountRealmId: 'account-realm-other' }, 'READ_SIGNER_BINDING_MISMATCH'],
    [{ accountFingerprintRef: 'account-fingerprint-other' }, 'READ_SIGNER_BINDING_MISMATCH'],
    [{ permissionRevision: 'read-permission-revision-other' }, 'READ_SIGNER_BINDING_MISMATCH'],
    [{ observedAtMs: NOW + 1 }, 'READ_SIGNER_EVIDENCE_FROM_FUTURE'],
    [{ validUntilMs: NOW }, 'READ_SIGNER_EVIDENCE_NOT_CURRENT'],
    [
      { signerFingerprint: EXECUTION_SIGNER_FINGERPRINT },
      'COMBINED_SIGNER_FINGERPRINT_BLOCKED',
    ],
  ];
  for (const [readSignerEvidence, reason] of cases) {
    const truth = projectM0SpotPermissionTruth(
      permissionEnvelope({ readSignerEvidence }),
      NOW,
    );
    assert.equal(truth.state, 'BLOCKED');
    assert.equal(truth.reasonCodes.includes(reason), true);
    assertNoAuthority(truth);
  }
});

test('accessor-backed and proxied envelopes are rejected without invoking user code', () => {
  let getterCalls = 0;
  const accessor = permissionEnvelope();
  Object.defineProperty(accessor, 'schema', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return M0_SPOT_PERMISSION_ENVELOPE_SCHEMA;
    },
  });
  assert.throws(
    () => projectM0SpotPermissionTruth(accessor, NOW),
    /private evidence/u,
  );
  assert.equal(getterCalls, 0);

  let trapCalls = 0;
  const proxy = new Proxy(permissionEnvelope(), {
    getPrototypeOf() {
      trapCalls += 1;
      return Object.prototype;
    },
  });
  assert.throws(
    () => projectM0SpotPermissionTruth(proxy, NOW),
    /private evidence/u,
  );
  assert.equal(trapCalls, 0);
});
