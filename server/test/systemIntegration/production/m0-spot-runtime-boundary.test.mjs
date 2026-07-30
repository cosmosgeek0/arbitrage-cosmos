import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M0_SPOT_PERMISSION_TRANSITIONS,
  calculateM0SpotReadinessDigest,
  projectM0SpotSourceReadinessCard,
} from '../../../dist/systemIntegration/evidence/m0SpotReadinessCard.js';
import {
  M0_SPOT_RUNTIME_BOUNDARY_SCHEMA,
  createM0SpotRuntimeBoundary,
  snapshotM0SpotRuntimeExecutionResult,
  validateM0SpotBlockedPermissionCard,
  validateM0SpotReadyCard,
} from '../../../dist/systemIntegration/production/m0SpotRuntimeBoundary.js';

const T0 = 1_900_000_000_000;
const REQUEST = Object.freeze({
  requestId: 'm0_req_0123456789abcdef0123456789abcdef',
  idempotencyKeyDigest:
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  operatorId: 'owner-account-4',
  cardDigest:
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ownerConfirmation: 'YES',
  action: 'EXECUTE_APPROVED_LIFECYCLE',
});

function runtimeReadyCard() {
  const source = projectM0SpotSourceReadinessCard(T0 - 100);
  const {
    readinessDigest: _readinessDigest,
    ...sourceWithoutDigest
  } = source;
  const withoutDigest = Object.freeze({
    ...sourceWithoutDigest,
    lifecycleCardDigest:
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    executableEntryEvidenceDigest:
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    disposition: 'READY_FOR_OWNER_GATE_2',
    gate2Ready: true,
    evidenceAuthority: 'RUNTIME_PRIVATE',
    ownerId: 'owner-account-4',
    validUntilMs: T0 + 4_900,
    revisionHost: Object.freeze({
      state: 'VERIFIED_CURRENT',
      revision: '0123456789abcdef0123456789abcdef01234567',
      hostId: 'runtime-host',
      bootId: 'boot-0000000000000001',
      processId: 'pid-4004',
    }),
    accountMode: Object.freeze({
      state: 'VERIFIED_CURRENT',
      accountId: 'account-4',
      accountType: 'SPOT',
      privateReadVerified: true,
      balancesRead: true,
      ordersRead: true,
      fillsRead: true,
      permissionRead: true,
    }),
    accountCanTrade: Object.freeze({
      state: 'VERIFIED_CURRENT',
      profileId: 'm0-read-profile',
      accountRealmId: 'account-4',
      accountFingerprintRef: 'account-fingerprint-4',
      permissionRevision: 'read-permissions-v1',
      value: true,
      observedAtMs: T0 - 100,
      validUntilMs: T0 + 4_900,
      evidenceRevision: 'account-can-trade-v1',
      minimumPermissionTransition: null,
    }),
    apiKeyPermissions: Object.freeze({
      state: 'VERIFIED_CURRENT',
      accountRealmId: 'account-4',
      accountFingerprintRef: 'account-fingerprint-4',
      evidenceDigest:
        'sha256:abababababababababababababababababababababababababababababababab',
      readProfile: Object.freeze({
        profileId: 'm0-read-profile',
        permissionRevision: 'read-permissions-v1',
        signerFingerprint:
          'sha256:bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc',
        signerRevision: 'read-signer-v1',
        observedAtMs: T0 - 100,
        validUntilMs: T0 + 4_900,
      }),
      executionProfile: Object.freeze({
        profileId: 'm0-execution-profile',
        permissionRevision: 'execution-permissions-v1',
        signerFingerprint:
          'sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        signerRevision: 'execution-signer-v1',
        observedAtMs: T0 - 100,
        validUntilMs: T0 + 4_900,
      }),
      readingEnabled: true,
      spotTradeEnabled: true,
      ipRestricted: true,
      withdrawalsEnabled: false,
      internalTransfersEnabled: false,
      universalTransfersEnabled: false,
      marginEnabled: false,
      futuresEnabled: false,
      vanillaOptionsEnabled: false,
      fixTradeEnabled: false,
      fixReadOnlyEnabled: false,
      portfolioMarginEnabled: false,
      observedAtMs: T0 - 100,
      validUntilMs: T0 + 4_900,
      evidenceRevision: 'api-key-permissions-v1',
    }),
    appExecutionArmed: Object.freeze({
      state: 'VERIFIED_CURRENT',
      current: false,
      proposed: 'ARM_EXACT_CARD_AFTER_OWNER_YES',
    }),
    venueRoutes: Object.freeze({
      ...source.venueRoutes,
      compositionState: 'VERIFIED_CURRENT',
    }),
    excludedCapabilities: Object.freeze({
      ...source.excludedCapabilities,
      state: 'VERIFIED_CURRENT',
    }),
    namedExecutor: Object.freeze({
      state: 'VERIFIED_CURRENT',
      executorId: 'm0-account-4-executor',
      hostId: 'runtime-host',
      bootId: 'boot-0000000000000001',
      processId: 'pid-4004',
      authority: 'EXACT_CARD_ONE_LIFECYCLE',
    }),
    order: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      allowlist: Object.freeze(['BTCUSDT']),
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'FOK',
      quoteAsset: 'USDT',
      price: '10000',
      quoteAmount: '10',
      baseQuantity: '0.001',
    }),
    limits: Object.freeze({
      maximumOrderNotionalQuote: '10',
      maximumSimultaneousExposureQuote: '10',
      maximumGrossLifecycleTurnoverQuote: '20',
      maximumLossQuote: '0.25',
      maximumExposureDurationMs: 60_000,
      maximumResidualDustNotionalQuote: '0.01',
      maximumSignedTestSubmissions: 1,
      maximumEntrySubmissions: 1,
      maximumEntryCancelSubmissions: 1,
      maximumFlattenSubmissions: 3,
      maximumFlattenCancelSubmissions: 3,
      maximumLifecycles: 1,
    }),
    filters: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbolStatus: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      spotTradingAllowed: true,
      minPrice: '0.01',
      maxPrice: '1000000',
      minNotional: '5',
      maxNotional: null,
      tickSize: '0.01',
      minQuantity: '0.000001',
      maxQuantity: '100',
      stepSize: '0.000001',
      pricePrecision: 2,
      quantityPrecision: 6,
      activeFilterTypes: Object.freeze([
        'PRICE_FILTER',
        'LOT_SIZE',
        'MIN_NOTIONAL',
      ]),
      unknownFilterTypes: Object.freeze([]),
      allActiveFiltersSatisfied: true,
      completeSnapshotDigest:
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      observedAtMs: T0 - 100,
      validUntilMs: T0 + 4_900,
      snapshotRevision: 'filters-v1',
    }),
    liquidity: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbol: 'BTCUSDT',
      classification: 'LIQUID',
      observedSpreadBps: '1',
      maximumSpreadBps: '5',
      observedDepthQuote: '1000',
      minimumDepthQuote: '20',
      evidenceDigest:
        'sha256:edededededededededededededededededededededededededededededededed',
      observedAtMs: T0 - 100,
      validUntilMs: T0 + 4_900,
      evidenceRevision: 'liquidity-v1',
    }),
    economics: Object.freeze({
      state: 'VERIFIED_CURRENT',
      makerRate: '0.001',
      takerRate: '0.001',
      feeChargingAsset: 'USDT',
      discountEnabled: false,
      expectedEntryFeeQuote: '0.01',
      expectedRecoveryFeeQuote: '0.01',
      totalFeeReserveQuote: '0.02',
      maximumSlippageQuote: '0.05',
      observedAtMs: T0 - 100,
      validUntilMs: T0 + 4_900,
      evidenceRevision: 'fees-v1',
    }),
    baseline: Object.freeze({
      state: 'VERIFIED_CURRENT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      baselineBaseQuantity: '0',
      baselineQuoteQuantity: '100',
      observedBaseDeltaQuantity: '0',
      observedQuoteDeltaQuantity: '0',
      exchangeBaseTolerance: '0.00000001',
      quoteQuantityTolerance: '0.01',
      openOrderCount: 0,
      unresolvedMutationCount: 0,
      matched: true,
      matchKind: 'EXACT',
      observedAtMs: T0 - 100,
      validUntilMs: T0 + 4_900,
      baselineRevision: 'baseline-v1',
    }),
    clientIdentity: Object.freeze({
      state: 'VERIFIED_CURRENT',
      ticketId: 'spt_0123456789abcdef0123456789abcdef',
      entryClientOrderId: 'm0_entry_0001',
      termsDigest: '0123456789abcdef0123456789abcdef',
      queryKey: 'origClientOrderId',
    }),
    validation: Object.freeze({
      state: 'VERIFIED_CURRENT',
      signedTestPassed: true,
      observedAtMs: T0 - 100,
      validUntilMs: T0 + 4_900,
      evidenceRevision: 'signed-test-v1',
    }),
    recovery: Object.freeze({
      ...source.recovery,
      state: 'VERIFIED_CURRENT',
      baselineRevision: 'baseline-v1',
      exchangeBaseTolerance: '0.00000001',
      quoteQuantityTolerance: '0.01',
      maximumResidualDustNotionalQuote: '0.01',
      feeReserveQuote: '0.02',
      maximumRecoveryDurationMs: 60_000,
    }),
    ledgerReconciliation: Object.freeze({
      ...source.ledgerReconciliation,
      state: 'VERIFIED_CURRENT',
      venueEqualsLocal: true,
    }),
    lifecycle: Object.freeze({
      ...source.lifecycle,
      state: 'VERIFIED_CURRENT',
    }),
    rollback: Object.freeze({
      state: 'VERIFIED_CURRENT',
      trigger: 'OWNER_ABORT_OR_PRE_ENTRY_GATE_FAILURE',
      targetState: 'DISARMED_KILL_ENGAGED',
      ownerId: 'owner-account-4',
      procedure:
        'runtime-config:m0-spot-execution=DISARMED;kill-switch=ENGAGED',
      configRevision: 'runtime-config-v1',
      evidenceRevision: 'rollback-v1',
      reversesMarketExposure: false,
    }),
    residualCondition: 'EXACT_ZERO_DELTA_BASELINE_VERIFIED',
    exactLimitation: null,
    ownerAction: 'YES',
  });
  return Object.freeze({
    ...withoutDigest,
    readinessDigest: calculateM0SpotReadinessDigest(withoutDigest),
  });
}

