#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBasisFlatnessResult,
  verifyBasisFlatness,
} from '../../../dist/foundation/reconciliation/basisFlatness.js';
import {
  deriveStateRevisionId,
} from '../../../dist/foundation/contracts/identity.js';

const NOW_MS = 1_800_000_000_000;
const ACCEPTED_REVISION_TS = NOW_MS - 5_000;
const STATE_REVISION = 17;
const PLAN_ID = 'plan_basis_exact';
const STATE_REVISION_ID = deriveStateRevisionId({
  scope: `execution:${PLAN_ID}`,
  revision: STATE_REVISION,
});
const MAX_AGE_MS = 60_000;

const CLIENT_ORDER_IDS = Object.freeze({
  SPOT_OPEN: 'basis-spot-open-0',
  PERP_OPEN: 'basis-perp-open-0',
  PERP_CLOSE: 'basis-perp-close-0',
  SPOT_CLOSE: 'basis-spot-close-0',
});

const CLOSE_ATTEMPT_CLIENT_ORDER_IDS = Object.freeze({
  PERP_CLOSE: Object.freeze([
    'basis-perp-close-0',
    'basis-perp-close-1',
    'basis-perp-close-2',
    'basis-perp-close-3',
  ]),
  SPOT_CLOSE: Object.freeze([
    'basis-spot-close-0',
    'basis-spot-close-1',
    'basis-spot-close-2',
    'basis-spot-close-3',
  ]),
});

const ORDER_SHAPES = Object.freeze({
  SPOT_OPEN: Object.freeze({
    venue: 'BINANCE_SPOT',
    side: 'BUY',
    reduceOnly: false,
  }),
  PERP_OPEN: Object.freeze({
    venue: 'BINANCE_USDM',
    side: 'SELL',
    reduceOnly: false,
  }),
  PERP_CLOSE: Object.freeze({
    venue: 'BINANCE_USDM',
    side: 'BUY',
    reduceOnly: true,
  }),
  SPOT_CLOSE: Object.freeze({
    venue: 'BINANCE_SPOT',
    side: 'SELL',
    reduceOnly: false,
  }),
});

function deepFreeze(value, seen = new Set()) {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function') ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function metadata(overrides = {}) {
  return {
    sourceId: overrides.sourceId ?? 'basis-flatness.synthetic',
    authority: overrides.authority ?? 'SYNTHETIC_TEST',
    completeness: overrides.completeness ?? 'COMPLETE',
    sourceTimeMs: overrides.sourceTimeMs ?? NOW_MS - 1,
    receivedAtMs: overrides.receivedAtMs ?? NOW_MS,
    maxAgeMs: overrides.maxAgeMs ?? MAX_AGE_MS,
  };
}

function plan(overrides = {}) {
  return {
    planId: overrides.planId ?? PLAN_ID,
    bindingId: overrides.bindingId ?? 'binding_basis_exact',
    termsFingerprint: overrides.termsFingerprint ?? 'terms_basis_exact',
    accountId: overrides.accountId ?? 'account_basis_exact',
    symbol: overrides.symbol ?? 'BTCUSDT',
    acceptedRevisionTs:
      overrides.acceptedRevisionTs ?? ACCEPTED_REVISION_TS,
    stateRevision: overrides.stateRevision ?? STATE_REVISION,
    stateRevisionId: overrides.stateRevisionId ?? STATE_REVISION_ID,
    direction: overrides.direction ?? 'LONG_SPOT_SHORT_PERP',
    positionMode: overrides.positionMode ?? 'ONE_WAY',
    clientOrderIds: overrides.clientOrderIds ?? { ...CLIENT_ORDER_IDS },
    closeAttemptClientOrderIds:
      overrides.closeAttemptClientOrderIds ?? {
        PERP_CLOSE: [...CLOSE_ATTEMPT_CLIENT_ORDER_IDS.PERP_CLOSE],
        SPOT_CLOSE: [...CLOSE_ATTEMPT_CLIENT_ORDER_IDS.SPOT_CLOSE],
      },
    actionAuthority: overrides.actionAuthority ?? 'NONE_RECORD_ONLY',
    riskAuthority: overrides.riskAuthority ?? 'NONE',
    sendEligible: overrides.sendEligible ?? false,
  };
}