function blockedPermissionCard() {
  const ready = runtimeReadyCard();
  const {
    readinessDigest: _readinessDigest,
    ...readyWithoutDigest
  } = ready;
  const transition =
    M0_SPOT_PERMISSION_TRANSITIONS.EXECUTION_PROFILE_ONLY;
  const withoutDigest = Object.freeze({
    ...readyWithoutDigest,
    disposition: 'M0_BLOCKED_PERMISSION',
    gate2Ready: false,
    evidenceAuthority: 'RUNTIME_PRIVATE',
    accountCanTrade: Object.freeze({
      ...ready.accountCanTrade,
      minimumPermissionTransition: transition,
    }),
    apiKeyPermissions: Object.freeze({
      ...ready.apiKeyPermissions,
      spotTradeEnabled: false,
    }),
    appExecutionArmed: Object.freeze({
      ...ready.appExecutionArmed,
      proposed: 'REMAIN_DISARMED',
    }),
    exactLimitation:
      `M0_BLOCKED_PERMISSION: ${transition}. APP_EXECUTION_ARMED remains false; POST execution is closed.`,
    ownerAction: 'NO',
  });
  return Object.freeze({
    ...withoutDigest,
    readinessDigest: calculateM0SpotReadinessDigest(withoutDigest),
  });
}