function order(step, overrides = {}) {
  const identity = plan();
  const attempt = overrides.attempt ?? 0;
  return {
    step,
    attempt,
    planId: overrides.planId ?? identity.planId,
    bindingId: overrides.bindingId ?? identity.bindingId,
    termsFingerprint:
      overrides.termsFingerprint ?? identity.termsFingerprint,
    accountId: overrides.accountId ?? identity.accountId,
    symbol: overrides.symbol ?? identity.symbol,
    acceptedRevisionTs:
      overrides.acceptedRevisionTs ?? identity.acceptedRevisionTs,
    stateRevision: overrides.stateRevision ?? identity.stateRevision,
    stateRevisionId:
      overrides.stateRevisionId ?? identity.stateRevisionId,
    venue: overrides.venue ?? ORDER_SHAPES[step].venue,
    side: overrides.side ?? ORDER_SHAPES[step].side,
    reduceOnly: overrides.reduceOnly ?? ORDER_SHAPES[step].reduceOnly,
    clientOrderId:
      overrides.clientOrderId ??
      (step === 'PERP_CLOSE' || step === 'SPOT_CLOSE'
        ? CLOSE_ATTEMPT_CLIENT_ORDER_IDS[step][attempt]
        : CLIENT_ORDER_IDS[step]),
    status: overrides.status ?? 'FILLED',
    submittedQuantityExact:
      overrides.submittedQuantityExact ?? '0.3',
    cumulativeFilledQuantityExact:
      overrides.cumulativeFilledQuantityExact ?? '0.3',
    ambiguous: overrides.ambiguous ?? false,
    terminalObservedAtMs: overrides.terminalObservedAtMs ?? NOW_MS - 2,
  };
}

function position(venue, overrides = {}) {
  const identity = plan();
  return {
    venue,
    accountId: overrides.accountId ?? identity.accountId,
    symbol: overrides.symbol ?? identity.symbol,
    acceptedRevisionTs:
      overrides.acceptedRevisionTs ?? identity.acceptedRevisionTs,
    stateRevision: overrides.stateRevision ?? identity.stateRevision,
    stateRevisionId:
      overrides.stateRevisionId ?? identity.stateRevisionId,
    positionMode:
      overrides.positionMode ??
      (venue === 'BINANCE_SPOT' ? 'CASH' : 'ONE_WAY'),
    baselineSignedBaseQuantityExact:
      overrides.baselineSignedBaseQuantityExact ??
      (venue === 'BINANCE_SPOT' ? '1' : '-0.4'),
    currentSignedBaseQuantityExact:
      overrides.currentSignedBaseQuantityExact ??
      (venue === 'BINANCE_SPOT' ? '1' : '-0.4'),
    baselineMetadata:
      overrides.baselineMetadata ??
      metadata({
        sourceId:
          venue === 'BINANCE_SPOT'
            ? 'basis-flatness.synthetic.spot.baseline'
            : 'basis-flatness.synthetic.usdm.baseline',
        sourceTimeMs: ACCEPTED_REVISION_TS - 1,
        receivedAtMs: ACCEPTED_REVISION_TS,
      }),
    currentMetadata:
      overrides.currentMetadata ??
      metadata({
        sourceId:
          venue === 'BINANCE_SPOT'
            ? 'basis-flatness.synthetic.spot.current'
            : 'basis-flatness.synthetic.usdm.current',
      }),
  };
}