function acceptedResult(cardDigest) {
  return Object.freeze({
    schema: M0_SPOT_RUNTIME_BOUNDARY_SCHEMA,
    ok: false,
    code: 'M0_LIFECYCLE_ACCEPTED',
    state: 'ARMED',
    cardDigest,
    ownerConfirmation: 'EXACT_CARD_ACKNOWLEDGED',
    queryBeforeRetry: true,
    blindResend: false,
    executionAuthorityReturned: 'NONE',
    effects: Object.freeze({
      privateCalls: 0,
      signatures: 0,
      transportCalls: 0,
      authorityConsumptions: 0,
      ledgerWrites: 0,
      orders: 0,
      moneyMutations: 0,
    }),
  });
}

test('exported pure validator lets executor and persistence recheck the complete §7 card', () => {
  const ready = runtimeReadyCard();
  assert.equal(
    validateM0SpotReadyCard(ready, ready.readinessDigest, T0),
    true,
  );
  assert.equal(
    validateM0SpotReadyCard(
      structuredClone(ready),
      ready.readinessDigest,
      T0,
    ),
    false,
    'reusable validation admits only a stable frozen card snapshot',
  );
  assert.equal(
    validateM0SpotReadyCard(
      ready,
      `sha256:${'0'.repeat(64)}`,
      T0,
    ),
    false,
  );
  const {
    readinessDigest: _readinessDigest,
    ...readyFields
  } = ready;
  const boundedDustFields = Object.freeze({
    ...readyFields,
    baseline: Object.freeze({
      ...ready.baseline,
      observedBaseDeltaQuantity: '0.00000001',
      observedQuoteDeltaQuantity: '0.01',
      matchKind: 'WITHIN_EXPLICIT_TOLERANCE',
    }),
    residualCondition: 'EXPLICIT_BOUNDED_DUST_BASELINE_VERIFIED',
  });
  const boundedDust = Object.freeze({
    ...boundedDustFields,
    readinessDigest:
      calculateM0SpotReadinessDigest(boundedDustFields),
  });
  assert.equal(
    validateM0SpotReadyCard(
      boundedDust,
      boundedDust.readinessDigest,
      T0,
    ),
    true,
  );
});

test('default production boundary is inert, disarmed, source-only, and cannot execute plain acknowledgement', async () => {
  let clockReads = 0;
  const boundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({
      nowMs() {
        clockReads += 1;
        return T0;
      },
    }),
  });
  assert.equal(clockReads, 0, 'construction has no effect');
  const card = await boundary.readReadinessCard();
  assert.equal(clockReads, 1);
  assert.equal(card.disposition, 'SOURCE_READY_NOT_RUNTIME_VERIFIED');
  assert.equal(card.gate2Ready, false);
  assert.equal(card.ownerAction, 'NO');
  assert.equal(card.appExecutionArmed.current, false);
  assert.deepEqual(card.order.allowlist, []);
  assert.equal(card.accountCanTrade.value, null);
  assert.equal(card.apiKeyPermissions.withdrawalsEnabled, null);
  assert.equal(card.apiKeyPermissions.internalTransfersEnabled, null);
  assert.equal(card.apiKeyPermissions.universalTransfersEnabled, null);
  assert.deepEqual(card.effects, {
    privateCalls: 0,
    signatures: 0,
    transportCalls: 0,
    authorityConsumptions: 0,
    ledgerWrites: 0,
    orders: 0,
    moneyMutations: 0,
  });

  const result = await boundary.executeApprovedLifecycle(REQUEST);
  assert.equal(result.code, 'M0_RUNTIME_NOT_CONFIGURED');
  assert.equal(result.state, 'DISARMED');
  assert.equal(result.ok, false);
  assert.equal(result.cardDigest, REQUEST.cardDigest);
  assert.equal(result.executionAuthorityReturned, 'NONE');
  assert.deepEqual(result.effects, card.effects);
  assert.equal(clockReads, 1, 'the inert execute branch does not inspect time');

  await assert.rejects(
    () => boundary.executeApprovedLifecycle({
      ...REQUEST,
      action: undefined,
    }),
    /approved-lifecycle input is invalid/,
  );
  await assert.rejects(
    () => boundary.executeApprovedLifecycle({
      ...REQUEST,
      ownerConfirmation: 'NO',
    }),
    /approved-lifecycle input is invalid/,
  );
  await assert.rejects(
    () => boundary.executeApprovedLifecycle({
      ...REQUEST,
      symbol: 'BTCUSDT',
    }),
    /approved-lifecycle input is invalid/,
    'direct callers cannot smuggle executable values around the HTTP route',
  );
});

test('GET preserves READY only with a composed executor and downgrades every unsupported YES projection', async () => {
  const ready = runtimeReadyCard();
  const validBoundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => ready }),
    executor: Object.freeze({
      execute: async () => {
        throw new Error('GET must not invoke executor');
      },
    }),
  });
  const displayedReady = await validBoundary.readReadinessCard();
  assert.deepEqual(displayedReady, ready);
  assert.notEqual(displayedReady, ready);
  assert.equal(Object.isFrozen(displayedReady), true);
  assert.equal(Object.isFrozen(displayedReady.apiKeyPermissions), true);

  const uncomposedBoundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => ready }),
  });
  const uncomposed = await uncomposedBoundary.readReadinessCard();
  assert.equal(uncomposed.disposition, 'SOURCE_READY_NOT_RUNTIME_VERIFIED');
  assert.equal(uncomposed.ownerAction, 'NO');
  assert.equal(uncomposed.namedExecutor.authority, 'NONE');

  const invalid = Object.freeze({
    ...ready,
    namedExecutor: Object.freeze({
      ...ready.namedExecutor,
      bootId: 'different-boot',
    }),
  });
  const invalidBoundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => invalid }),
    executor: Object.freeze({
      execute: async () => {
        throw new Error('invalid GET must not invoke executor');
      },
    }),
  });
  const downgraded = await invalidBoundary.readReadinessCard();
  assert.equal(downgraded.disposition, 'SOURCE_READY_NOT_RUNTIME_VERIFIED');
  assert.equal(downgraded.gate2Ready, false);
  assert.equal(downgraded.evidenceAuthority, 'SOURCE_ONLY');
  assert.equal(downgraded.ownerAction, 'NO');
  assert.equal(downgraded.lifecycleCardDigest, null);
  assert.equal(downgraded.executableEntryEvidenceDigest, null);
  assert.equal(downgraded.observedAtMs, T0);
  assert.notEqual(downgraded.readinessDigest, ready.readinessDigest);

  let getterCalls = 0;
  const accessor = { ...ready };
  Object.defineProperty(accessor, 'ownerAction', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'YES';
    },
  });
  const accessorBoundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => accessor }),
    executor: Object.freeze({
      execute: async () => {
        throw new Error('accessor GET must not invoke executor');
      },
    }),
  });
  const accessorDowngrade = await accessorBoundary.readReadinessCard();
  assert.equal(getterCalls, 0);
  assert.equal(accessorDowngrade.ownerAction, 'NO');
});