function input(overrides = {}) {
  return deepFreeze({
    nowMs: overrides.nowMs ?? NOW_MS,
    policy: overrides.policy ?? {
      maximumEvidenceAgeMs: MAX_AGE_MS,
    },
    plan: overrides.plan ?? plan(),
    evidence: overrides.evidence ?? {
      orders: {
        metadata: metadata({
          sourceId: 'basis-flatness.synthetic.orders',
        }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
}

function assertZeroAuthority(result) {
  assert.equal(result.authority, 'NONE');
  assert.equal(result.executionAuthority, 'NONE');
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(result.networkRequestsPerformed, 0);
  assert.equal(result.privateRequestsPerformed, 0);
  assert.equal(result.signedRequestsPerformed, 0);
  assert.equal(result.ordersPerformed, 0);
  assert.equal(result.sideEffectsPerformed, 0);
}

function assertDeepFrozen(value, path = 'result', seen = new Set()) {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function') ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      assertDeepFrozen(descriptor.value, `${path}.${String(key)}`, seen);
    }
  }
}

test('proves flat only from exact bound four-order and fresh baseline truth', () => {
  const result = verifyBasisFlatness(input());

  assert.equal(result.status, 'FLAT');
  assert.equal(result.flat, true);
  assert.equal(result.identity.planId, 'plan_basis_exact');
  assert.deepEqual(result.reasonCodes, ['EXACT_BASELINE_FLAT']);
  assert.deepEqual(result.exact, {
    spotOrderDeltaExact: '0',
    usdmOrderDeltaExact: '0',
    spotPositionDeltaExact: '0',
    usdmPositionDeltaExact: '0',
    spotOrderPositionDifferenceExact: '0',
    usdmOrderPositionDifferenceExact: '0',
  });
  assertZeroAuthority(result);
  assertDeepFrozen(result);
  assert.equal(isBasisFlatnessResult(result), true);
  assert.equal(isBasisFlatnessResult({ ...result }), false);
});

test('0.3 open and 0.1 first close preserve exact 0.2 residual before re-close', () => {
  const residualEvidence = {
    orders: {
      metadata: metadata({
        sourceId: 'basis-flatness.synthetic.orders.residual',
      }),
      records: [
        order('SPOT_OPEN'),
        order('PERP_OPEN'),
        order('PERP_CLOSE', {
          status: 'CANCELLED',
          cumulativeFilledQuantityExact: '0.1',
        }),
        order('SPOT_CLOSE', {
          status: 'EXPIRED',
          cumulativeFilledQuantityExact: '0.1',
        }),
      ],
    },
    positions: [
      position('BINANCE_SPOT', {
        currentSignedBaseQuantityExact: '1.2',
      }),
      position('BINANCE_USDM', {
        currentSignedBaseQuantityExact: '-0.6',
      }),
    ],
    ambiguities: [],
  };
  const residual = verifyBasisFlatness(input({ evidence: residualEvidence }));

  assert.equal(residual.status, 'NOT_FLAT');
  assert.equal(residual.flat, false);
  assert.equal(residual.exact.spotOrderDeltaExact, '0.2');
  assert.equal(residual.exact.usdmOrderDeltaExact, '-0.2');
  assert.equal(residual.exact.spotPositionDeltaExact, '0.2');
  assert.equal(residual.exact.usdmPositionDeltaExact, '-0.2');
  assert.notEqual(
    residual.exact.spotOrderDeltaExact,
    '0.19999999999999998',
  );

  const reclosed = verifyBasisFlatness(input({
    evidence: {
      orders: {
        metadata: metadata({
          sourceId: 'basis-flatness.synthetic.orders.reclosed',
        }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE', {
            status: 'CANCELLED',
            cumulativeFilledQuantityExact: '0.1',
          }),
          order('PERP_CLOSE', {
            attempt: 1,
            submittedQuantityExact: '0.2',
            cumulativeFilledQuantityExact: '0.2',
          }),
          order('SPOT_CLOSE', {
            status: 'CANCELLED',
            cumulativeFilledQuantityExact: '0.1',
          }),
          order('SPOT_CLOSE', {
            attempt: 1,
            submittedQuantityExact: '0.2',
            cumulativeFilledQuantityExact: '0.2',
          }),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  }));
  assert.equal(reclosed.status, 'FLAT');
  assert.equal(reclosed.exact.spotOrderDeltaExact, '0');
  assert.equal(reclosed.exact.usdmOrderDeltaExact, '0');

  const binary64ArtifactRetry = verifyBasisFlatness(input({
    evidence: {
      orders: {
        metadata: metadata({
          sourceId: 'basis-flatness.synthetic.orders.lossy-retry',
        }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE', {
            status: 'CANCELLED',
            cumulativeFilledQuantityExact: '0.1',
          }),
          order('PERP_CLOSE', {
            attempt: 1,
            submittedQuantityExact: '0.19999999999999998',
            cumulativeFilledQuantityExact: '0.19999999999999998',
          }),
          order('SPOT_CLOSE', {
            status: 'CANCELLED',
            cumulativeFilledQuantityExact: '0.1',
          }),
          order('SPOT_CLOSE', {
            attempt: 1,
            submittedQuantityExact: '0.2',
            cumulativeFilledQuantityExact: '0.2',
          }),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  }));
  assert.equal(binary64ArtifactRetry.status, 'BLOCKED');
  assert.deepEqual(
    binary64ArtifactRetry.reasonCodes,
    ['PERP_CLOSE_RECLOSE_RESIDUAL_NOT_EXACT'],
  );

  const wrongRetryIdentity = verifyBasisFlatness(input({
    evidence: {
      orders: {
        metadata: metadata({
          sourceId: 'basis-flatness.synthetic.orders.wrong-retry-id',
        }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE', {
            status: 'CANCELLED',
            cumulativeFilledQuantityExact: '0.1',
          }),
          order('PERP_CLOSE', {
            attempt: 1,
            clientOrderId: 'forged-perp-close-attempt-1',
            submittedQuantityExact: '0.2',
            cumulativeFilledQuantityExact: '0.2',
          }),
          order('SPOT_CLOSE', {
            status: 'EXPIRED',
            cumulativeFilledQuantityExact: '0.1',
          }),
          order('SPOT_CLOSE', {
            attempt: 1,
            submittedQuantityExact: '0.2',
            cumulativeFilledQuantityExact: '0.2',
          }),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  }));
  assert.equal(wrongRetryIdentity.status, 'BLOCKED');
  assert.deepEqual(
    wrongRetryIdentity.reasonCodes,
    ['PERP_CLOSE_ORDER_IDENTITY_CONFLICT'],
  );
  assertZeroAuthority(residual);
  assertZeroAuthority(reclosed);
  assertZeroAuthority(binary64ArtifactRetry);
  assertZeroAuthority(wrongRetryIdentity);
});

test('terminal order states enforce exact coherent cumulative-fill semantics', () => {
  const terminalCases = [
    {
      status: 'FILLED',
      fill: '0.1',
      code: 'SPOT_OPEN_FILLED_QUANTITY_CONFLICT',
    },
    {
      status: 'CANCELLED',
      fill: '0.3',
      code: 'SPOT_OPEN_CANCELLED_OR_EXPIRED_REMAINDER_REQUIRED',
    },
    {
      status: 'EXPIRED',
      fill: '0.3',
      code: 'SPOT_OPEN_CANCELLED_OR_EXPIRED_REMAINDER_REQUIRED',
    },
    {
      status: 'REJECTED',
      fill: '0.1',
      code: 'SPOT_OPEN_REJECTED_FILL_MUST_BE_ZERO',
    },
    {
      status: 'PROVEN_ABSENT',
      fill: '0.1',
      code: 'SPOT_OPEN_PROVEN_ABSENT_FILL_MUST_BE_ZERO',
    },
  ];

  for (const fixture of terminalCases) {
    const result = verifyBasisFlatness(input({
      evidence: {
        orders: {
          metadata: metadata(),
          records: [
            order('SPOT_OPEN', {
              status: fixture.status,
              cumulativeFilledQuantityExact: fixture.fill,
            }),
            order('PERP_OPEN'),
            order('PERP_CLOSE'),
            order('SPOT_CLOSE'),
          ],
        },
        positions: [
          position('BINANCE_SPOT'),
          position('BINANCE_USDM'),
        ],
        ambiguities: [],
      },
    }));
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasonCodes, [fixture.code]);
    assertZeroAuthority(result);
  }
});

test('baseline/current time proof and verifier-owned freshness ceiling fail closed', () => {
  const baselineAfterAcceptance = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT', {
          baselineMetadata: metadata({
            sourceId: 'basis-flatness.synthetic.spot.late-baseline',
            sourceTimeMs: ACCEPTED_REVISION_TS + 1,
            receivedAtMs: ACCEPTED_REVISION_TS + 1,
          }),
        }),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const currentBeforeTerminal = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT', {
          currentMetadata: metadata({
            sourceId: 'basis-flatness.synthetic.spot.pre-terminal-current',
            sourceTimeMs: NOW_MS - 3,
            receivedAtMs: NOW_MS - 1,
          }),
        }),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const hugeClaimCannotWidenPolicy = input({
    evidence: {
      orders: {
        metadata: metadata({
          sourceTimeMs: NOW_MS - MAX_AGE_MS - 1,
          maxAgeMs: Number.MAX_SAFE_INTEGER,
        }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const unboundedPolicy = input({
    policy: { maximumEvidenceAgeMs: 300_001 },
  });

  for (const fixture of [
    baselineAfterAcceptance,
    currentBeforeTerminal,
    hugeClaimCannotWidenPolicy,
  ]) {
    const result = verifyBasisFlatness(fixture);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.flat, false);
    assertZeroAuthority(result);
  }
  const policyResult = verifyBasisFlatness(unboundedPolicy);
  assert.equal(policyResult.status, 'BLOCKED');
  assert.equal(policyResult.flat, false);
  assertZeroAuthority(policyResult);
});

test('array lengths are rejected before sparse attacker-controlled allocation walks', () => {
  const hugeSparseOrders = [];
  hugeSparseOrders.length = 1_000_000_000;
  Object.freeze(hugeSparseOrders);
  const hugeOrders = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: hugeSparseOrders,
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });

  const hugeSparseCloseIds = [];
  hugeSparseCloseIds.length = 1_000_000_000;
  Object.freeze(hugeSparseCloseIds);
  const hugeCloseIds = input({
    plan: plan({
      closeAttemptClientOrderIds: {
        PERP_CLOSE: hugeSparseCloseIds,
        SPOT_CLOSE: [...CLOSE_ATTEMPT_CLIENT_ORDER_IDS.SPOT_CLOSE],
      },
    }),
  });
  const tooManyAmbiguities = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: Array.from({ length: 17 }, (_, index) => `ambiguity-${index}`),
    },
  });

  assert.equal(verifyBasisFlatness(hugeOrders).flat, false);
  assert.equal(verifyBasisFlatness(hugeCloseIds).status, 'BLOCKED');
  assert.equal(verifyBasisFlatness(tooManyAmbiguities).status, 'BLOCKED');
});