test('GET preserves only the exact zero-effect M0_BLOCKED_PERMISSION transition and POST stays closed', async () => {
  const blocked = blockedPermissionCard();
  assert.equal(validateM0SpotBlockedPermissionCard(blocked, T0), true);
  const uncomposed = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => blocked }),
  });
  const uncomposedRead = await uncomposed.readReadinessCard();
  assert.equal(
    uncomposedRead.disposition,
    'SOURCE_READY_NOT_RUNTIME_VERIFIED',
  );
  assert.equal(uncomposedRead.ownerAction, 'NO');

  let executorCalls = 0;
  const boundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => blocked }),
    executor: Object.freeze({
      async execute() {
        executorCalls += 1;
        throw new Error('permission-blocked card cannot execute');
      },
    }),
  });
  const displayed = await boundary.readReadinessCard();
  assert.deepEqual(displayed, blocked);
  assert.notEqual(displayed, blocked);
  assert.equal(displayed.disposition, 'M0_BLOCKED_PERMISSION');
  assert.equal(displayed.gate2Ready, false);
  assert.equal(displayed.appExecutionArmed.current, false);
  assert.equal(displayed.appExecutionArmed.proposed, 'REMAIN_DISARMED');
  assert.equal(
    displayed.accountCanTrade.minimumPermissionTransition,
    M0_SPOT_PERMISSION_TRANSITIONS.EXECUTION_PROFILE_ONLY,
  );
  assert.deepEqual(displayed.effects, projectM0SpotSourceReadinessCard(T0).effects);

  const result = await boundary.executeApprovedLifecycle({
    ...REQUEST,
    cardDigest: blocked.readinessDigest,
  });
  assert.equal(result.code, 'M0_CARD_NOT_READY');
  assert.equal(result.state, 'DISARMED');
  assert.equal(executorCalls, 0);

  for (const mutate of [
    (value) => {
      value.accountCanTrade.minimumPermissionTransition =
        M0_SPOT_PERMISSION_TRANSITIONS.ACCOUNT_ONLY;
    },
    (value) => {
      value.apiKeyPermissions.withdrawalsEnabled = true;
    },
    (value) => {
      value.appExecutionArmed.proposed = 'ARM_EXACT_CARD_AFTER_OWNER_YES';
    },
    (value) => {
      value.order.allowlist = ['BTCUSDT', 'ETHUSDT'];
    },
  ]) {
    const candidate = structuredClone(blocked);
    mutate(candidate);
    const {
      readinessDigest: _readinessDigest,
      ...candidateFields
    } = candidate;
    candidate.readinessDigest =
      calculateM0SpotReadinessDigest(candidateFields);
    const hostileBoundary = createM0SpotRuntimeBoundary({
      clock: Object.freeze({ nowMs: () => T0 }),
      readiness: Object.freeze({
        read: async () => Object.freeze(candidate),
      }),
    });
    assert.equal(
      (await hostileBoundary.readReadinessCard()).disposition,
      'SOURCE_READY_NOT_RUNTIME_VERIFIED',
    );
  }
});

test('runtime boundary passes the entire digest-verified server-held readiness card to the executor', async () => {
  const ready = runtimeReadyCard();
  const calls = [];
  const boundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => ready }),
    executor: Object.freeze({
      async execute(input) {
        calls.push(input);
        return acceptedResult(input.cardDigest);
      },
    }),
  });
  const request = Object.freeze({
    ...REQUEST,
    cardDigest: ready.readinessDigest,
  });
  assert.deepEqual(await boundary.readReadinessCard(), ready);
  const result = await boundary.executeApprovedLifecycle(request);
  assert.equal(result.code, 'M0_LIFECYCLE_ACCEPTED');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    ...request,
    lifecycleCardDigest: ready.lifecycleCardDigest,
    executableEntryEvidenceDigest: ready.executableEntryEvidenceDigest,
    readinessCard: ready,
  });
  assert.notEqual(calls[0].readinessCard, ready);
  assert.equal(Object.isFrozen(calls[0].readinessCard), true);
  assert.equal(
    Object.hasOwn(calls[0], 'symbol'),
    false,
    'HTTP cannot supply symbol, amount, ticket, signer, or action capability',
  );

  const wrongOwner = await boundary.executeApprovedLifecycle({
    ...request,
    operatorId: 'different-owner',
  });
  assert.equal(wrongOwner.code, 'M0_CARD_NOT_READY');
  assert.equal(wrongOwner.state, 'DISARMED');
  assert.equal(calls.length, 1);

  const wrongDigest = await boundary.executeApprovedLifecycle({
    ...request,
    cardDigest:
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  });
  assert.equal(wrongDigest.code, 'M0_CARD_NOT_READY');
  assert.equal(wrongDigest.state, 'DISARMED');
  assert.equal(wrongDigest.executionAuthorityReturned, 'NONE');
  assert.deepEqual(wrongDigest.effects, acceptedResult(request.cardDigest).effects);
  assert.equal(calls.length, 1);
});