test('missing, non-terminal, ambiguous, stale, or incomplete evidence is never flat', () => {
  const missingOrder = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const nonTerminal = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN', { status: 'NEW' }),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const ambiguous = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: ['duplicate venue order identity'],
    },
  });
  const stale = input({
    evidence: {
      orders: {
        metadata: metadata({
          sourceTimeMs: NOW_MS - MAX_AGE_MS - 1,
          maxAgeMs: Number.MAX_SAFE_INTEGER,
        }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const incomplete = input({
    evidence: {
      orders: {
        metadata: metadata({ completeness: 'PARTIAL' }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });

  for (const fixture of [
    missingOrder,
    nonTerminal,
    ambiguous,
    stale,
    incomplete,
  ]) {
    const result = verifyBasisFlatness(fixture);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.flat, false);
    assertZeroAuthority(result);
  }
});

test('identity, revision, decimal, position-mode, and order-position conflict fail closed', () => {
  const wrongOrderId = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN', { clientOrderId: 'forged-order-id' }),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const staleRevision = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM', { stateRevision: STATE_REVISION - 1 }),
      ],
      ambiguities: [],
    },
  });
  const lossy = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN', {
            submittedQuantityExact: 0.3,
            cumulativeFilledQuantityExact: 0.3,
          }),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const hedgeMode = input({ plan: plan({ positionMode: 'HEDGE' }) });
  const forgedStateRevisionId = input({
    plan: plan({ stateRevisionId: 'rev_forged' }),
  });
  const mismatch = input({
    evidence: {
      orders: {
        metadata: metadata(),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT', {
          currentSignedBaseQuantityExact: '1.1',
        }),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });

  for (const fixture of [wrongOrderId, staleRevision, lossy, mismatch]) {
    const result = verifyBasisFlatness(fixture);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.flat, false);
    assertZeroAuthority(result);
  }
  const modeResult = verifyBasisFlatness(hedgeMode);
  assert.equal(modeResult.status, 'UNKNOWN');
  assert.equal(modeResult.flat, false);
  assertZeroAuthority(modeResult);
  const revisionIdResult = verifyBasisFlatness(forgedStateRevisionId);
  assert.equal(revisionIdResult.status, 'BLOCKED');
  assert.deepEqual(
    revisionIdResult.reasonCodes,
    ['STATE_REVISION_ID_NOT_DETERMINISTIC'],
  );
  assertZeroAuthority(revisionIdResult);
});

test('frozen accessors and Proxy evidence are rejected without invoking hostile code', () => {
  let getterReads = 0;
  const accessorInput = {
    nowMs: NOW_MS,
    policy: deepFreeze({ maximumEvidenceAgeMs: MAX_AGE_MS }),
    plan: deepFreeze(plan()),
  };
  Object.defineProperty(accessorInput, 'evidence', {
    enumerable: true,
    configurable: false,
    get() {
      getterReads += 1;
      throw new Error('getter must not run');
    },
  });
  Object.freeze(accessorInput);

  let proxyTraps = 0;
  const proxy = new Proxy(input(), {
    get() {
      proxyTraps += 1;
      throw new Error('get trap must not run');
    },
    getPrototypeOf() {
      proxyTraps += 1;
      throw new Error('prototype trap must not run');
    },
    ownKeys() {
      proxyTraps += 1;
      throw new Error('ownKeys trap must not run');
    },
  });

  const accessorResult = verifyBasisFlatness(accessorInput);
  const proxyResult = verifyBasisFlatness(proxy);
  assert.equal(getterReads, 0);
  assert.equal(proxyTraps, 0);
  assert.equal(accessorResult.status, 'BLOCKED');
  assert.equal(proxyResult.status, 'BLOCKED');
  assert.equal(accessorResult.flat, false);
  assert.equal(proxyResult.flat, false);

  const forgedProxyResult = new Proxy({}, {
    get() {
      proxyTraps += 1;
      throw new Error('brand guard must not inspect fields');
    },
  });
  assert.equal(isBasisFlatnessResult(forgedProxyResult), false);
  assert.equal(proxyTraps, 0);
});

test('mutable inputs and live/private evidence are out of scope and blocked', () => {
  const mutable = {
    nowMs: NOW_MS,
    policy: { maximumEvidenceAgeMs: MAX_AGE_MS },
    plan: plan(),
    evidence: {},
  };
  assert.equal(verifyBasisFlatness(mutable).status, 'BLOCKED');

  const privateEvidence = input({
    evidence: {
      orders: {
        metadata: metadata({ authority: 'LIVE_PRIVATE' }),
        records: [
          order('SPOT_OPEN'),
          order('PERP_OPEN'),
          order('PERP_CLOSE'),
          order('SPOT_CLOSE'),
        ],
      },
      positions: [
        position('BINANCE_SPOT'),
        position('BINANCE_USDM'),
      ],
      ambiguities: [],
    },
  });
  const result = verifyBasisFlatness(privateEvidence);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.flat, false);
  assertZeroAuthority(result);
});