test('executor output is an exact detached closed result before boundary return', async () => {
  const ready = runtimeReadyCard();
  const valid = acceptedResult(ready.readinessDigest);
  const detached =
    snapshotM0SpotRuntimeExecutionResult(valid, ready.readinessDigest);
  assert.deepEqual(detached, valid);
  assert.notEqual(detached, valid);
  assert.equal(Object.isFrozen(detached), true);
  assert.equal(Object.isFrozen(detached.effects), true);

  let getterCalls = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'state', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'ARMED';
    },
  });
  const hostile = [
    { ...valid, hiddenSubmitAuthority: true },
    { ...valid, ok: true },
    { ...valid, state: 'DISARMED_SAFE' },
    { ...valid, cardDigest: `sha256:${'0'.repeat(64)}` },
    {
      ...valid,
      effects: { ...valid.effects, orders: -1 },
    },
    {
      ...valid,
      effects: { ...valid.effects, secret: 1 },
    },
    {
      ...valid,
      code: 'M0_CARD_NOT_READY',
      state: 'DISARMED',
      effects: {
        ...valid.effects,
        orders: 1,
        moneyMutations: 1,
      },
    },
    {
      ...valid,
      code: 'M0_RUNTIME_NOT_CONFIGURED',
      state: 'DISARMED',
      effects: {
        ...valid.effects,
        ledgerWrites: 1,
      },
    },
    accessor,
    new Proxy(valid, {}),
  ];
  for (const output of hostile) {
    const boundary = createM0SpotRuntimeBoundary({
      clock: Object.freeze({ nowMs: () => T0 }),
      readiness: Object.freeze({ read: async () => ready }),
      executor: Object.freeze({ execute: async () => output }),
    });
    await assert.rejects(
      () => boundary.executeApprovedLifecycle({
        ...REQUEST,
        cardDigest: ready.readinessDigest,
      }),
      /executor result violated the closed runtime contract/u,
    );
  }
  assert.equal(getterCalls, 0);
});

test('runtime boundary rejects stale and tampered runtime cards without invoking the executor', async () => {
  const ready = runtimeReadyCard();
  let calls = 0;
  const executor = Object.freeze({
    async execute(input) {
      calls += 1;
      return acceptedResult(input.cardDigest);
    },
  });
  const staleWithoutDigest = Object.freeze({
    ...ready,
    readinessDigest: undefined,
    validUntilMs: T0 - 1,
  });
  const {
    readinessDigest: _omitted,
    ...staleFields
  } = staleWithoutDigest;
  const stale = Object.freeze({
    ...staleFields,
    readinessDigest: calculateM0SpotReadinessDigest(staleFields),
  });
  const staleBoundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => stale }),
    executor,
  });
  assert.equal(
    (await staleBoundary.executeApprovedLifecycle({
      ...REQUEST,
      cardDigest: stale.readinessDigest,
    })).code,
    'M0_CARD_NOT_READY',
  );

  const tampered = Object.freeze({
    ...ready,
    order: Object.freeze({ ...ready.order, quoteAmount: '10.01' }),
  });
  const tamperedBoundary = createM0SpotRuntimeBoundary({
    clock: Object.freeze({ nowMs: () => T0 }),
    readiness: Object.freeze({ read: async () => tampered }),
    executor,
  });
  assert.equal(
    (await tamperedBoundary.executeApprovedLifecycle({
      ...REQUEST,
      cardDigest: tampered.readinessDigest,
    })).code,
    'M0_CARD_NOT_READY',
  );
  assert.equal(calls, 0);
});

test('runtime boundary rejects incomplete or malformed required §7 fields without invoking the executor', async () => {
  const ready = runtimeReadyCard();
  let calls = 0;
  const executor = Object.freeze({
    async execute(input) {
      calls += 1;
      return acceptedResult(input.cardDigest);
    },
  });
  const cases = [
    [
      'missing exact executable entry evidence binding',
      { ...ready, executableEntryEvidenceDigest: null },
    ],
    [
      'digest-valid extra top-level capability',
      {
        ...ready,
        hiddenCapability: 'SEND_ANY_ORDER',
      },
    ],
    [
      'digest-valid extra nested permission capability',
      {
        ...ready,
        apiKeyPermissions: {
          ...ready.apiKeyPermissions,
          hiddenPermission: false,
        },
      },
    ],
    [
      'missing account can-trade observation',
      {
        ...ready,
        accountCanTrade: {
          ...ready.accountCanTrade,
          value: null,
        },
      },
    ],
    [
      'unsafe separate options permission',
      {
        ...ready,
        apiKeyPermissions: {
          ...ready.apiKeyPermissions,
          vanillaOptionsEnabled: true,
        },
      },
    ],
    [
      'Futures route becomes reachable from M0',
      {
        ...ready,
        excludedCapabilities: {
          ...ready.excludedCapabilities,
          futuresRoute: {
            access: 'ENABLED',
            route: '/fapi/v1/order',
          },
        },
      },
    ],
    [
      'excluded capabilities are not runtime-current',
      {
        ...ready,
        excludedCapabilities: {
          ...ready.excludedCapabilities,
          state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED',
        },
      },
    ],
    [
      'borrow authority appears in the Spot card',
      {
        ...ready,
        excludedCapabilities: {
          ...ready.excludedCapabilities,
          marginBorrow: {
            ...ready.excludedCapabilities.marginBorrow,
            borrowAuthority: 'PRESENT',
          },
        },
      },
    ],
    [
      'leverage value appears in the Spot card',
      {
        ...ready,
        excludedCapabilities: {
          ...ready.excludedCapabilities,
          leverage: {
            availability: 'AVAILABLE',
            value: 2,
          },
        },
      },
    ],
    [
      'read and execution signer fingerprints are not distinct',
      {
        ...ready,
        apiKeyPermissions: {
          ...ready.apiKeyPermissions,
          executionProfile: {
            ...ready.apiKeyPermissions.executionProfile,
            signerFingerprint:
              ready.apiKeyPermissions.readProfile.signerFingerprint,
          },
        },
      },
    ],
    [
      'execution signer evidence is stale',
      {
        ...ready,
        apiKeyPermissions: {
          ...ready.apiKeyPermissions,
          executionProfile: {
            ...ready.apiKeyPermissions.executionProfile,
            validUntilMs: T0,
          },
        },
      },
    ],
    [
      'executor boot differs from observed host boot',
      {
        ...ready,
        namedExecutor: {
          ...ready.namedExecutor,
          bootId: 'boot-0000000000000002',
        },
      },
    ],
    [
      'LIMIT price does not bind base and quote',
      {
        ...ready,
        order: { ...ready.order, price: '9999' },
      },
    ],
    [
      'LIMIT time-in-force differs from lifecycle FOK',
      {
        ...ready,
        order: { ...ready.order, timeInForce: 'GTC' },
      },
    ],
    [
      'canonical ticket terms are not exact 32 hex',
      {
        ...ready,
        clientIdentity: {
          ...ready.clientIdentity,
          termsDigest:
            'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        },
      },
    ],
    [
      'incomplete limits',
      { ...ready, limits: { ...ready.limits, maximumLossQuote: null } },
    ],
    [
      'quote dust ceiling is not exact',
      {
        ...ready,
        limits: {
          ...ready.limits,
          maximumResidualDustNotionalQuote: '0.02',
        },
      },
    ],
    [
      'malformed limits',
      {
        ...ready,
        limits: { ...ready.limits, maximumExposureDurationMs: 0.5 },
      },
    ],
    [
      'incomplete filters',
      {
        ...ready,
        filters: { ...ready.filters, snapshotRevision: null },
      },
    ],
    [
      'price precision is not the exact tick precision',
      {
        ...ready,
        filters: { ...ready.filters, pricePrecision: 8 },
      },
    ],
    [
      'quantity precision is not the exact step precision',
      {
        ...ready,
        filters: { ...ready.filters, quantityPrecision: 8 },
      },
    ],
    [
      'liquid classification lacks sufficient current depth',
      {
        ...ready,
        liquidity: {
          ...ready.liquidity,
          observedDepthQuote: '19.99',
        },
      },
    ],
    [
      'liquid classification exceeds bounded spread',
      {
        ...ready,
        liquidity: {
          ...ready.liquidity,
          observedSpreadBps: '5.01',
        },
      },
    ],
    [
      'liquidity evidence is for a different symbol',
      {
        ...ready,
        liquidity: {
          ...ready.liquidity,
          symbol: 'ETHUSDT',
        },
      },
    ],
    [
      'incomplete full filter set',
      {
        ...ready,
        filters: {
          ...ready.filters,
          unknownFilterTypes: ['UNREVIEWED_FILTER'],
        },
      },
    ],
    [
      'LIMIT price is off the current tick',
      {
        ...ready,
        order: {
          ...ready.order,
          price: '9999.999',
          quoteAmount: '9.999999',
        },
        limits: {
          ...ready.limits,
          maximumSimultaneousExposureQuote: '9.999999',
          maximumGrossLifecycleTurnoverQuote: '19.999998',
        },
      },
    ],
    [
      'base quantity is off the current step',
      {
        ...ready,
        order: {
          ...ready.order,
          price: '9999',
          baseQuantity: '0.0010001',
          quoteAmount: '9.9999999',
        },
        limits: {
          ...ready.limits,
          maximumSimultaneousExposureQuote: '9.9999999',
          maximumGrossLifecycleTurnoverQuote: '19.9999998',
        },
      },
    ],
    [
      'malformed economics',
      {
        ...ready,
        economics: {
          ...ready.economics,
          expectedEntryFeeQuote: '0.01e0',
        },
      },
    ],
    [
      'fee reserve does not cover entry and recovery fees',
      {
        ...ready,
        economics: {
          ...ready.economics,
          totalFeeReserveQuote: '0.01',
        },
      },
    ],
    [
      'baseline not matched',
      {
        ...ready,
        baseline: { ...ready.baseline, matched: null },
      },
    ],
    [
      'recovery tolerance not bound to baseline',
      {
        ...ready,
        recovery: {
          ...ready.recovery,
          exchangeBaseTolerance: '0.00000002',
        },
      },
    ],
    [
      'baseline and recovery tolerances exceed filter and fee bounds',
      {
        ...ready,
        baseline: {
          ...ready.baseline,
          exchangeBaseTolerance: '1',
          quoteQuantityTolerance: '100',
        },
        recovery: {
          ...ready.recovery,
          exchangeBaseTolerance: '1',
          quoteQuantityTolerance: '100',
        },
      },
    ],
    [
      'base tolerance equals one complete exchange step',
      {
        ...ready,
        baseline: {
          ...ready.baseline,
          exchangeBaseTolerance: ready.filters.stepSize,
        },
        recovery: {
          ...ready.recovery,
          exchangeBaseTolerance: ready.filters.stepSize,
        },
      },
    ],
    [
      'nonzero baseline delta is mislabeled exact',
      {
        ...ready,
        baseline: {
          ...ready.baseline,
          observedBaseDeltaQuantity: '0.00000001',
          matchKind: 'EXACT',
        },
      },
    ],
    [
      'incomplete executor',
      {
        ...ready,
        namedExecutor: { ...ready.namedExecutor, executorId: null },
      },
    ],
    [
      'malformed runtime revision',
      {
        ...ready,
        revisionHost: {
          ...ready.revisionHost,
          revision: 'candidate-exact-sha',
        },
      },
    ],
    [
      'placeholder rollback',
      {
        ...ready,
        rollback: {
          ...ready.rollback,
          procedure: null,
        },
      },
    ],
    ['incomplete card expiry', { ...ready, validUntilMs: null }],
    [
      'malformed card expiry',
      { ...ready, validUntilMs: T0 },
    ],
    [
      'unbounded card freshness',
      { ...ready, validUntilMs: T0 + 5_000 },
    ],
    [
      'IST timestamp not exact to observed milliseconds',
      {
        ...ready,
        observedTimestampIst: '2030-03-17T23:16:39+05:30',
      },
    ],
    [
      'malformed execution timing',
      {
        ...ready,
        timing: { ...ready.timing, requestTimeoutMs: 4_999 },
      },
    ],
  ];

  for (const [name, candidate] of cases) {
    const {
      readinessDigest: _readinessDigest,
      ...withoutDigest
    } = candidate;
    const invalid = Object.freeze({
      ...withoutDigest,
      readinessDigest: calculateM0SpotReadinessDigest(withoutDigest),
    });
    const boundary = createM0SpotRuntimeBoundary({
      clock: Object.freeze({ nowMs: () => T0 }),
      readiness: Object.freeze({ read: async () => invalid }),
      executor,
    });
    const result = await boundary.executeApprovedLifecycle({
      ...REQUEST,
      cardDigest: invalid.readinessDigest,
    });
    assert.equal(result.code, 'M0_CARD_NOT_READY', name);
    assert.equal(result.state, 'DISARMED', name);
    assert.equal(result.executionAuthorityReturned, 'NONE', name);
  }

  assert.equal(calls, 0);
});
