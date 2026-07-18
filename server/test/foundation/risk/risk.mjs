#!/usr/bin/env node
/**
 * Lane D — multi-leg risk evaluator proof.
 *
 * Run after `npm run build -w server`:
 *   node server/test/foundation/risk/risk.mjs
 *
 * ZERO network. Every timestamp and every item of evidence is injected.
 */
import { readFileSync } from 'node:fs';
import {
  CLOSE_BLOCKING_FAMILIES,
  deriveRiskIntentDigest,
  evaluateMultiLegRisk,
  isBlockingFamily,
  validatePlanIntent,
  validateRiskEvaluationInput,
  validateRiskPolicy,
} from '../../../dist/foundation/risk/index.js';

const results = [];

function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass) });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkByCode(verdict, code) {
  return verdict.checks.find((item) => item.code === code);
}

function codesWithStatus(verdict, status) {
  return verdict.checks.filter((item) => item.status === status).map((item) => item.code);
}

function expectStatus(name, input, code, status, allowed = undefined) {
  let verdict = null;
  let error = null;
  try {
    verdict = evaluateMultiLegRisk(input);
  } catch (caught) {
    error = caught;
  }
  check(`${name}: evaluates`, error === null, error?.message ?? '');
  check(
    `${name}: ${code}=${status}`,
    checkByCode(verdict ?? { checks: [] }, code)?.status === status,
    `got=${checkByCode(verdict ?? { checks: [] }, code)?.status ?? 'THREW'}`,
  );
  if (allowed !== undefined) {
    check(`${name}: allowed=${allowed}`, verdict?.allowed === allowed, `blocking=${verdict?.blockingCodes?.join(',') ?? 'THREW'}`);
  }
  return verdict;
}

const NOW = 1_900_000_000_000;
const UTC_DAY_MS = 86_400_000;
const DAY_START = Math.floor(NOW / UTC_DAY_MS) * UTC_DAY_MS;
const DAY_END = DAY_START + UTC_DAY_MS;
const SYMBOL = 'BTCUSDT';
const ACCOUNT = 'binance-primary';

function stamp(sourceId, overrides = {}) {
  return {
    sourceTimeMs: NOW - 10,
    receivedAtMs: NOW - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
    ...overrides,
  };
}

function filters(sourceId, venue) {
  return {
    venue,
    symbol: SYMBOL,
    minPrice: 1,
    maxPrice: 1_000,
    tickSize: 0.1,
    minQty: 0.1,
    maxQty: 100,
    stepSize: 0.1,
    minNotionalUsd: 5,
    maxNotionalUsd: 10_000,
    observedAt: stamp(sourceId),
  };
}

function marginHeadroom(positionBucket, availableMarginUsd = 1_000, scopeSymbol = null) {
  return {
    accountId: ACCOUNT,
    positionBucket,
    scopeSymbol,
    availableMarginUsd,
    observedAt: stamp(
      positionBucket === 'USDM_ONE_WAY'
        ? 'binance.usdm.account.margin'
        : 'binance.spot.margin.account',
    ),
  };
}

function allowedInput() {
  const intent = {
    planId: 'plan-risk-001',
    accountId: ACCOUNT,
    proposalRef: 'proposal-risk-001',
    riskClass: 'RISK_INCREASING',
    legs: [
      {
        legKey: 'SPOT_BUY',
        venue: 'BINANCE_SPOT',
        symbol: SYMBOL,
        side: 'BUY',
        intendedPrice: 100,
        intendedQty: 1,
        requiredPermission: 'SPOT',
        positionBucket: 'SPOT_CASH',
        estimatedRequiredMarginUsd: 0,
      },
      {
        legKey: 'PERP_SELL',
        venue: 'BINANCE_USDM',
        symbol: SYMBOL,
        side: 'SELL',
        intendedPrice: 100,
        intendedQty: 1,
        requiredPermission: 'FUTURES',
        positionBucket: 'USDM_ONE_WAY',
        estimatedRequiredMarginUsd: 100,
      },
    ],
    declaredMaxNakedDurationMs: 1_000,
    estimatedRequiredMarginUsd: 100,
    requiredBorrowUsd: 0,
  };
  const intentDigest = deriveRiskIntentDigest(intent);

  return {
    correlationId: 'corr_risk_001',
    nowMs: NOW,
    intent,
    proposal: {
      proposalId: intent.proposalRef,
      entryIntentDigest: intentDigest,
      lifecycle: 'OPEN',
      expiresAtMs: NOW + 10_000,
      observedAt: stamp('strategy.proposal'),
    },
    approval: {
      approvalId: 'approval-risk-001',
      subjectPlanId: intent.planId,
      authorizedRiskClass: intent.riskClass,
      intentDigest,
      grantedAtMs: NOW - 500,
      expiresAtMs: NOW + 10_000,
      observedAt: stamp('control.approval'),
    },
    killSwitch: {
      accountId: ACCOUNT,
      engaged: false,
      observedAt: stamp('control.kill-switch'),
      reason: null,
    },
    market: {
      legs: [
        {
          legKey: 'SPOT_BUY',
          venue: 'BINANCE_SPOT',
          symbol: SYMBOL,
          referencePrice: 100,
          observedAt: stamp('binance.spot.book'),
          spreadPct: 0.05,
          topDepthUsd: 10_000,
          filters: filters('binance.spot.filters', 'BINANCE_SPOT'),
        },
        {
          legKey: 'PERP_SELL',
          venue: 'BINANCE_USDM',
          symbol: SYMBOL,
          referencePrice: 100,
          observedAt: stamp('binance.usdm.book'),
          spreadPct: 0.05,
          topDepthUsd: 10_000,
          filters: filters('binance.usdm.filters', 'BINANCE_USDM'),
        },
      ],
      edgeIntentDigest: intentDigest,
      netEdgePct: 0.5,
      estimatedCostPct: 0.1,
      estimatedSlippagePct: 0.05,
      edgeObservedAt: stamp('strategy.edge'),
    },
    account: {
      accountId: ACCOUNT,
      permissions: {
        accountId: ACCOUNT,
        spot: true,
        margin: true,
        futures: true,
        observedAt: stamp('binance.account.permissions'),
      },
      spotInventory: [
        {
          accountId: ACCOUNT,
          symbol: SYMBOL,
          availableBaseQty: 10,
          availableQuoteUsd: 10_000,
          observedAt: stamp('binance.account.spot-inventory'),
        },
      ],
      exposures: {
        accountId: ACCOUNT,
        positionMode: 'ONE_WAY',
        positions: [],
        observedAt: stamp('binance.account.positions'),
      },
      marginHeadrooms: [marginHeadroom('USDM_ONE_WAY')],
      liquidations: [
        {
          legKey: 'PERP_SELL',
          accountId: ACCOUNT,
          venue: 'BINANCE_USDM',
          symbol: SYMBOL,
          intentDigest,
          projectedSignedBaseQty: -1,
          markPrice: 100,
          liquidationPrice: 150,
          observedAt: stamp('risk.liquidation-projection'),
        },
      ],
      dailyRealizedLossUsd: 0,
      dailyTradedNotionalUsd: 0,
      dailyPeriodStartMs: DAY_START,
      dailyPeriodEndMs: DAY_END,
      dailyStatsObservedAt: stamp('ledger.daily-stats'),
      openOrders: {
        total: 0,
        perSymbol: {},
        observedAt: stamp('binance.account.open-orders'),
      },
    },
    borrow: null,
    existingPlans: {
      accountId: ACCOUNT,
      plans: [],
      observedAt: stamp('coordinator.plan-registry'),
    },
    cooldown: {
      accountId: ACCOUNT,
      symbols: [SYMBOL],
      lastEntryAtMs: null,
      observedAt: stamp('coordinator.cooldown'),
    },
    policy: {
      verdictTtlMs: 5_000,
      minEvidenceAuthority: 'SYNTHETIC_TEST',
      maxSpotPerpSkewMs: 50,
      minLegNotionalUsd: 10,
      maxLegNotionalUsd: 200,
      maxGrossNotionalUsd: 400,
      maxHedgeRatioDeviationPct: 1,
      maxResidualDeltaUsd: 1,
      maxNakedDurationMs: 5_000,
      minNetEdgePct: 0.2,
      maxSpreadPct: 0.1,
      minTopDepthUsd: 1_000,
      maxSlippagePct: 0.1,
      marginHeadroomBufferPct: 10,
      minLiquidationDistancePct: 20,
      maxLiquidationReferenceDriftPct: 1,
      maxBorrowHourlyRatePct: 0.5,
      maxDailyLossUsd: 1_000,
      maxDailyNotionalUsd: 10_000,
      maxOpenOrdersPerSymbol: 5,
      maxTotalOpenOrders: 10,
      cooldownMs: 1_000,
    },
  };
}

function recoveryInput() {
  const input = allowedInput();
  input.intent.riskClass = 'RISK_REDUCING';
  input.intent.proposalRef = null;
  input.intent.legs[0].side = 'SELL';
  input.intent.legs[1].side = 'BUY';
  input.intent.legs[0].estimatedRequiredMarginUsd = 0;
  input.intent.legs[1].estimatedRequiredMarginUsd = 0;
  input.intent.estimatedRequiredMarginUsd = 0;
  input.approval.authorizedRiskClass = 'RISK_REDUCING';
  input.approval.intentDigest = deriveRiskIntentDigest(input.intent);
  input.killSwitch.engaged = true;
  input.killSwitch.reason = 'operator containment';
  input.account.liquidations[0].liquidationPrice = 50;
  input.account.exposures = {
    accountId: ACCOUNT,
    positionMode: 'ONE_WAY',
    positions: [
      {
        venue: 'BINANCE_SPOT',
        symbol: SYMBOL,
        positionBucket: 'SPOT_CASH',
        signedBaseQty: 1,
        observedAt: stamp('binance.spot.account.position'),
      },
      {
        venue: 'BINANCE_USDM',
        symbol: SYMBOL,
        positionBucket: 'USDM_ONE_WAY',
        signedBaseQty: -1,
        observedAt: stamp('binance.usdm.account.position'),
      },
    ],
    observedAt: stamp('binance.account.positions'),
  };
  return rebindIntent(input);
}

function rebindIntent(input) {
  const digest = deriveRiskIntentDigest(input.intent);
  if (input.approval && typeof input.approval === 'object') input.approval.intentDigest = digest;
  if (input.proposal && typeof input.proposal === 'object') input.proposal.entryIntentDigest = digest;
  if (input.market && typeof input.market === 'object') input.market.edgeIntentDigest = digest;
  if (Array.isArray(input.account?.liquidations)) {
    for (const liquidation of input.account.liquidations) {
      if (!liquidation || typeof liquidation !== 'object') continue;
      const leg = input.intent.legs.find((candidate) => candidate.legKey === liquidation.legKey);
      if (!leg) continue;
      const action = input.intent.legs
        .filter(
          (candidate) =>
            candidate.venue === leg.venue &&
            candidate.symbol === leg.symbol &&
            candidate.positionBucket === leg.positionBucket,
        )
        .reduce((sum, candidate) => sum + (candidate.side === 'BUY' ? 1 : -1) * candidate.intendedQty, 0);
      const position = Array.isArray(input.account?.exposures?.positions)
        ? input.account.exposures.positions.find(
            (candidate) =>
              candidate?.venue === leg.venue &&
              candidate?.symbol === leg.symbol &&
              candidate?.positionBucket === leg.positionBucket,
          )
        : null;
      const before = input.intent.riskClass === 'RISK_REDUCING' ? (position?.signedBaseQty ?? 0) : 0;
      liquidation.accountId = input.intent.accountId;
      liquidation.venue = leg.venue;
      liquidation.symbol = leg.symbol;
      liquidation.intentDigest = digest;
      liquidation.projectedSignedBaseQty = before + action;
    }
  }
  return input;
}

function borrowEntryInput() {
  const input = allowedInput();
  input.intent.legs[0].side = 'SELL';
  input.intent.legs[0].requiredPermission = 'MARGIN';
  input.intent.legs[0].positionBucket = 'MARGIN_CROSS';
  input.intent.legs[0].estimatedRequiredMarginUsd = 100;
  input.intent.legs[1].side = 'BUY';
  input.intent.estimatedRequiredMarginUsd = 200;
  input.intent.requiredBorrowUsd = 100;
  input.account.liquidations[0].liquidationPrice = 50;
  input.account.marginHeadrooms.push(marginHeadroom('MARGIN_CROSS'));
  input.borrow = {
    accountId: ACCOUNT,
    symbol: SYMBOL,
    positionBucket: 'MARGIN_CROSS',
    state: 'AVAILABLE',
    maxBorrowableUsd: 200,
    hourlyRatePct: 0.1,
    observedAt: stamp('binance.borrow'),
  };
  return rebindIntent(input);
}

// ---------------------------------------------------------------------------
section('1. complete allowed fixture and verdict contract');
{
  const input = allowedInput();
  const before = JSON.stringify(input);
  const verdict = evaluateMultiLegRisk(input);
  check('complete entry is allowed', verdict.allowed, `blocking=${verdict.blockingCodes.join(',')}`);
  check('complete entry is explicitly approved', verdict.decision === 'APPROVED' && verdict.requiredConfirmation === false);
  check('complete entry caps authority at the exact evaluated gross size', verdict.maxAllowedSize === 200);
  check('approved decisive inputs are frozen and ordered', Object.isFrozen(verdict.decisiveInputSnapshot) && verdict.decisiveInputSnapshot.checks[0]?.code === 'KILL_SWITCH');
  check('all required entry checks pass', verdict.checks.every((item) => item.status === 'PASS'), codesWithStatus(verdict, 'FAIL').join(','));
  check('injected evaluation time is preserved', verdict.evaluatedAt === NOW);
  check('expiry is clamped to the earliest evidence horizon', verdict.expiresAt === NOW + 990);
  check('verdict never outlives policy TTL', verdict.expiresAt <= NOW + input.policy.verdictTtlMs);
  check('input is not mutated', JSON.stringify(input) === before);
  check('verdict is frozen', Object.isFrozen(verdict));
  check('checks collection is frozen', Object.isFrozen(verdict.checks));
  check('blocking-code collection is frozen', Object.isFrozen(verdict.blockingCodes));
  check('every check object is frozen', verdict.checks.every(Object.isFrozen));
  check('check order starts with control and approval', verdict.checks.slice(0, 4).map((x) => x.code).join(',') === 'KILL_SWITCH,APPROVAL_PRESENT,APPROVAL_EXPIRY,APPROVAL_SCOPE');
  check('check order ends with coordinator gates', verdict.checks.slice(-3).map((x) => x.code).join(',') === 'DUPLICATE_ACTIVE_PLAN,OPEN_ORDER_LIMIT,COOLDOWN');
}

// ---------------------------------------------------------------------------
section('2. fail-closed unknown and stale evidence');
{
  const missing = allowedInput();
  missing.market = null;
  const unknownVerdict = evaluateMultiLegRisk(missing);
  check('missing market evidence blocks', !unknownVerdict.allowed);
  check('unknown blocking evidence needs review without override', unknownVerdict.decision === 'NEEDS_REVIEW' && unknownVerdict.requiredConfirmation === true && unknownVerdict.allowed === false);
  check('unknown decisive evidence cannot fabricate max size', unknownVerdict.maxAllowedSize === null);
  check('required unknown is retained as UNKNOWN', codesWithStatus(unknownVerdict, 'UNKNOWN').includes('EVIDENCE_AUTHORITY'));
  check('blocking UNKNOWN is listed', unknownVerdict.blockingCodes.includes('EVIDENCE_AUTHORITY'));
  check('unknown observed value stays null', checkByCode(unknownVerdict, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY')?.observed === null);
  check('unknown decisive snapshot preserves null and blocker order', unknownVerdict.decisiveInputSnapshot.checks.some((item) => item.code === 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY' && item.observed === null) && unknownVerdict.decisiveInputSnapshot.checks.map((item) => item.code).join(',') === unknownVerdict.blockingCodes.join(','));

  const stale = allowedInput();
  stale.market.legs[0].observedAt.sourceTimeMs = NOW - 1_001;
  const staleVerdict = evaluateMultiLegRisk(stale);
  check('stale evidence blocks', !staleVerdict.allowed);
  check('known blocking failure is explicitly rejected', staleVerdict.decision === 'REJECTED' && staleVerdict.requiredConfirmation === false);
  check('known rejection authorizes zero size', staleVerdict.maxAllowedSize === 0);
  check('stale leg is an explicit FAIL', checkByCode(staleVerdict, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY')?.status === 'FAIL');

  const partial = allowedInput();
  partial.market.legs[0].observedAt.completeness = 'PARTIAL';
  const partialVerdict = evaluateMultiLegRisk(partial);
  check('partial evidence blocks', !partialVerdict.allowed);
  check('partial leg stays UNKNOWN, never optimistic', checkByCode(partialVerdict, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY')?.status === 'UNKNOWN');
}

// ---------------------------------------------------------------------------
section('3. kill switch and strictly authorized risk-reducing recovery');
{
  const killedEntry = allowedInput();
  killedEntry.killSwitch.engaged = true;
  const entryVerdict = evaluateMultiLegRisk(killedEntry);
  check('engaged kill blocks a new entry', !entryVerdict.allowed);
  check('entry kill check is blocking FAIL', checkByCode(entryVerdict, 'KILL_SWITCH')?.status === 'FAIL' && checkByCode(entryVerdict, 'KILL_SWITCH')?.blocking === true);

  const recovery = recoveryInput();
  const recoveryVerdict = evaluateMultiLegRisk(recovery);
  check('engaged kill permits proven authorized close', recoveryVerdict.allowed, `blocking=${recoveryVerdict.blockingCodes.join(',')}`);
  check('recovery kill failure remains visible', checkByCode(recoveryVerdict, 'KILL_SWITCH')?.status === 'FAIL');
  check('recovery kill failure is non-blocking', checkByCode(recoveryVerdict, 'KILL_SWITCH')?.blocking === false);
  check('recovery scope must match exactly', checkByCode(recoveryVerdict, 'APPROVAL_SCOPE')?.status === 'PASS');
  check('recovery reduction proof passes', checkByCode(recoveryVerdict, 'RECOVERY_RISK_REDUCTION')?.status === 'PASS');

  const mislabeled = recoveryInput();
  mislabeled.account.exposures.positions[0].signedBaseQty = -1;
  mislabeled.account.exposures.positions[1].signedBaseQty = 1;
  const mislabeledVerdict = evaluateMultiLegRisk(mislabeled);
  check('mislabeled risk-increasing recovery is blocked', !mislabeledVerdict.allowed);
  check('mislabeled recovery fails reduction proof', checkByCode(mislabeledVerdict, 'RECOVERY_RISK_REDUCTION')?.status === 'FAIL');

  const wrongScope = recoveryInput();
  wrongScope.approval.authorizedRiskClass = 'RISK_INCREASING';
  const wrongScopeVerdict = evaluateMultiLegRisk(wrongScope);
  check('entry-scoped approval cannot authorize recovery exemption', !wrongScopeVerdict.allowed);
  check('wrong recovery scope is a blocking FAIL', checkByCode(wrongScopeVerdict, 'APPROVAL_SCOPE')?.status === 'FAIL' && checkByCode(wrongScopeVerdict, 'APPROVAL_SCOPE')?.blocking === true);

  const overshoot = recoveryInput();
  overshoot.intent.legs[0].intendedQty = 2;
  overshoot.intent.legs[1].intendedQty = 2;
  const overshootVerdict = evaluateMultiLegRisk(rebindIntent(overshoot));
  check('close that crosses through flat is blocked', !overshootVerdict.allowed);
  check('overshoot fails strict reduction proof', checkByCode(overshootVerdict, 'RECOVERY_RISK_REDUCTION')?.status === 'FAIL');
}

// ---------------------------------------------------------------------------
section('4. exact numeric boundaries');
{
  const exact = allowedInput();
  exact.policy.maxLegNotionalUsd = 100;
  exact.policy.maxGrossNotionalUsd = 200;
  exact.policy.maxHedgeRatioDeviationPct = 0;
  exact.policy.maxResidualDeltaUsd = 0;
  exact.policy.maxNakedDurationMs = 1_000;
  exact.policy.minNetEdgePct = 0.5;
  exact.policy.maxSpreadPct = 0.05;
  exact.policy.minTopDepthUsd = 10_000;
  exact.policy.maxSlippagePct = 0.05;
  exact.policy.maxDailyNotionalUsd = 200;
  exact.policy.maxOpenOrdersPerSymbol = 2;
  exact.policy.maxTotalOpenOrders = 2;
  exact.policy.minLiquidationDistancePct = 50;
  const verdict = evaluateMultiLegRisk(exact);
  const boundaryCodes = [
    'LEG_NOTIONAL_SPOT_BUY',
    'LEG_NOTIONAL_PERP_SELL',
    'MAX_GROSS_NOTIONAL',
    'HEDGE_RATIO_TOLERANCE',
    'RESIDUAL_DELTA',
    'MAX_NAKED_DURATION',
    'NET_EDGE',
    'SPREAD',
    'DEPTH',
    'SLIPPAGE',
    'LIQUIDATION_DISTANCE',
    'DAILY_NOTIONAL_LIMIT',
    'OPEN_ORDER_LIMIT',
  ];
  check('inclusive boundaries allow', verdict.allowed, `blocking=${verdict.blockingCodes.join(',')}`);
  check('every inclusive boundary reports PASS', boundaryCodes.every((code) => checkByCode(verdict, code)?.status === 'PASS'));

  const approvalExpiry = allowedInput();
  approvalExpiry.approval.expiresAtMs = NOW;
  check('approval expires exactly at now', checkByCode(evaluateMultiLegRisk(approvalExpiry), 'APPROVAL_EXPIRY')?.status === 'FAIL');

  const proposalExpiry = allowedInput();
  proposalExpiry.proposal.expiresAtMs = NOW;
  check('proposal expires exactly at now', checkByCode(evaluateMultiLegRisk(proposalExpiry), 'PROPOSAL_EXPIRY')?.status === 'FAIL');

  const dailyLoss = allowedInput();
  dailyLoss.account.dailyRealizedLossUsd = dailyLoss.policy.maxDailyLossUsd;
  check('daily loss blocks exactly at cap', checkByCode(evaluateMultiLegRisk(dailyLoss), 'DAILY_LOSS_LIMIT')?.status === 'FAIL');

  const cooldown = allowedInput();
  cooldown.cooldown.lastEntryAtMs = NOW - cooldown.policy.cooldownMs;
  check('cooldown passes exactly at elapsed boundary', checkByCode(evaluateMultiLegRisk(cooldown), 'COOLDOWN')?.status === 'PASS');
}

// ---------------------------------------------------------------------------
section('5. malformed nested evidence never throws');
{
  const cases = [
    ['kill switch timestamp', (x) => { x.killSwitch.observedAt = { broken: true }; }],
    ['approval fields', (x) => { x.approval = { approvalId: 7, observedAt: [] }; }],
    ['proposal fields', (x) => { x.proposal = { proposalId: {}, observedAt: 'bad', expiresAtMs: {} }; }],
    ['market leg rows', (x) => { x.market.legs = [null, 7, { legKey: 'SPOT_BUY', venue: {}, observedAt: [] }]; }],
    ['edge values', (x) => { x.market.netEdgePct = {}; x.market.edgeObservedAt = []; }],
    ['permission values', (x) => { x.account.permissions = { spot: {}, margin: [], futures: 'yes', observedAt: {} }; }],
    ['liquidation rows', (x) => { x.account.liquidations = [null, { legKey: 'PERP_SELL', markPrice: {}, liquidationPrice: [], observedAt: {} }]; }],
    ['daily statistics', (x) => { x.account.dailyRealizedLossUsd = {}; x.account.dailyStatsObservedAt = []; }],
    ['open-order map', (x) => { x.account.openOrders = { total: {}, perSymbol: [], observedAt: {} }; }],
    ['borrow evidence', (x) => { x.intent.requiredBorrowUsd = 10; x.borrow = { state: {}, maxBorrowableUsd: [], hourlyRatePct: {}, observedAt: [] }; }],
    ['existing plans', (x) => { x.existingPlans = { plans: [null, 7, {}], observedAt: [] }; }],
    ['cooldown evidence', (x) => { x.cooldown = { lastEntryAtMs: {}, observedAt: [] }; }],
  ];
  for (const [name, mutate] of cases) {
    const input = allowedInput();
    mutate(input);
    let verdict = null;
    let error = null;
    try {
      verdict = evaluateMultiLegRisk(input);
    } catch (caught) {
      error = caught;
    }
    check(`${name}: evaluator does not throw`, error === null, error?.message ?? '');
    check(`${name}: malformed evidence fails closed`, verdict !== null && verdict.allowed === false);
  }

  const irrelevantExposure = allowedInput();
  irrelevantExposure.account.exposures = {
    accountId: ACCOUNT,
    positionMode: 'ONE_WAY',
    positions: [null],
    observedAt: stamp('binance.account.positions'),
  };
  let irrelevantError = null;
  let irrelevantVerdict = null;
  try {
    irrelevantVerdict = evaluateMultiLegRisk(irrelevantExposure);
  } catch (caught) {
    irrelevantError = caught;
  }
  check('irrelevant malformed recovery evidence does not throw during entry', irrelevantError === null);
  check('entry does not inspect recovery-only position rows', irrelevantVerdict?.allowed === true);
}

// ---------------------------------------------------------------------------
section('6. boundary validation and blocking-family law');
{
  check('valid intent has no issues', validatePlanIntent(allowedInput().intent).length === 0);
  check('valid policy has no issues', validateRiskPolicy(allowedInput().policy).length === 0);
  check('valid full input has no structural issues', validateRiskEvaluationInput(allowedInput()).length === 0);
  check('every family blocks risk-increasing actions', [
    'KILL_SWITCH',
    'APPROVAL_PRESENT',
    'NET_EDGE',
    'MARGIN_HEADROOM',
    'BORROW_AVAILABILITY',
    'COOLDOWN',
  ].every((family) => isBlockingFamily(family, 'RISK_INCREASING')));
  check('close-critical families are frozen', Object.isFrozen(CLOSE_BLOCKING_FAMILIES));
  check('recovery proof stays close-blocking', CLOSE_BLOCKING_FAMILIES.includes('RECOVERY_RISK_REDUCTION'));
  check('kill switch is deliberately not close-blocking', !CLOSE_BLOCKING_FAMILIES.includes('KILL_SWITCH'));

  const malformedIntent = allowedInput();
  malformedIntent.intent.legs[0].intendedQty = Number.NaN;
  let threw = false;
  try {
    evaluateMultiLegRisk(malformedIntent);
  } catch (error) {
    threw = error instanceof TypeError && error.message.includes('intent.legs[0].intendedQty');
  }
  check('malformed intent is rejected as programmer error', threw);
}

// ---------------------------------------------------------------------------
section('7. control, approval, proposal, identity, and authority isolation');
{
  const killMissing = allowedInput();
  killMissing.killSwitch = null;
  expectStatus('entry missing kill state', killMissing, 'KILL_SWITCH', 'UNKNOWN', false);

  const killStale = allowedInput();
  killStale.killSwitch.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('entry stale kill state', killStale, 'KILL_SWITCH', 'FAIL', false);

  const killPartial = allowedInput();
  killPartial.killSwitch.observedAt.completeness = 'PARTIAL';
  expectStatus('entry partial kill state', killPartial, 'KILL_SWITCH', 'UNKNOWN', false);

  const killFuture = allowedInput();
  killFuture.killSwitch.observedAt.sourceTimeMs = NOW + 2_001;
  expectStatus('entry future kill state', killFuture, 'KILL_SWITCH', 'FAIL', false);

  const killWrongAccount = allowedInput();
  killWrongAccount.killSwitch.accountId = 'other-account';
  expectStatus('kill state subject mismatch', killWrongAccount, 'KILL_SWITCH', 'FAIL', false);

  const approvalMissing = allowedInput();
  approvalMissing.approval = null;
  expectStatus('approval missing', approvalMissing, 'APPROVAL_PRESENT', 'UNKNOWN', false);

  const approvalStale = allowedInput();
  approvalStale.approval.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('approval stale', approvalStale, 'APPROVAL_PRESENT', 'FAIL', false);

  const approvalPartial = allowedInput();
  approvalPartial.approval.observedAt.completeness = 'PARTIAL';
  expectStatus('approval partial', approvalPartial, 'APPROVAL_PRESENT', 'UNKNOWN', false);

  const approvalFutureEvidence = allowedInput();
  approvalFutureEvidence.approval.observedAt.sourceTimeMs = NOW + 2_001;
  expectStatus('approval evidence from future', approvalFutureEvidence, 'APPROVAL_PRESENT', 'FAIL', false);

  const approvalWrongPlan = allowedInput();
  approvalWrongPlan.approval.subjectPlanId = 'plan-other';
  expectStatus('approval subject mismatch', approvalWrongPlan, 'APPROVAL_PRESENT', 'FAIL', false);

  const approvalImpossibleChronology = allowedInput();
  approvalImpossibleChronology.approval.grantedAtMs = NOW - 1;
  expectStatus('approval observed before grant', approvalImpossibleChronology, 'APPROVAL_PRESENT', 'FAIL', false);

  const approvalWrongDigest = allowedInput();
  approvalWrongDigest.approval.intentDigest = 'riskint_wrong';
  expectStatus('approval semantic intent mismatch', approvalWrongDigest, 'APPROVAL_SCOPE', 'FAIL', false);

  const approvalMissingDigest = allowedInput();
  approvalMissingDigest.approval.intentDigest = null;
  expectStatus('approval semantic binding missing', approvalMissingDigest, 'APPROVAL_SCOPE', 'UNKNOWN', false);

  const approvalBadWindow = allowedInput();
  approvalBadWindow.approval.expiresAtMs = approvalBadWindow.approval.grantedAtMs;
  expectStatus('approval expiry not after grant', approvalBadWindow, 'APPROVAL_EXPIRY', 'FAIL', false);

  const proposalMissing = allowedInput();
  proposalMissing.proposal = null;
  expectStatus('proposal missing', proposalMissing, 'PROPOSAL_PRESENT', 'UNKNOWN', false);

  const proposalStale = allowedInput();
  proposalStale.proposal.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('proposal stale', proposalStale, 'PROPOSAL_PRESENT', 'FAIL', false);

  const proposalPartial = allowedInput();
  proposalPartial.proposal.observedAt.completeness = 'PARTIAL';
  expectStatus('proposal partial', proposalPartial, 'PROPOSAL_PRESENT', 'UNKNOWN', false);

  const proposalFuture = allowedInput();
  proposalFuture.proposal.observedAt.sourceTimeMs = NOW + 2_001;
  expectStatus('proposal evidence from future', proposalFuture, 'PROPOSAL_PRESENT', 'FAIL', false);

  const proposalWrongId = allowedInput();
  proposalWrongId.proposal.proposalId = 'proposal-other';
  expectStatus('proposal subject mismatch', proposalWrongId, 'PROPOSAL_PRESENT', 'FAIL', false);

  const proposalWrongDigest = allowedInput();
  proposalWrongDigest.proposal.entryIntentDigest = 'riskint_wrong';
  expectStatus('proposal semantic intent mismatch', proposalWrongDigest, 'PROPOSAL_PRESENT', 'FAIL', false);

  const proposalClosed = allowedInput();
  proposalClosed.proposal.lifecycle = 'CLOSED';
  expectStatus('proposal is not open', proposalClosed, 'PROPOSAL_PRESENT', 'FAIL', false);

  const proposalNoExpiry = allowedInput();
  proposalNoExpiry.proposal.expiresAtMs = null;
  expectStatus('proposal expiry unknown', proposalNoExpiry, 'PROPOSAL_EXPIRY', 'UNKNOWN', false);

  const lowAuthority = allowedInput();
  lowAuthority.policy.minEvidenceAuthority = 'RECORDED_REPLAY';
  expectStatus('authority below policy floor', lowAuthority, 'EVIDENCE_AUTHORITY', 'FAIL', false);

  const unavailableAuthority = allowedInput();
  unavailableAuthority.market.legs[0].observedAt.authority = 'UNAVAILABLE';
  expectStatus('authority explicitly unavailable', unavailableAuthority, 'EVIDENCE_AUTHORITY', 'UNKNOWN', false);

  const publicPrivateEvidence = allowedInput();
  publicPrivateEvidence.account.permissions.observedAt.authority = 'LIVE_PUBLIC';
  expectStatus('public authority cannot prove private permissions', publicPrivateEvidence, 'EVIDENCE_AUTHORITY', 'FAIL', false);

  const publicMarketEvidence = allowedInput();
  for (const row of publicMarketEvidence.market.legs) {
    row.observedAt.authority = 'LIVE_PUBLIC';
    row.filters.observedAt.authority = 'LIVE_PUBLIC';
  }
  publicMarketEvidence.market.edgeObservedAt.authority = 'DERIVED_LIVE';
  const publicMarketVerdict = evaluateMultiLegRisk(publicMarketEvidence);
  check(
    'public authority is valid for public market facts',
    publicMarketVerdict.allowed,
    `${publicMarketVerdict.blockingCodes.join(',')} ${checkByCode(publicMarketVerdict, 'EVIDENCE_AUTHORITY')?.detail ?? ''}`,
  );
}

// ---------------------------------------------------------------------------
section('8. recovery authorization, resources, exemptions, and topology laws');
{
  const noKill = recoveryInput();
  noKill.killSwitch = null;
  expectStatus('authorized recovery without kill evidence', noKill, 'KILL_SWITCH', 'UNKNOWN', true);

  const staleKill = recoveryInput();
  staleKill.killSwitch.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('authorized recovery with stale kill evidence', staleKill, 'KILL_SWITCH', 'FAIL', true);

  const missingExposure = recoveryInput();
  missingExposure.account.exposures = null;
  expectStatus('recovery missing exposure proof', missingExposure, 'RECOVERY_RISK_REDUCTION', 'UNKNOWN', false);

  const partialExposure = recoveryInput();
  partialExposure.account.exposures.observedAt.completeness = 'PARTIAL';
  expectStatus('recovery partial exposure proof', partialExposure, 'RECOVERY_RISK_REDUCTION', 'UNKNOWN', false);

  const staleExposure = recoveryInput();
  staleExposure.account.exposures.positions[0].observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('recovery stale position proof', staleExposure, 'RECOVERY_RISK_REDUCTION', 'FAIL', false);

  const duplicateExposure = recoveryInput();
  duplicateExposure.account.exposures.positions.push(clone(duplicateExposure.account.exposures.positions[0]));
  expectStatus('recovery duplicate position proof', duplicateExposure, 'RECOVERY_RISK_REDUCTION', 'UNKNOWN', false);

  const borrowUnknown = recoveryInput();
  borrowUnknown.intent.requiredBorrowUsd = null;
  rebindIntent(borrowUnknown);
  expectStatus('recovery required borrow is unknown', borrowUnknown, 'BORROW_AMOUNT', 'UNKNOWN', false);

  const borrowMissing = recoveryInput();
  borrowMissing.intent.legs[0].requiredPermission = 'MARGIN';
  borrowMissing.intent.legs[0].positionBucket = 'MARGIN_CROSS';
  borrowMissing.intent.requiredBorrowUsd = 100;
  rebindIntent(borrowMissing);
  expectStatus('recovery required borrow evidence missing', borrowMissing, 'BORROW_AVAILABILITY', 'UNKNOWN', false);

  const marginMissing = recoveryInput();
  marginMissing.intent.estimatedRequiredMarginUsd = 10;
  marginMissing.intent.legs[1].estimatedRequiredMarginUsd = 10;
  marginMissing.account.marginHeadrooms = null;
  rebindIntent(marginMissing);
  expectStatus('recovery required margin evidence missing', marginMissing, 'MARGIN_HEADROOM', 'UNKNOWN', false);

  const nakedUnknown = recoveryInput();
  nakedUnknown.intent.declaredMaxNakedDurationMs = null;
  rebindIntent(nakedUnknown);
  expectStatus('multi-leg recovery naked window unknown', nakedUnknown, 'MAX_NAKED_DURATION', 'UNKNOWN', false);

  const capExemption = recoveryInput();
  capExemption.policy.maxLegNotionalUsd = 50;
  capExemption.account.openOrders = {
    total: 8,
    perSymbol: { [SYMBOL]: 8 },
    observedAt: stamp('binance.account.open-orders'),
  };
  const capVerdict = evaluateMultiLegRisk(capExemption);
  check('proven close is not trapped by entry leg-notional cap', checkByCode(capVerdict, 'LEG_NOTIONAL_SPOT_BUY')?.status === undefined || checkByCode(capVerdict, 'LEG_NOTIONAL_SPOT_BUY')?.blocking === false);
  check('proven close retains over-cap leg diagnostic', capVerdict.checks.filter((item) => item.code.startsWith('LEG_NOTIONAL_')).every((item) => item.status === 'FAIL' && item.blocking === false));
  check('proven close retains open-order diagnostic', checkByCode(capVerdict, 'OPEN_ORDER_LIMIT')?.status === 'FAIL' && checkByCode(capVerdict, 'OPEN_ORDER_LIMIT')?.blocking === false);
  check('entry-only caps do not block proven close', capVerdict.allowed, capVerdict.blockingCodes.join(','));

  const singleClose = recoveryInput();
  singleClose.intent.legs = [singleClose.intent.legs[0]];
  singleClose.market.legs = [singleClose.market.legs[0]];
  singleClose.account.exposures.positions = [singleClose.account.exposures.positions[0]];
  singleClose.account.liquidations = [];
  rebindIntent(singleClose);
  const singleCloseVerdict = evaluateMultiLegRisk(singleClose);
  check('single-leg proven close is allowed', singleCloseVerdict.allowed, singleCloseVerdict.blockingCodes.join(','));
  check('single-leg close has explicit reduction proof', checkByCode(singleCloseVerdict, 'RECOVERY_RISK_REDUCTION')?.status === 'PASS');

  const hedgedToNaked = recoveryInput();
  hedgedToNaked.intent.legs = [hedgedToNaked.intent.legs[0]];
  hedgedToNaked.market.legs = [hedgedToNaked.market.legs[0]];
  hedgedToNaked.account.liquidations = [];
  rebindIntent(hedgedToNaked);
  expectStatus('hedged book cannot be unhedged as recovery', hedgedToNaked, 'RECOVERY_RISK_REDUCTION', 'FAIL', false);

  const residualHedge = recoveryInput();
  residualHedge.intent.legs = [residualHedge.intent.legs[0]];
  residualHedge.market.legs = [residualHedge.market.legs[0]];
  residualHedge.account.liquidations = [];
  residualHedge.account.exposures.positions[0].signedBaseQty = 2;
  residualHedge.account.exposures.positions[1].signedBaseQty = -1;
  rebindIntent(residualHedge);
  const hedgeVerdict = expectStatus('single-leg residual hedge reduces absolute delta', residualHedge, 'RECOVERY_RISK_REDUCTION', 'PASS', true);
  check('residual hedge remains inside strict recovery path', checkByCode(hedgeVerdict, 'APPROVAL_SCOPE')?.status === 'PASS');

  const singleEntry = allowedInput();
  singleEntry.intent.legs = [singleEntry.intent.legs[0]];
  check('single-leg risk-increasing entry is structurally rejected', validatePlanIntent(singleEntry.intent).some((issue) => issue.code === 'MULTI_LEG_ENTRY_REQUIRED'));

  const sameSideEntry = allowedInput();
  sameSideEntry.intent.legs[1].side = 'BUY';
  check('risk-increasing entry requires opposing sides', validatePlanIntent(sameSideEntry.intent).some((issue) => issue.code === 'OPPOSING_SIDES_REQUIRED'));
}

// ---------------------------------------------------------------------------
section('9. market, skew, permission, inventory, and venue-filter evidence');
{
  const duplicateLeg = allowedInput();
  duplicateLeg.market.legs.push(clone(duplicateLeg.market.legs[0]));
  expectStatus('duplicate market leg identity', duplicateLeg, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY', 'UNKNOWN', false);

  const wrongVenue = allowedInput();
  wrongVenue.market.legs[0].venue = 'BINANCE_USDM';
  expectStatus('market venue binding mismatch', wrongVenue, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY', 'FAIL', false);

  const wrongSymbol = allowedInput();
  wrongSymbol.market.legs[0].symbol = 'ETHUSDT';
  expectStatus('market symbol binding mismatch', wrongSymbol, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY', 'FAIL', false);

  const exactFresh = allowedInput();
  exactFresh.market.legs[0].observedAt.sourceTimeMs = NOW - 1_000;
  expectStatus('market evidence exactly at max age', exactFresh, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY', 'PASS');

  const futureMarket = allowedInput();
  futureMarket.market.legs[0].observedAt.sourceTimeMs = NOW + 2_001;
  expectStatus('market evidence beyond future tolerance', futureMarket, 'LEG_EVIDENCE_FRESHNESS_SPOT_BUY', 'FAIL', false);

  const exactSkew = allowedInput();
  exactSkew.market.legs[0].observedAt.sourceTimeMs = NOW - 10;
  exactSkew.market.legs[1].observedAt.sourceTimeMs = NOW - 60;
  expectStatus('spot-perp skew exactly at cap', exactSkew, 'SPOT_PERP_SKEW', 'PASS');

  const overSkew = allowedInput();
  overSkew.market.legs[0].observedAt.sourceTimeMs = NOW - 10;
  overSkew.market.legs[1].observedAt.sourceTimeMs = NOW - 61;
  expectStatus('spot-perp skew one millisecond over cap', overSkew, 'SPOT_PERP_SKEW', 'FAIL', false);

  const permissionsMissing = allowedInput();
  permissionsMissing.account.permissions = null;
  expectStatus('permission evidence missing', permissionsMissing, 'PERMISSION_POSTURE', 'UNKNOWN', false);

  const permissionsStale = allowedInput();
  permissionsStale.account.permissions.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('permission evidence stale', permissionsStale, 'PERMISSION_POSTURE', 'UNKNOWN', false);

  const permissionsPartial = allowedInput();
  permissionsPartial.account.permissions.observedAt.completeness = 'PARTIAL';
  expectStatus('permission evidence partial', permissionsPartial, 'PERMISSION_POSTURE', 'UNKNOWN', false);

  const permissionsFuture = allowedInput();
  permissionsFuture.account.permissions.observedAt.sourceTimeMs = NOW + 2_001;
  expectStatus('permission evidence from future', permissionsFuture, 'PERMISSION_POSTURE', 'UNKNOWN', false);

  const permissionsDenied = allowedInput();
  permissionsDenied.account.permissions.futures = false;
  expectStatus('required futures permission denied', permissionsDenied, 'PERMISSION_POSTURE', 'FAIL', false);

  const permissionsUnknown = allowedInput();
  permissionsUnknown.account.permissions.spot = null;
  expectStatus('required spot permission unknown', permissionsUnknown, 'PERMISSION_POSTURE', 'UNKNOWN', false);

  const permissionWrongAccount = allowedInput();
  permissionWrongAccount.account.permissions.accountId = 'other-account';
  expectStatus('permission account binding mismatch', permissionWrongAccount, 'PERMISSION_POSTURE', 'FAIL', false);

  const inventoryMissing = allowedInput();
  inventoryMissing.account.spotInventory = null;
  expectStatus('spot inventory missing', inventoryMissing, 'SPOT_INVENTORY', 'UNKNOWN', false);

  const inventoryStale = allowedInput();
  inventoryStale.account.spotInventory[0].observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('spot inventory stale', inventoryStale, 'SPOT_INVENTORY', 'UNKNOWN', false);

  const inventoryPartial = allowedInput();
  inventoryPartial.account.spotInventory[0].observedAt.completeness = 'PARTIAL';
  expectStatus('spot inventory partial', inventoryPartial, 'SPOT_INVENTORY', 'UNKNOWN', false);

  const inventoryFuture = allowedInput();
  inventoryFuture.account.spotInventory[0].observedAt.sourceTimeMs = NOW + 2_001;
  expectStatus('spot inventory from future', inventoryFuture, 'SPOT_INVENTORY', 'UNKNOWN', false);

  const inventoryWrongAccount = allowedInput();
  inventoryWrongAccount.account.spotInventory[0].accountId = 'other-account';
  expectStatus('spot inventory account mismatch', inventoryWrongAccount, 'SPOT_INVENTORY', 'UNKNOWN', false);

  const exactQuote = allowedInput();
  exactQuote.account.spotInventory[0].availableQuoteUsd = 100;
  expectStatus('spot BUY exact quote funding', exactQuote, 'SPOT_INVENTORY', 'PASS');

  const shortQuote = allowedInput();
  shortQuote.account.spotInventory[0].availableQuoteUsd = 99.99;
  expectStatus('spot BUY quote funding shortfall', shortQuote, 'SPOT_INVENTORY', 'FAIL', false);

  const exactBase = borrowEntryInput();
  exactBase.intent.legs[0].requiredPermission = 'SPOT';
  exactBase.intent.legs[0].positionBucket = 'SPOT_CASH';
  exactBase.intent.legs[0].estimatedRequiredMarginUsd = 0;
  exactBase.intent.estimatedRequiredMarginUsd = 100;
  exactBase.intent.requiredBorrowUsd = 0;
  exactBase.account.spotInventory[0].availableBaseQty = 1;
  rebindIntent(exactBase);
  expectStatus('spot SELL exact base inventory', exactBase, 'SPOT_INVENTORY', 'PASS');

  const shortBase = clone(exactBase);
  shortBase.account.spotInventory[0].availableBaseQty = 0.9;
  rebindIntent(shortBase);
  expectStatus('spot SELL base inventory shortfall', shortBase, 'SPOT_INVENTORY', 'FAIL', false);

  const filterMissing = allowedInput();
  filterMissing.market.legs[0].filters = null;
  expectStatus('symbol filters missing', filterMissing, 'SYMBOL_FILTERS_SPOT_BUY', 'UNKNOWN', false);

  const filterStale = allowedInput();
  filterStale.market.legs[0].filters.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('symbol filters stale', filterStale, 'SYMBOL_FILTERS_SPOT_BUY', 'UNKNOWN', false);

  const filterPartial = allowedInput();
  filterPartial.market.legs[0].filters.observedAt.completeness = 'PARTIAL';
  expectStatus('symbol filters partial', filterPartial, 'SYMBOL_FILTERS_SPOT_BUY', 'UNKNOWN', false);

  const filterFuture = allowedInput();
  filterFuture.market.legs[0].filters.observedAt.sourceTimeMs = NOW + 2_001;
  expectStatus('symbol filters from future', filterFuture, 'SYMBOL_FILTERS_SPOT_BUY', 'UNKNOWN', false);

  const filterWrongVenue = allowedInput();
  filterWrongVenue.market.legs[0].filters.venue = 'BINANCE_USDM';
  expectStatus('symbol-filter venue mismatch', filterWrongVenue, 'SYMBOL_FILTERS_SPOT_BUY', 'FAIL', false);

  const filterWrongSymbol = allowedInput();
  filterWrongSymbol.market.legs[0].filters.symbol = 'ETHUSDT';
  expectStatus('symbol-filter instrument mismatch', filterWrongSymbol, 'SYMBOL_FILTERS_SPOT_BUY', 'FAIL', false);

  const filterCases = [
    ['price below minimum', (x) => { x.market.legs[0].filters.minPrice = 101; }],
    ['price above maximum', (x) => { x.market.legs[0].filters.maxPrice = 99; }],
    ['price off tick', (x) => { x.market.legs[0].filters.tickSize = 0.3; }],
    ['quantity below minimum', (x) => { x.market.legs[0].filters.minQty = 1.1; }],
    ['quantity above maximum', (x) => { x.market.legs[0].filters.maxQty = 0.9; }],
    ['quantity off step', (x) => { x.market.legs[0].filters.stepSize = 0.3; }],
    ['notional below venue minimum', (x) => { x.market.legs[0].filters.minNotionalUsd = 101; }],
    ['notional above venue maximum', (x) => { x.market.legs[0].filters.maxNotionalUsd = 99; }],
  ];
  for (const [name, mutate] of filterCases) {
    const input = allowedInput();
    mutate(input);
    expectStatus(`spot filter ${name}`, input, 'SYMBOL_FILTERS_SPOT_BUY', 'FAIL', false);
  }

  const spotModulo = allowedInput();
  spotModulo.intent.legs[0].intendedQty = 0.15;
  spotModulo.market.legs[0].filters.minQty = 0.05;
  spotModulo.market.legs[0].filters.stepSize = 0.1;
  rebindIntent(spotModulo);
  expectStatus('spot step is anchored at zero', spotModulo, 'SYMBOL_FILTERS_SPOT_BUY', 'FAIL', false);

  const usdmOffset = allowedInput();
  usdmOffset.intent.legs[1].intendedQty = 0.15;
  usdmOffset.market.legs[1].filters.minQty = 0.05;
  usdmOffset.market.legs[1].filters.stepSize = 0.1;
  rebindIntent(usdmOffset);
  expectStatus('USD-M step honors minimum-relative rule', usdmOffset, 'SYMBOL_FILTERS_PERP_SELL', 'PASS');
}

// ---------------------------------------------------------------------------
section('10. notional, hedge, residual, and naked-duration numeric boundaries');
{
  const conservative = allowedInput();
  conservative.market.legs[0].referencePrice = 101;
  conservative.policy.maxLegNotionalUsd = 100;
  const conservativeVerdict = expectStatus('leg notional uses worse fresh reference', conservative, 'LEG_NOTIONAL_SPOT_BUY', 'FAIL', false);
  check('leg notional carries market evidence timestamp', checkByCode(conservativeVerdict, 'LEG_NOTIONAL_SPOT_BUY')?.evidenceTimestamp === NOW - 10);

  const legExactMin = allowedInput();
  legExactMin.policy.minLegNotionalUsd = 100;
  expectStatus('leg notional exact minimum', legExactMin, 'LEG_NOTIONAL_SPOT_BUY', 'PASS');

  const legBelowMin = allowedInput();
  legBelowMin.policy.minLegNotionalUsd = 100.01;
  expectStatus('leg notional below minimum', legBelowMin, 'LEG_NOTIONAL_SPOT_BUY', 'FAIL', false);

  const legExactMax = allowedInput();
  legExactMax.policy.maxLegNotionalUsd = 100;
  expectStatus('leg notional exact maximum', legExactMax, 'LEG_NOTIONAL_SPOT_BUY', 'PASS');

  const legOverMax = allowedInput();
  legOverMax.policy.maxLegNotionalUsd = 99.99;
  expectStatus('leg notional over maximum', legOverMax, 'LEG_NOTIONAL_SPOT_BUY', 'FAIL', false);

  const grossBelow = allowedInput();
  grossBelow.policy.maxGrossNotionalUsd = 199.99;
  expectStatus('gross notional over cap', grossBelow, 'MAX_GROSS_NOTIONAL', 'FAIL', false);

  const grossExact = allowedInput();
  grossExact.policy.maxGrossNotionalUsd = 200;
  const grossVerdict = expectStatus('gross notional exact cap', grossExact, 'MAX_GROSS_NOTIONAL', 'PASS');
  check('gross notional carries market evidence timestamp', checkByCode(grossVerdict, 'MAX_GROSS_NOTIONAL')?.evidenceTimestamp === NOW - 10);

  const grossUnknown = allowedInput();
  grossUnknown.market.legs[1].referencePrice = null;
  expectStatus('gross notional missing reference', grossUnknown, 'MAX_GROSS_NOTIONAL', 'UNKNOWN', false);

  const hedgeExact = allowedInput();
  hedgeExact.intent.legs[1].intendedQty = 0.5;
  hedgeExact.policy.maxHedgeRatioDeviationPct = 50;
  rebindIntent(hedgeExact);
  expectStatus('hedge ratio exact tolerance', hedgeExact, 'HEDGE_RATIO_TOLERANCE', 'PASS');

  const hedgeOver = clone(hedgeExact);
  hedgeOver.policy.maxHedgeRatioDeviationPct = 49.99;
  rebindIntent(hedgeOver);
  expectStatus('hedge ratio over tolerance', hedgeOver, 'HEDGE_RATIO_TOLERANCE', 'FAIL', false);

  const hedgeWithin = clone(hedgeExact);
  hedgeWithin.policy.maxHedgeRatioDeviationPct = 50.01;
  rebindIntent(hedgeWithin);
  expectStatus('hedge ratio below tolerance', hedgeWithin, 'HEDGE_RATIO_TOLERANCE', 'PASS');

  const residualExact = allowedInput();
  residualExact.market.legs[0].referencePrice = 110;
  residualExact.policy.maxResidualDeltaUsd = 10;
  const residualVerdict = expectStatus('residual delta exact cap', residualExact, 'RESIDUAL_DELTA', 'PASS');
  check('residual delta carries market evidence timestamp', checkByCode(residualVerdict, 'RESIDUAL_DELTA')?.evidenceTimestamp === NOW - 10);

  const residualOver = clone(residualExact);
  residualOver.policy.maxResidualDeltaUsd = 9.99;
  expectStatus('residual delta over cap', residualOver, 'RESIDUAL_DELTA', 'FAIL', false);

  const residualWithin = clone(residualExact);
  residualWithin.policy.maxResidualDeltaUsd = 10.01;
  expectStatus('residual delta below cap', residualWithin, 'RESIDUAL_DELTA', 'PASS');

  const nakedMissing = allowedInput();
  nakedMissing.intent.declaredMaxNakedDurationMs = null;
  rebindIntent(nakedMissing);
  expectStatus('entry naked duration missing', nakedMissing, 'MAX_NAKED_DURATION', 'UNKNOWN', false);

  const nakedExact = allowedInput();
  nakedExact.policy.maxNakedDurationMs = 1_000;
  expectStatus('naked duration exact ceiling', nakedExact, 'MAX_NAKED_DURATION', 'PASS');

  const nakedOver = allowedInput();
  nakedOver.policy.maxNakedDurationMs = 999;
  expectStatus('naked duration over ceiling', nakedOver, 'MAX_NAKED_DURATION', 'FAIL', false);
}

// ---------------------------------------------------------------------------
section('11. edge, cost, spread, depth, and slippage exact boundaries');
{
  for (const [label, value, expected] of [
    ['above', 0.5001, 'PASS'],
    ['exact', 0.5, 'PASS'],
    ['below', 0.4999, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.policy.minNetEdgePct = 0.5;
    input.market.netEdgePct = value;
    expectStatus(`net edge ${label} floor`, input, 'NET_EDGE', expected, expected === 'PASS');
  }

  for (const [label, value, expected] of [
    ['below', 0.0499, 'PASS'],
    ['exact', 0.05, 'PASS'],
    ['above', 0.0501, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.policy.maxSpreadPct = 0.05;
    input.market.legs[0].spreadPct = value;
    input.market.legs[1].spreadPct = value;
    expectStatus(`spread ${label} ceiling`, input, 'SPREAD', expected, expected === 'PASS');
  }

  for (const [label, value, expected] of [
    ['above', 10_001, 'PASS'],
    ['exact', 10_000, 'PASS'],
    ['below', 9_999, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.policy.minTopDepthUsd = 10_000;
    input.market.legs[0].topDepthUsd = value;
    input.market.legs[1].topDepthUsd = value;
    expectStatus(`depth ${label} floor`, input, 'DEPTH', expected, expected === 'PASS');
  }

  for (const [label, value, expected] of [
    ['below', 0.0499, 'PASS'],
    ['exact', 0.05, 'PASS'],
    ['above', 0.0501, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.policy.maxSlippagePct = 0.05;
    input.market.estimatedSlippagePct = value;
    expectStatus(`slippage ${label} ceiling`, input, 'SLIPPAGE', expected, expected === 'PASS');
  }

  const zeroCost = allowedInput();
  zeroCost.market.estimatedCostPct = 0;
  expectStatus('known zero cost is not unknown', zeroCost, 'COST_EVIDENCE', 'PASS', true);

  for (const [label, value] of [['missing', null], ['negative', -0.0001]]) {
    const input = allowedInput();
    input.market.estimatedCostPct = value;
    expectStatus(`${label} cost fails closed`, input, 'COST_EVIDENCE', 'UNKNOWN', false);
  }

  const staleEdge = allowedInput();
  staleEdge.market.edgeObservedAt.sourceTimeMs = NOW - 1_001;
  for (const code of ['NET_EDGE', 'COST_EVIDENCE', 'SLIPPAGE']) {
    expectStatus(`stale edge bundle fails closed for ${code}`, staleEdge, code, 'UNKNOWN', false);
  }

  const partialEdge = allowedInput();
  partialEdge.market.edgeObservedAt.completeness = 'PARTIAL';
  for (const code of ['NET_EDGE', 'COST_EVIDENCE', 'SLIPPAGE']) {
    expectStatus(`partial edge bundle fails closed for ${code}`, partialEdge, code, 'UNKNOWN', false);
  }

  const missingSpread = allowedInput();
  missingSpread.market.legs[0].spreadPct = null;
  expectStatus('missing spread is unknown', missingSpread, 'SPREAD', 'UNKNOWN', false);

  const missingDepth = allowedInput();
  missingDepth.market.legs[0].topDepthUsd = null;
  expectStatus('missing depth is unknown', missingDepth, 'DEPTH', 'UNKNOWN', false);

  const wrongEdgeBinding = allowedInput();
  wrongEdgeBinding.market.edgeIntentDigest = 'riskint_other';
  const wrongEdgeVerdict = expectStatus('edge bundle wrong intent binding', wrongEdgeBinding, 'NET_EDGE', 'FAIL', false);
  check('wrong edge binding also rejects cost', checkByCode(wrongEdgeVerdict, 'COST_EVIDENCE')?.status === 'FAIL');
  check('wrong edge binding also rejects slippage', checkByCode(wrongEdgeVerdict, 'SLIPPAGE')?.status === 'FAIL');

  const missingEdgeBinding = allowedInput();
  missingEdgeBinding.market.edgeIntentDigest = null;
  const missingEdgeVerdict = expectStatus('edge bundle missing intent binding', missingEdgeBinding, 'NET_EDGE', 'UNKNOWN', false);
  check('missing edge binding leaves cost unknown', checkByCode(missingEdgeVerdict, 'COST_EVIDENCE')?.status === 'UNKNOWN');
  check('missing edge binding leaves slippage unknown', checkByCode(missingEdgeVerdict, 'SLIPPAGE')?.status === 'UNKNOWN');
}

// ---------------------------------------------------------------------------
section('12. margin headroom and liquidation projection matrices');
{
  for (const [label, declared, expected] of [
    ['below derived minimum', 99, 'FAIL'],
    ['exact derived minimum', 100, 'PASS'],
    ['above derived minimum', 101, 'PASS'],
  ]) {
    const input = allowedInput();
    input.intent.estimatedRequiredMarginUsd = declared;
    input.intent.legs[1].estimatedRequiredMarginUsd = declared;
    rebindIntent(input);
    expectStatus(`margin declaration ${label}`, input, 'MARGIN_HEADROOM', expected, expected === 'PASS');
  }

  for (const [label, available, expected] of [
    ['below buffered need', 109.99, 'FAIL'],
    ['exact buffered need', 110, 'PASS'],
    ['above buffered need', 110.01, 'PASS'],
  ]) {
    const input = allowedInput();
    input.account.marginHeadrooms[0].availableMarginUsd = available;
    expectStatus(`margin available ${label}`, input, 'MARGIN_HEADROOM', expected, expected === 'PASS');
  }

  const missingDeclared = allowedInput();
  missingDeclared.intent.estimatedRequiredMarginUsd = null;
  missingDeclared.intent.legs[1].estimatedRequiredMarginUsd = null;
  rebindIntent(missingDeclared);
  expectStatus('missing declared margin', missingDeclared, 'MARGIN_HEADROOM', 'UNKNOWN', false);

  const falseZero = allowedInput();
  falseZero.intent.estimatedRequiredMarginUsd = 0;
  falseZero.intent.legs[1].estimatedRequiredMarginUsd = 0;
  rebindIntent(falseZero);
  expectStatus('leveraged entry cannot declare zero margin', falseZero, 'MARGIN_HEADROOM', 'FAIL', false);

  for (const [label, mutate] of [
    ['missing available margin', (input) => { input.account.marginHeadrooms[0].availableMarginUsd = null; }],
    ['missing margin timestamp', (input) => { input.account.marginHeadrooms[0].observedAt = null; }],
    ['stale margin timestamp', (input) => { input.account.marginHeadrooms[0].observedAt.sourceTimeMs = NOW - 1_001; }],
    ['partial margin snapshot', (input) => { input.account.marginHeadrooms[0].observedAt.completeness = 'PARTIAL'; }],
  ]) {
    const input = allowedInput();
    mutate(input);
    expectStatus(label, input, 'MARGIN_HEADROOM', 'UNKNOWN', false);
  }

  const aggregateMismatch = allowedInput();
  aggregateMismatch.intent.estimatedRequiredMarginUsd = 101;
  rebindIntent(aggregateMismatch);
  expectStatus('aggregate margin differs from per-leg sum', aggregateMismatch, 'MARGIN_HEADROOM', 'FAIL', false);

  const marginWrongAccount = allowedInput();
  marginWrongAccount.account.marginHeadrooms[0].accountId = 'other-account';
  expectStatus('margin row wrong account binding', marginWrongAccount, 'MARGIN_HEADROOM', 'FAIL', false);

  const marginWrongBucket = allowedInput();
  marginWrongBucket.account.marginHeadrooms[0].positionBucket = 'MARGIN_CROSS';
  expectStatus('margin row wrong product bucket', marginWrongBucket, 'MARGIN_HEADROOM', 'UNKNOWN', false);

  const duplicateMarginScope = allowedInput();
  duplicateMarginScope.account.marginHeadrooms.push(clone(duplicateMarginScope.account.marginHeadrooms[0]));
  expectStatus('duplicate margin scope rows', duplicateMarginScope, 'MARGIN_HEADROOM', 'UNKNOWN', false);

  const unrelatedMarginScope = allowedInput();
  unrelatedMarginScope.account.marginHeadrooms.push(marginHeadroom('MARGIN_CROSS', 0));
  expectStatus('unrelated margin bucket is not summed into USD-M headroom', unrelatedMarginScope, 'MARGIN_HEADROOM', 'PASS', true);

  for (const [label, liquidationPrice, expected] of [
    ['above floor', 150.01, 'PASS'],
    ['exact floor', 150, 'PASS'],
    ['below floor', 149.99, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.policy.minLiquidationDistancePct = 50;
    input.account.liquidations[0].liquidationPrice = liquidationPrice;
    expectStatus(`short liquidation distance ${label}`, input, 'LIQUIDATION_DISTANCE', expected, expected === 'PASS');
  }

  for (const [label, markPrice, expected] of [
    ['below drift cap', 100.99, 'PASS'],
    ['exact drift cap', 101, 'PASS'],
    ['above drift cap', 101.01, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.account.liquidations[0].markPrice = markPrice;
    input.account.liquidations[0].liquidationPrice = markPrice * 1.5;
    expectStatus(`liquidation reference drift ${label}`, input, 'LIQUIDATION_DISTANCE', expected, expected === 'PASS');
  }

  for (const [label, price, expected] of [
    ['correct side', 150, 'PASS'],
    ['at mark', 100, 'FAIL'],
    ['wrong side', 50, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.account.liquidations[0].liquidationPrice = price;
    expectStatus(`short liquidation ${label}`, input, 'LIQUIDATION_DISTANCE', expected, expected === 'PASS');
  }

  for (const [label, price, expected] of [
    ['correct side', 50, 'PASS'],
    ['at mark', 100, 'FAIL'],
    ['wrong side', 150, 'FAIL'],
  ]) {
    const input = borrowEntryInput();
    input.account.liquidations[0].liquidationPrice = price;
    expectStatus(`long liquidation ${label}`, input, 'LIQUIDATION_DISTANCE', expected, expected === 'PASS');
  }

  for (const [label, mutate, expected] of [
    ['missing projections', (input) => { input.account.liquidations = null; }, 'UNKNOWN'],
    ['missing liquidation price', (input) => { input.account.liquidations[0].liquidationPrice = null; }, 'UNKNOWN'],
    ['stale projection', (input) => { input.account.liquidations[0].observedAt.sourceTimeMs = NOW - 1_001; }, 'UNKNOWN'],
    ['partial projection', (input) => { input.account.liquidations[0].observedAt.completeness = 'PARTIAL'; }, 'UNKNOWN'],
    ['wrong account binding', (input) => { input.account.liquidations[0].accountId = 'other-account'; }, 'FAIL'],
    ['wrong venue binding', (input) => { input.account.liquidations[0].venue = 'BINANCE_SPOT'; }, 'FAIL'],
    ['wrong symbol binding', (input) => { input.account.liquidations[0].symbol = 'ETHUSDT'; }, 'FAIL'],
    ['wrong intent binding', (input) => { input.account.liquidations[0].intentDigest = 'riskint_wrong'; }, 'FAIL'],
    ['wrong projected quantity', (input) => { input.account.liquidations[0].projectedSignedBaseQty = -2; }, 'FAIL'],
  ]) {
    const input = allowedInput();
    mutate(input);
    expectStatus(`liquidation ${label}`, input, 'LIQUIDATION_DISTANCE', expected, false);
  }

  const partialRecovery = recoveryInput();
  partialRecovery.intent.legs = [partialRecovery.intent.legs[1]];
  partialRecovery.intent.legs[0].intendedQty = 0.5;
  partialRecovery.market.legs = [partialRecovery.market.legs[1]];
  partialRecovery.account.exposures.positions = [partialRecovery.account.exposures.positions[1]];
  partialRecovery.account.liquidations[0].liquidationPrice = 150;
  rebindIntent(partialRecovery);
  expectStatus('partial recovery leaving perp exposure checks liquidation', partialRecovery, 'LIQUIDATION_DISTANCE', 'PASS', true);

  const partialRecoveryMissing = clone(partialRecovery);
  partialRecoveryMissing.account.liquidations = null;
  expectStatus('partial recovery missing liquidation fails closed', partialRecoveryMissing, 'LIQUIDATION_DISTANCE', 'UNKNOWN', false);
}

// ---------------------------------------------------------------------------
section('13. reverse-Basis borrow states, bounds, freshness, identity, and zero-vs-null');
{
  const reverseBasis = borrowEntryInput();
  const reverseVerdict = evaluateMultiLegRisk(reverseBasis);
  check('complete reverse-Basis borrow entry is allowed', reverseVerdict.allowed, reverseVerdict.blockingCodes.join(','));
  check(
    'complete reverse-Basis borrow entry passes every borrow gate',
    ['BORROW_AVAILABILITY', 'BORROW_AMOUNT', 'BORROW_RATE', 'BORROW_FRESHNESS']
      .every((code) => checkByCode(reverseVerdict, code)?.status === 'PASS'),
  );

  for (const [state, expected] of [
    ['AVAILABLE', 'PASS'],
    ['UNKNOWN', 'UNKNOWN'],
    ['STALE', 'UNKNOWN'],
    ['UNAVAILABLE', 'FAIL'],
    ['PERMISSION_MISSING', 'FAIL'],
    ['ACCOUNT_MODE_MISMATCH', 'FAIL'],
    ['RATE_LIMITED', 'FAIL'],
    ['SOURCE_ERROR', 'FAIL'],
  ]) {
    const input = borrowEntryInput();
    input.borrow.state = state;
    expectStatus(
      `borrow state ${state}`,
      input,
      'BORROW_AVAILABILITY',
      expected,
      expected === 'PASS',
    );
  }

  for (const [declared, expected] of [
    [99, 'FAIL'],
    [100, 'PASS'],
    [101, 'PASS'],
  ]) {
    const input = borrowEntryInput();
    input.intent.requiredBorrowUsd = declared;
    rebindIntent(input);
    expectStatus(
      `declared borrow ${declared} versus derived 100`,
      input,
      'BORROW_AMOUNT',
      expected,
      expected === 'PASS',
    );
  }

  for (const [available, expected] of [
    [99, 'FAIL'],
    [100, 'PASS'],
    [101, 'PASS'],
  ]) {
    const input = borrowEntryInput();
    input.borrow.maxBorrowableUsd = available;
    expectStatus(
      `borrowable amount ${available} versus required 100`,
      input,
      'BORROW_AMOUNT',
      expected,
      expected === 'PASS',
    );
  }

  for (const [rate, expected] of [
    [0.4999, 'PASS'],
    [0.5, 'PASS'],
    [0.5001, 'FAIL'],
  ]) {
    const input = borrowEntryInput();
    input.borrow.hourlyRatePct = rate;
    expectStatus(
      `borrow hourly rate ${rate} versus cap 0.5`,
      input,
      'BORROW_RATE',
      expected,
      expected === 'PASS',
    );
  }

  for (const [ageMs, expected] of [
    [1_000, 'PASS'],
    [1_001, 'FAIL'],
  ]) {
    const input = borrowEntryInput();
    input.borrow.observedAt.sourceTimeMs = NOW - ageMs;
    expectStatus(
      `borrow evidence age ${ageMs}ms`,
      input,
      'BORROW_FRESHNESS',
      expected,
      expected === 'PASS',
    );
  }

  for (const [futureMs, expected] of [
    [2_000, 'PASS'],
    [2_001, 'FAIL'],
  ]) {
    const input = borrowEntryInput();
    input.borrow.observedAt.sourceTimeMs = NOW + futureMs;
    input.borrow.observedAt.receivedAtMs = NOW + futureMs;
    expectStatus(
      `borrow evidence future tolerance ${futureMs}ms`,
      input,
      'BORROW_FRESHNESS',
      expected,
      expected === 'PASS',
    );
  }

  const partial = borrowEntryInput();
  partial.borrow.observedAt.completeness = 'PARTIAL';
  expectStatus('partial borrow snapshot', partial, 'BORROW_FRESHNESS', 'UNKNOWN', false);

  for (const [label, mutate] of [
    ['wrong account', (input) => { input.borrow.accountId = 'other-account'; }],
    ['wrong symbol', (input) => { input.borrow.symbol = 'ETHUSDT'; }],
    ['wrong product bucket', (input) => { input.borrow.positionBucket = 'MARGIN_ISOLATED'; }],
  ]) {
    const input = borrowEntryInput();
    mutate(input);
    const verdict = expectStatus(`borrow identity ${label}`, input, 'BORROW_AVAILABILITY', 'FAIL', false);
    check(
      `borrow identity ${label} leaves dependent facts unknown`,
      ['BORROW_AMOUNT', 'BORROW_RATE', 'BORROW_FRESHNESS']
        .every((code) => checkByCode(verdict, code)?.status === 'UNKNOWN'),
    );
  }

  const unknownRequired = borrowEntryInput();
  unknownRequired.intent.requiredBorrowUsd = null;
  rebindIntent(unknownRequired);
  const unknownRequiredVerdict = expectStatus(
    'null borrow requirement stays unknown',
    unknownRequired,
    'BORROW_AMOUNT',
    'UNKNOWN',
    false,
  );
  check('unknown borrow amount preserves null observed value', checkByCode(unknownRequiredVerdict, 'BORROW_AMOUNT')?.observed === null);

  const falseZero = borrowEntryInput();
  falseZero.intent.requiredBorrowUsd = 0;
  rebindIntent(falseZero);
  expectStatus('zero borrow cannot hide an implied margin sell', falseZero, 'BORROW_AMOUNT', 'FAIL', false);

  const knownZero = allowedInput();
  const knownZeroVerdict = evaluateMultiLegRisk(knownZero);
  check('known zero borrow passes without borrow evidence', checkByCode(knownZeroVerdict, 'BORROW_AMOUNT')?.status === 'PASS');
  check('known zero borrow remains numerically zero', checkByCode(knownZeroVerdict, 'BORROW_AMOUNT')?.observed === 0);
}

// ---------------------------------------------------------------------------
section('14. daily loss and notional limits: bounds, period, account, and freshness');
{
  for (const [loss, expected] of [
    [999.99, 'PASS'],
    [1_000, 'FAIL'],
    [1_000.01, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.account.dailyRealizedLossUsd = loss;
    expectStatus(
      `daily realized loss ${loss} versus cap 1000`,
      input,
      'DAILY_LOSS_LIMIT',
      expected,
      expected === 'PASS',
    );
  }

  for (const [current, expected] of [
    [9_799, 'PASS'],
    [9_800, 'PASS'],
    [9_801, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.account.dailyTradedNotionalUsd = current;
    expectStatus(
      `daily notional ${current} plus exact intent gross 200`,
      input,
      'DAILY_NOTIONAL_LIMIT',
      expected,
      expected === 'PASS',
    );
  }

  const periodStartsNow = allowedInput();
  periodStartsNow.account.dailyPeriodStartMs = NOW;
  const startsNowVerdict = evaluateMultiLegRisk(periodStartsNow);
  check('daily sub-window starting at evaluation time blocks', !startsNowVerdict.allowed);
  check(
    'daily sub-window starting now makes both limits unknown',
    ['DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT']
      .every((code) => checkByCode(startsNowVerdict, code)?.status === 'UNKNOWN'),
  );

  const periodEndsNow = allowedInput();
  periodEndsNow.account.dailyPeriodEndMs = NOW;
  const endsNowVerdict = evaluateMultiLegRisk(periodEndsNow);
  check('daily period ending exactly now blocks', !endsNowVerdict.allowed);
  check(
    'daily period ending now makes both limits unknown',
    ['DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT']
      .every((code) => checkByCode(endsNowVerdict, code)?.status === 'UNKNOWN'),
  );

  const exactDay = allowedInput();
  exactDay.account.dailyPeriodStartMs = DAY_START;
  exactDay.account.dailyPeriodEndMs = DAY_END;
  const exactDayVerdict = evaluateMultiLegRisk(exactDay);
  check('exact 24-hour accounting window is valid', exactDayVerdict.allowed, exactDayVerdict.blockingCodes.join(','));
  check(
    'exact 24-hour accounting window passes both limits',
    ['DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT']
      .every((code) => checkByCode(exactDayVerdict, code)?.status === 'PASS'),
  );

  const overDay = allowedInput();
  overDay.account.dailyPeriodStartMs = DAY_START;
  overDay.account.dailyPeriodEndMs = DAY_END + 1;
  const overDayVerdict = evaluateMultiLegRisk(overDay);
  check('accounting window over 24 hours blocks', !overDayVerdict.allowed);
  check(
    'accounting window over 24 hours makes both limits unknown',
    ['DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT']
      .every((code) => checkByCode(overDayVerdict, code)?.status === 'UNKNOWN'),
  );

  for (const [label, mutate] of [
    ['wrong account', (input) => { input.account.accountId = 'other-account'; }],
    ['stale snapshot', (input) => { input.account.dailyStatsObservedAt.sourceTimeMs = NOW - 1_001; }],
    ['partial snapshot', (input) => { input.account.dailyStatsObservedAt.completeness = 'PARTIAL'; }],
  ]) {
    const input = allowedInput();
    mutate(input);
    const verdict = evaluateMultiLegRisk(input);
    check(`daily ${label} blocks`, !verdict.allowed);
    check(
      `daily ${label} leaves both limit facts unknown`,
      ['DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT']
        .every((code) => checkByCode(verdict, code)?.status === 'UNKNOWN'),
    );
  }

  const priorDayObservation = allowedInput();
  priorDayObservation.account.dailyStatsObservedAt.sourceTimeMs = DAY_START - 1;
  priorDayObservation.account.dailyStatsObservedAt.maxAgeMs = UTC_DAY_MS;
  const priorDayVerdict = evaluateMultiLegRisk(priorDayObservation);
  check('prior-day daily observation blocks current-day entry', !priorDayVerdict.allowed);
  check(
    'prior-day observation leaves both daily limits unknown',
    ['DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT']
      .every((code) => checkByCode(priorDayVerdict, code)?.status === 'UNKNOWN'),
  );

  const missingLoss = allowedInput();
  missingLoss.account.dailyRealizedLossUsd = null;
  expectStatus('missing daily loss remains unknown', missingLoss, 'DAILY_LOSS_LIMIT', 'UNKNOWN', false);

  const missingNotional = allowedInput();
  missingNotional.account.dailyTradedNotionalUsd = null;
  expectStatus('missing daily notional remains unknown', missingNotional, 'DAILY_NOTIONAL_LIMIT', 'UNKNOWN', false);
}

// ---------------------------------------------------------------------------
section('15. duplicate-plan registry and open-order limit reconciliation');
{
  const emptyRegistry = allowedInput();
  expectStatus('empty active-plan registry', emptyRegistry, 'DUPLICATE_ACTIVE_PLAN', 'PASS', true);

  const activeNonOverlap = allowedInput();
  activeNonOverlap.existingPlans.plans = [
    { planId: 'plan-eth-ready', symbols: ['ETHUSDT'], lifecycle: 'READY' },
  ];
  expectStatus('active non-overlapping plan', activeNonOverlap, 'DUPLICATE_ACTIVE_PLAN', 'PASS', true);

  const terminalOverlap = allowedInput();
  terminalOverlap.existingPlans.plans = [
    { planId: 'plan-btc-closed', symbols: [SYMBOL], lifecycle: 'CLOSED' },
  ];
  expectStatus('terminal overlapping plan', terminalOverlap, 'DUPLICATE_ACTIVE_PLAN', 'PASS', true);

  const activeOverlap = allowedInput();
  activeOverlap.existingPlans.plans = [
    { planId: 'plan-btc-ready', symbols: [SYMBOL], lifecycle: 'READY' },
  ];
  expectStatus('active overlapping plan', activeOverlap, 'DUPLICATE_ACTIVE_PLAN', 'FAIL', false);

  const sameIdNonOverlap = allowedInput();
  sameIdNonOverlap.existingPlans.plans = [
    { planId: sameIdNonOverlap.intent.planId, symbols: ['ETHUSDT'], lifecycle: 'READY' },
  ];
  expectStatus(
    'same-ID active plan blocks even when its recorded symbols do not overlap',
    sameIdNonOverlap,
    'DUPLICATE_ACTIVE_PLAN',
    'FAIL',
    false,
  );

  const wrongRegistryAccount = allowedInput();
  wrongRegistryAccount.existingPlans.accountId = 'other-account';
  expectStatus('plan registry wrong account', wrongRegistryAccount, 'DUPLICATE_ACTIVE_PLAN', 'FAIL', false);

  const repeatedId = allowedInput();
  repeatedId.existingPlans.plans = [
    { planId: 'plan-repeat', symbols: ['ETHUSDT'], lifecycle: 'READY' },
    { planId: 'plan-repeat', symbols: ['SOLUSDT'], lifecycle: 'READY' },
  ];
  expectStatus('plan registry repeated plan ID', repeatedId, 'DUPLICATE_ACTIVE_PLAN', 'UNKNOWN', false);

  const malformedRow = allowedInput();
  malformedRow.existingPlans.plans = [
    { planId: 'plan-malformed', symbols: [], lifecycle: 'READY' },
  ];
  expectStatus('plan registry malformed row', malformedRow, 'DUPLICATE_ACTIVE_PLAN', 'UNKNOWN', false);

  const staleRegistry = allowedInput();
  staleRegistry.existingPlans.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('plan registry stale snapshot', staleRegistry, 'DUPLICATE_ACTIVE_PLAN', 'UNKNOWN', false);

  const partialRegistry = allowedInput();
  partialRegistry.existingPlans.observedAt.completeness = 'PARTIAL';
  expectStatus('plan registry partial snapshot', partialRegistry, 'DUPLICATE_ACTIVE_PLAN', 'UNKNOWN', false);

  const duplicateRecovery = recoveryInput();
  duplicateRecovery.existingPlans.plans = [
    { planId: 'plan-existing-recovery', symbols: [SYMBOL], lifecycle: 'READY' },
  ];
  const duplicateRecoveryVerdict = expectStatus(
    'active overlap blocks a second recovery plan',
    duplicateRecovery,
    'DUPLICATE_ACTIVE_PLAN',
    'FAIL',
    false,
  );
  check('duplicate-plan family is close-blocking', checkByCode(duplicateRecoveryVerdict, 'DUPLICATE_ACTIVE_PLAN')?.blocking === true);

  const totalOrderCounts = (total) => ({
    ETHUSDT: Math.min(total, 5),
    ...(total > 5 ? { SOLUSDT: total - 5 } : {}),
  });
  for (const [current, expected] of [
    [7, 'PASS'],
    [8, 'PASS'],
    [9, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.account.openOrders.total = current;
    input.account.openOrders.perSymbol = totalOrderCounts(current);
    expectStatus(
      `open-order total ${current} plus two intent legs`,
      input,
      'OPEN_ORDER_LIMIT',
      expected,
      expected === 'PASS',
    );
  }

  for (const [current, expected] of [
    [2, 'PASS'],
    [3, 'PASS'],
    [4, 'FAIL'],
  ]) {
    const input = allowedInput();
    input.account.openOrders.total = current;
    input.account.openOrders.perSymbol = { [SYMBOL]: current };
    expectStatus(
      `open orders for ${SYMBOL} ${current} plus two intent legs`,
      input,
      'OPEN_ORDER_LIMIT',
      expected,
      expected === 'PASS',
    );
  }

  const countMismatch = allowedInput();
  countMismatch.account.openOrders.total = 1;
  countMismatch.account.openOrders.perSymbol = {};
  expectStatus('open-order total and per-symbol sum mismatch', countMismatch, 'OPEN_ORDER_LIMIT', 'UNKNOWN', false);

  const malformedCount = allowedInput();
  malformedCount.account.openOrders.total = 1.5;
  malformedCount.account.openOrders.perSymbol = { [SYMBOL]: 1.5 };
  expectStatus('open-order non-integer count', malformedCount, 'OPEN_ORDER_LIMIT', 'UNKNOWN', false);

  const staleOrders = allowedInput();
  staleOrders.account.openOrders.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('open-order stale snapshot', staleOrders, 'OPEN_ORDER_LIMIT', 'UNKNOWN', false);

  const partialOrders = allowedInput();
  partialOrders.account.openOrders.observedAt.completeness = 'PARTIAL';
  expectStatus('open-order partial snapshot', partialOrders, 'OPEN_ORDER_LIMIT', 'UNKNOWN', false);

  const mapOrders = allowedInput();
  mapOrders.account.openOrders.perSymbol = new Map([[SYMBOL, 0]]);
  expectStatus('open-order Map is not a plain reconciled record', mapOrders, 'OPEN_ORDER_LIMIT', 'UNKNOWN', false);

  const unrelatedBreach = allowedInput();
  unrelatedBreach.account.openOrders.total = 6;
  unrelatedBreach.account.openOrders.perSymbol = { ETHUSDT: 6 };
  expectStatus(
    'pre-existing unrelated symbol breach still blocks account entry',
    unrelatedBreach,
    'OPEN_ORDER_LIMIT',
    'FAIL',
    false,
  );
}

// ---------------------------------------------------------------------------
section('16. cooldown bounds, scope, chronology, and malformed evidence');
{
  for (const [elapsed, expected] of [
    [999, 'FAIL'],
    [1_000, 'PASS'],
    [1_001, 'PASS'],
  ]) {
    const input = allowedInput();
    input.cooldown.lastEntryAtMs = NOW - elapsed;
    expectStatus(
      `cooldown elapsed ${elapsed}ms versus 1000ms`,
      input,
      'COOLDOWN',
      expected,
      expected === 'PASS',
    );
  }

  const wrongAccount = allowedInput();
  wrongAccount.cooldown.accountId = 'other-account';
  expectStatus('cooldown wrong account scope', wrongAccount, 'COOLDOWN', 'FAIL', false);

  const wrongSymbol = allowedInput();
  wrongSymbol.cooldown.symbols = ['ETHUSDT'];
  expectStatus('cooldown wrong symbol scope', wrongSymbol, 'COOLDOWN', 'FAIL', false);

  const noPriorEntry = allowedInput();
  noPriorEntry.cooldown.lastEntryAtMs = null;
  const noPriorVerdict = expectStatus('known no prior entry', noPriorEntry, 'COOLDOWN', 'PASS', true);
  check('known no prior entry is explicit, not numeric zero', checkByCode(noPriorVerdict, 'COOLDOWN')?.observed === 'NO_PRIOR_ENTRY');

  const afterSnapshot = allowedInput();
  afterSnapshot.cooldown.lastEntryAtMs = NOW - 1;
  expectStatus('cooldown entry later than its snapshot', afterSnapshot, 'COOLDOWN', 'FAIL', false);

  const afterNow = allowedInput();
  afterNow.cooldown.lastEntryAtMs = NOW + 1;
  expectStatus('cooldown entry later than evaluation clock', afterNow, 'COOLDOWN', 'FAIL', false);

  const stale = allowedInput();
  stale.cooldown.observedAt.sourceTimeMs = NOW - 1_001;
  expectStatus('cooldown stale snapshot', stale, 'COOLDOWN', 'FAIL', false);

  const partial = allowedInput();
  partial.cooldown.observedAt.completeness = 'PARTIAL';
  expectStatus('cooldown partial snapshot', partial, 'COOLDOWN', 'UNKNOWN', false);

  for (const [label, symbols] of [
    ['empty symbol scope', []],
    ['blank symbol', ['']],
    ['non-string symbol', [null]],
    ['duplicate symbols', [SYMBOL, SYMBOL]],
  ]) {
    const input = allowedInput();
    input.cooldown.symbols = symbols;
    expectStatus(`cooldown malformed ${label}`, input, 'COOLDOWN', 'UNKNOWN', false);
  }

  const malformedEntryTime = allowedInput();
  malformedEntryTime.cooldown.lastEntryAtMs = 'not-a-timestamp';
  expectStatus('cooldown malformed last-entry time', malformedEntryTime, 'COOLDOWN', 'UNKNOWN', false);

  const missing = allowedInput();
  missing.cooldown = null;
  expectStatus('cooldown missing state', missing, 'COOLDOWN', 'UNKNOWN', false);
}

// ---------------------------------------------------------------------------
section('17. adversarial regressions, deterministic horizons, and purity proof');
{
  for (const [label, mutate] of [
    ['kill-switch control fact', (input) => { input.killSwitch.observedAt.authority = 'LIVE_PUBLIC'; }],
    ['operator approval', (input) => { input.approval.observedAt.authority = 'LIVE_PUBLIC'; }],
    ['private permission posture', (input) => { input.account.permissions.observedAt.authority = 'LIVE_PUBLIC'; }],
  ]) {
    const input = allowedInput();
    mutate(input);
    expectStatus(`${label} rejects LIVE_PUBLIC authority`, input, 'EVIDENCE_AUTHORITY', 'FAIL', false);
  }

  const marketProvenance = allowedInput();
  marketProvenance.market.legs[0].observedAt.sourceId = 'binance.usdm.book';
  expectStatus(
    'spot market row rejects USD-M provenance',
    marketProvenance,
    'LEG_EVIDENCE_FRESHNESS_SPOT_BUY',
    'FAIL',
    false,
  );

  const filterProvenance = allowedInput();
  filterProvenance.market.legs[0].filters.observedAt.sourceId = 'binance.usdm.filters';
  expectStatus(
    'spot filters reject USD-M provenance',
    filterProvenance,
    'SYMBOL_FILTERS_SPOT_BUY',
    'FAIL',
    false,
  );

  const impossibleSourceReceiptOrder = allowedInput();
  impossibleSourceReceiptOrder.market.legs[0].observedAt.sourceTimeMs = NOW - 4;
  impossibleSourceReceiptOrder.market.legs[0].observedAt.receivedAtMs = NOW - 5;
  expectStatus(
    'source time later than receipt time is clock-skew failure',
    impossibleSourceReceiptOrder,
    'LEG_EVIDENCE_FRESHNESS_SPOT_BUY',
    'FAIL',
    false,
  );

  const futureReceipt = allowedInput();
  futureReceipt.market.legs[0].observedAt.sourceTimeMs = null;
  futureReceipt.market.legs[0].observedAt.receivedAtMs = NOW + 2_001;
  expectStatus(
    'receipt beyond future tolerance is clock-skew failure',
    futureReceipt,
    'LEG_EVIDENCE_FRESHNESS_SPOT_BUY',
    'FAIL',
    false,
  );

  const malformedRecoveryExposure = recoveryInput();
  malformedRecoveryExposure.intent.legs[0].requiredPermission = 'MARGIN';
  malformedRecoveryExposure.intent.legs[0].positionBucket = 'MARGIN_CROSS';
  malformedRecoveryExposure.intent.requiredBorrowUsd = 100;
  malformedRecoveryExposure.borrow = {
    accountId: ACCOUNT,
    symbol: SYMBOL,
    state: 'AVAILABLE',
    maxBorrowableUsd: 200,
    hourlyRatePct: 0.1,
    observedAt: stamp('binance.borrow'),
  };
  malformedRecoveryExposure.account.exposures.positions = [null];
  rebindIntent(malformedRecoveryExposure);
  let malformedRecoveryVerdict = null;
  let malformedRecoveryError = null;
  try {
    malformedRecoveryVerdict = evaluateMultiLegRisk(malformedRecoveryExposure);
  } catch (error) {
    malformedRecoveryError = error;
  }
  check('malformed recovery exposure rows never throw in margin/borrow checks', malformedRecoveryError === null, malformedRecoveryError?.message ?? '');
  check('malformed recovery exposure rows fail closed', malformedRecoveryVerdict?.allowed === false);

  const marginOverflow = allowedInput();
  marginOverflow.intent.estimatedRequiredMarginUsd = Number.MAX_VALUE;
  marginOverflow.intent.legs[1].estimatedRequiredMarginUsd = Number.MAX_VALUE;
  marginOverflow.account.marginHeadrooms[0].availableMarginUsd = Number.MAX_VALUE;
  marginOverflow.policy.marginHeadroomBufferPct = 100;
  rebindIntent(marginOverflow);
  expectStatus('margin buffer multiplication overflow', marginOverflow, 'MARGIN_HEADROOM', 'FAIL', false);

  const residualRecovery = recoveryInput();
  residualRecovery.intent.legs = [residualRecovery.intent.legs[1]];
  residualRecovery.intent.legs[0].intendedQty = 0.5;
  residualRecovery.market.legs = [residualRecovery.market.legs[1]];
  residualRecovery.account.exposures.positions = [residualRecovery.account.exposures.positions[1]];
  residualRecovery.account.liquidations[0].liquidationPrice = 150;
  residualRecovery.account.liquidations[0].observedAt.authority = 'LIVE_PUBLIC';
  rebindIntent(residualRecovery);
  expectStatus(
    'residual recovery liquidation projection requires private authority',
    residualRecovery,
    'EVIDENCE_AUTHORITY',
    'FAIL',
    false,
  );

  const flatRecovery = recoveryInput();
  flatRecovery.account.liquidations = [];
  rebindIntent(flatRecovery);
  const flatRecoveryVerdict = evaluateMultiLegRisk(flatRecovery);
  check('fully flattening recovery needs no residual liquidation projection', flatRecoveryVerdict.allowed, flatRecoveryVerdict.blockingCodes.join(','));
  check('fully flattening recovery reports liquidation PASS', checkByCode(flatRecoveryVerdict, 'LIQUIDATION_DISTANCE')?.status === 'PASS');

  const hostile = borrowEntryInput();
  hostile.killSwitch = Object.assign(Object.create(null), hostile.killSwitch);
  hostile.account.openOrders = Object.assign(Object.create(null), hostile.account.openOrders);
  hostile.account.openOrders.perSymbol = Object.assign(Object.create(null), hostile.account.openOrders.perSymbol);
  hostile.borrow = Object.assign(Object.create(null), hostile.borrow);
  hostile.killSwitch.reason = 'r'.repeat(10_000);
  hostile.borrow.state = 's'.repeat(10_000);
  hostile.market.legs[0].observedAt.sourceId = 'x'.repeat(10_000);
  let hostileVerdict = null;
  let hostileError = null;
  try {
    hostileVerdict = evaluateMultiLegRisk(hostile);
  } catch (error) {
    hostileError = error;
  }
  check('null-prototype and oversized nested evidence never throws', hostileError === null, hostileError?.message ?? '');
  check('hostile nested evidence fails closed', hostileVerdict?.allowed === false);
  check('diagnostic details are capped at 1000 characters', hostileVerdict?.checks.every((item) => item.detail.length <= 1_000));
  check(
    'diagnostic scalar strings are capped at 300 characters',
    hostileVerdict?.checks.every((item) =>
      (typeof item.observed !== 'string' || item.observed.length <= 300) &&
      (typeof item.limit !== 'string' || item.limit.length <= 300)),
  );

  const aggregate = allowedInput();
  const aggregateSides = ['BUY', 'BUY', 'SELL', 'SELL', 'SELL'];
  aggregate.intent.legs = aggregateSides.map((side, index) => ({
    legKey: `OVERFLOW_${index + 1}`,
    venue: 'BINANCE_SPOT',
    symbol: SYMBOL,
    side,
    intendedPrice: 1e-308,
    intendedQty: 1e308,
    requiredPermission: 'SPOT',
    positionBucket: 'SPOT_CASH',
    estimatedRequiredMarginUsd: 0,
  }));
  aggregate.market.legs = aggregate.intent.legs.map((leg, index) => ({
    legKey: leg.legKey,
    venue: leg.venue,
    symbol: leg.symbol,
    referencePrice: 1e-308,
    observedAt: stamp(`binance.spot.book.${index + 1}`),
    spreadPct: 0,
    topDepthUsd: 10_000,
    filters: {
      venue: leg.venue,
      symbol: leg.symbol,
      minPrice: 0,
      maxPrice: null,
      tickSize: 1e-308,
      minQty: 0,
      maxQty: null,
      stepSize: 1e308,
      minNotionalUsd: 0,
      maxNotionalUsd: 10,
      observedAt: stamp(`binance.spot.filters.${index + 1}`),
    },
  }));
  aggregate.intent.estimatedRequiredMarginUsd = 0;
  aggregate.account.liquidations = [];
  aggregate.account.spotInventory[0].availableBaseQty = 1e308;
  aggregate.account.spotInventory[0].availableQuoteUsd = 1e308;
  aggregate.policy.minLegNotionalUsd = 0;
  aggregate.policy.maxLegNotionalUsd = 10;
  aggregate.policy.maxGrossNotionalUsd = 10;
  aggregate.policy.maxResidualDeltaUsd = 0;
  rebindIntent(aggregate);
  const aggregateVerdict = evaluateMultiLegRisk(aggregate);
  check('five-leg extreme aggregate fails closed', !aggregateVerdict.allowed);
  check(
    'five-leg extreme aggregate cannot pass hedge ratio through non-finite arithmetic',
    ['FAIL', 'UNKNOWN'].includes(checkByCode(aggregateVerdict, 'HEDGE_RATIO_TOLERANCE')?.status),
  );

  const deterministic = allowedInput();
  const deterministicBefore = JSON.stringify(deterministic);
  const firstVerdict = JSON.stringify(evaluateMultiLegRisk(deterministic));
  const secondVerdict = JSON.stringify(evaluateMultiLegRisk(deterministic));
  check('repeated evaluation is byte-identical', firstVerdict === secondVerdict);
  check('repeated evaluation never mutates input', JSON.stringify(deterministic) === deterministicBefore);

  const requiredCodes = [
    'KILL_SWITCH', 'APPROVAL_PRESENT', 'APPROVAL_EXPIRY', 'APPROVAL_SCOPE',
    'RECOVERY_RISK_REDUCTION', 'PROPOSAL_PRESENT', 'PROPOSAL_EXPIRY',
    'EVIDENCE_AUTHORITY', 'LEG_EVIDENCE_FRESHNESS_PERP_SELL',
    'LEG_EVIDENCE_FRESHNESS_SPOT_BUY', 'SPOT_PERP_SKEW', 'PERMISSION_POSTURE',
    'SPOT_INVENTORY', 'SYMBOL_FILTERS_PERP_SELL', 'SYMBOL_FILTERS_SPOT_BUY',
    'LEG_NOTIONAL_PERP_SELL', 'LEG_NOTIONAL_SPOT_BUY', 'MAX_GROSS_NOTIONAL',
    'HEDGE_RATIO_TOLERANCE', 'RESIDUAL_DELTA', 'MAX_NAKED_DURATION', 'NET_EDGE',
    'COST_EVIDENCE', 'SPREAD', 'DEPTH', 'SLIPPAGE', 'MARGIN_HEADROOM',
    'LIQUIDATION_DISTANCE', 'BORROW_AVAILABILITY', 'BORROW_AMOUNT', 'BORROW_RATE',
    'BORROW_FRESHNESS', 'DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT',
    'DUPLICATE_ACTIVE_PLAN', 'OPEN_ORDER_LIMIT', 'COOLDOWN',
  ];
  const actualCodes = evaluateMultiLegRisk(allowedInput()).checks.map((item) => item.code);
  check('verdict contains every required check code exactly once', actualCodes.join('|') === requiredCodes.join('|'));

  const longHorizonInput = () => {
    const input = allowedInput();
    const timestamps = [
      input.killSwitch.observedAt,
      input.approval.observedAt,
      input.proposal.observedAt,
      input.market.edgeObservedAt,
      ...input.market.legs.flatMap((leg) => [leg.observedAt, leg.filters.observedAt]),
      input.account.permissions.observedAt,
      ...input.account.spotInventory.map((row) => row.observedAt),
      input.account.exposures.observedAt,
      ...input.account.exposures.positions.map((row) => row.observedAt),
      ...input.account.marginHeadrooms.map((row) => row.observedAt),
      ...input.account.liquidations.map((row) => row.observedAt),
      input.account.dailyStatsObservedAt,
      input.account.openOrders.observedAt,
      input.existingPlans.observedAt,
      input.cooldown.observedAt,
    ];
    for (const timestamp of timestamps) timestamp.maxAgeMs = 100_000;
    input.approval.expiresAtMs = NOW + 100_000;
    input.proposal.expiresAtMs = NOW + 100_000;
    input.account.dailyPeriodStartMs = DAY_START;
    input.account.dailyPeriodEndMs = DAY_END;
    return input;
  };

  const approvalHorizon = longHorizonInput();
  approvalHorizon.approval.expiresAtMs = NOW + 123;
  check('verdict expiry clamps to approval horizon', evaluateMultiLegRisk(approvalHorizon).expiresAt === NOW + 123);

  const proposalHorizon = longHorizonInput();
  proposalHorizon.proposal.expiresAtMs = NOW + 124;
  check('verdict expiry clamps to proposal horizon', evaluateMultiLegRisk(proposalHorizon).expiresAt === NOW + 124);

  const sourceHorizon = longHorizonInput();
  sourceHorizon.market.legs[0].observedAt.maxAgeMs = 321;
  check('verdict expiry clamps to sourced-evidence horizon', evaluateMultiLegRisk(sourceHorizon).expiresAt === NOW + 311);

  const dailyHorizon = longHorizonInput();
  dailyHorizon.policy.verdictTtlMs = UTC_DAY_MS;
  dailyHorizon.approval.expiresAtMs = DAY_END + 1_000;
  dailyHorizon.proposal.expiresAtMs = DAY_END + 1_000;
  const dailyTimestampCandidates = [
    dailyHorizon.killSwitch.observedAt,
    dailyHorizon.approval.observedAt,
    dailyHorizon.proposal.observedAt,
    dailyHorizon.market.edgeObservedAt,
    ...dailyHorizon.market.legs.flatMap((leg) => [leg.observedAt, leg.filters.observedAt]),
    dailyHorizon.account.permissions.observedAt,
    ...dailyHorizon.account.spotInventory.map((row) => row.observedAt),
    dailyHorizon.account.exposures.observedAt,
    ...dailyHorizon.account.exposures.positions.map((row) => row.observedAt),
    ...dailyHorizon.account.marginHeadrooms.map((row) => row.observedAt),
    ...dailyHorizon.account.liquidations.map((row) => row.observedAt),
    dailyHorizon.account.dailyStatsObservedAt,
    dailyHorizon.account.openOrders.observedAt,
    dailyHorizon.existingPlans.observedAt,
    dailyHorizon.cooldown.observedAt,
  ];
  for (const timestamp of dailyTimestampCandidates) timestamp.maxAgeMs = UTC_DAY_MS;
  const dailyHorizonVerdict = evaluateMultiLegRisk(dailyHorizon);
  check(
    'verdict expiry clamps to canonical daily-period end',
    dailyHorizonVerdict.expiresAt === DAY_END,
    `got=${dailyHorizonVerdict.expiresAt},expected=${DAY_END}`,
  );

  const exactEvidenceBoundary = longHorizonInput();
  for (const row of exactEvidenceBoundary.market.legs) {
    row.observedAt.sourceTimeMs = NOW - 1_000;
    row.observedAt.maxAgeMs = 1_000;
  }
  const exactBoundaryVerdict = evaluateMultiLegRisk(exactEvidenceBoundary);
  check('evidence exactly at its inclusive freshness boundary still evaluates', exactBoundaryVerdict.allowed, exactBoundaryVerdict.blockingCodes.join(','));
  check('boundary verdict never outlives its evidence by one millisecond', exactBoundaryVerdict.expiresAt === NOW, `got=${exactBoundaryVerdict.expiresAt}`);

  const recoveryTtl = recoveryInput();
  for (const timestamp of [
    recoveryTtl.killSwitch.observedAt,
    recoveryTtl.proposal.observedAt,
    recoveryTtl.market.edgeObservedAt,
    recoveryTtl.account.dailyStatsObservedAt,
    recoveryTtl.account.openOrders.observedAt,
    recoveryTtl.cooldown.observedAt,
  ]) {
    timestamp.sourceTimeMs = NOW - 10_000;
    timestamp.maxAgeMs = 1;
  }
  const recoveryTtlVerdict = evaluateMultiLegRisk(recoveryTtl);
  check('stale entry-only diagnostics do not trap an authorized recovery', recoveryTtlVerdict.allowed, recoveryTtlVerdict.blockingCodes.join(','));
  check('recovery TTL ignores nonblocking stale evidence', recoveryTtlVerdict.expiresAt === NOW + 990, `got=${recoveryTtlVerdict.expiresAt}`);

  const productionFiles = [
    'server/src/foundation/risk/types.ts',
    'server/src/foundation/risk/checks.ts',
    'server/src/foundation/risk/evaluator.ts',
    'server/src/foundation/risk/index.ts',
    'server/dist/foundation/risk/types.js',
    'server/dist/foundation/risk/checks.js',
    'server/dist/foundation/risk/evaluator.js',
    'server/dist/foundation/risk/index.js',
  ];
  const productionText = productionFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  check(
    'risk production has no wall clock, environment, network, or timer access',
    !/\bDate\.now\s*\(|\bnew\s+Date\s*\(|\bprocess\.env\b|\bfetch\s*\(|\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(productionText),
  );
  check(
    'risk production exposes no live-order or capital-action call',
    !/(?:\.\s*|\bfunction\s+)(?:placeOrder|submitOrder|createOrder|cancelOrder|borrow|repay|withdraw|transfer|changeLeverage|changeMarginMode)\s*\(|\b(?:const|let|var)\s+(?:placeOrder|submitOrder|createOrder|cancelOrder|borrow|repay|withdraw|transfer|changeLeverage|changeMarginMode)\s*=\s*(?:async\s*)?\(/.test(productionText),
  );
  check(
    'risk production imports no Node I/O module',
    !/\bfrom\s+['"]node:(?:fs|net|http|https|tls|dgram|child_process|worker_threads)['"]/.test(productionText),
  );
}

// ---------------------------------------------------------------------------
section('18. numeric precision, product topology, and bounded-input regressions');
{
  const nearGridQty = allowedInput();
  nearGridQty.intent.legs[0].intendedQty = 1.00000005;
  nearGridQty.market.legs[0].filters.stepSize = 1;
  rebindIntent(nearGridQty);
  expectStatus(
    'near-grid quantity is still off-grid',
    nearGridQty,
    'SYMBOL_FILTERS_SPOT_BUY',
    'FAIL',
    false,
  );

  const nearGridPrice = allowedInput();
  nearGridPrice.intent.legs[0].intendedPrice = 100.000005;
  nearGridPrice.market.legs[0].filters.tickSize = 100;
  rebindIntent(nearGridPrice);
  expectStatus(
    'near-grid price is still off-grid',
    nearGridPrice,
    'SYMBOL_FILTERS_SPOT_BUY',
    'FAIL',
    false,
  );

  const exactMarginDeficit = allowedInput();
  exactMarginDeficit.policy.marginHeadroomBufferPct = 0;
  exactMarginDeficit.account.marginHeadrooms[0].availableMarginUsd = 99.99999999999999;
  expectStatus(
    'one representable step below required margin fails',
    exactMarginDeficit,
    'MARGIN_HEADROOM',
    'FAIL',
    false,
  );

  const missingPositionMode = allowedInput();
  missingPositionMode.account.exposures.positionMode = null;
  expectStatus(
    'USD-M entry with unknown position mode',
    missingPositionMode,
    'PERMISSION_POSTURE',
    'UNKNOWN',
    false,
  );

  const hedgePositionMode = allowedInput();
  hedgePositionMode.account.exposures.positionMode = 'HEDGE';
  expectStatus(
    'USD-M entry rejects hedge-mode account evidence',
    hedgePositionMode,
    'PERMISSION_POSTURE',
    'FAIL',
    false,
  );

  const cashAsMarginHedge = recoveryInput();
  cashAsMarginHedge.intent.legs = [cashAsMarginHedge.intent.legs[0]];
  cashAsMarginHedge.intent.legs[0].requiredPermission = 'MARGIN';
  cashAsMarginHedge.intent.legs[0].positionBucket = 'MARGIN_CROSS';
  cashAsMarginHedge.intent.requiredBorrowUsd = 0;
  cashAsMarginHedge.intent.estimatedRequiredMarginUsd = 0;
  cashAsMarginHedge.market.legs = [cashAsMarginHedge.market.legs[0]];
  cashAsMarginHedge.account.exposures.positions = [cashAsMarginHedge.account.exposures.positions[0]];
  cashAsMarginHedge.account.liquidations = [];
  rebindIntent(cashAsMarginHedge);
  const cashAsMarginVerdict = evaluateMultiLegRisk(cashAsMarginHedge);
  check(
    'cash exposure may authorize a distinct margin hedge only as risk reduction',
    checkByCode(cashAsMarginVerdict, 'RECOVERY_RISK_REDUCTION')?.status === 'PASS',
  );
  check(
    'cash exposure is not mistaken for existing margin borrow',
    checkByCode(cashAsMarginVerdict, 'BORROW_AMOUNT')?.status === 'FAIL',
  );
  check(
    'cash exposure is not mistaken for existing margin headroom',
    checkByCode(cashAsMarginVerdict, 'MARGIN_HEADROOM')?.status === 'FAIL',
  );
  check('unfunded cash-to-margin hedge remains blocked', !cashAsMarginVerdict.allowed);

  const trueMarginClose = recoveryInput();
  trueMarginClose.intent.legs = [trueMarginClose.intent.legs[0]];
  trueMarginClose.intent.legs[0].requiredPermission = 'MARGIN';
  trueMarginClose.intent.legs[0].positionBucket = 'MARGIN_CROSS';
  trueMarginClose.intent.requiredBorrowUsd = 0;
  trueMarginClose.intent.estimatedRequiredMarginUsd = 0;
  trueMarginClose.market.legs = [trueMarginClose.market.legs[0]];
  trueMarginClose.account.exposures.positions = [trueMarginClose.account.exposures.positions[0]];
  trueMarginClose.account.exposures.positions[0].positionBucket = 'MARGIN_CROSS';
  trueMarginClose.account.liquidations = [];
  rebindIntent(trueMarginClose);
  const trueMarginCloseVerdict = evaluateMultiLegRisk(trueMarginClose);
  check('matching margin-bucket close is allowed', trueMarginCloseVerdict.allowed, trueMarginCloseVerdict.blockingCodes.join(','));
  check('matching margin-bucket close requires no new borrow', checkByCode(trueMarginCloseVerdict, 'BORROW_AMOUNT')?.status === 'PASS');
  check('matching margin-bucket close requires no new margin', checkByCode(trueMarginCloseVerdict, 'MARGIN_HEADROOM')?.status === 'PASS');

  const hugeResidual = allowedInput();
  hugeResidual.intent.legs[0].intendedPrice = 1;
  hugeResidual.intent.legs[0].intendedQty = 9e299;
  hugeResidual.intent.legs[1].intendedPrice = 1;
  hugeResidual.intent.legs[1].intendedQty = 8.999999999999999e299;
  for (const row of hugeResidual.market.legs) {
    row.referencePrice = 1;
    row.filters.minPrice = 0;
    row.filters.maxPrice = null;
    row.filters.tickSize = 1;
    row.filters.minQty = 0;
    row.filters.maxQty = null;
    row.filters.stepSize = 1e284;
    row.filters.minNotionalUsd = 0;
    row.filters.maxNotionalUsd = null;
  }
  hugeResidual.intent.estimatedRequiredMarginUsd = 1e300;
  hugeResidual.intent.legs[1].estimatedRequiredMarginUsd = 1e300;
  hugeResidual.account.marginHeadrooms[0].availableMarginUsd = 2e300;
  hugeResidual.account.spotInventory[0].availableQuoteUsd = 1e300;
  hugeResidual.account.liquidations[0].markPrice = 1;
  hugeResidual.account.liquidations[0].liquidationPrice = 1.5;
  hugeResidual.policy.minLegNotionalUsd = 0;
  hugeResidual.policy.maxLegNotionalUsd = 1e300;
  hugeResidual.policy.maxGrossNotionalUsd = 2e300;
  hugeResidual.policy.maxResidualDeltaUsd = 0;
  hugeResidual.policy.maxDailyNotionalUsd = 2e300;
  rebindIntent(hugeResidual);
  expectStatus(
    'huge-scale nonzero residual cannot hide under floating tolerance',
    hugeResidual,
    'RESIDUAL_DELTA',
    'FAIL',
    false,
  );

  const orderIndependentInput = (orderedLegs) => {
    const input = allowedInput();
    input.intent.legs = orderedLegs.map((leg) => ({ ...leg }));
    input.market.legs = input.intent.legs.map((leg) => ({
      legKey: leg.legKey,
      venue: 'BINANCE_SPOT',
      symbol: SYMBOL,
      referencePrice: 1,
      observedAt: stamp(`binance.spot.book.${leg.legKey}`),
      spreadPct: 0,
      topDepthUsd: 1e18,
      filters: {
        venue: 'BINANCE_SPOT',
        symbol: SYMBOL,
        minPrice: 0,
        maxPrice: null,
        tickSize: 1,
        minQty: 0,
        maxQty: null,
        stepSize: 1,
        minNotionalUsd: 0,
        maxNotionalUsd: 1e17,
        observedAt: stamp(`binance.spot.filters.${leg.legKey}`),
      },
    }));
    input.intent.estimatedRequiredMarginUsd = 0;
    input.intent.requiredBorrowUsd = 0;
    input.account.liquidations = [];
    input.account.spotInventory[0].availableBaseQty = 1e17;
    input.account.spotInventory[0].availableQuoteUsd = 1e17;
    input.policy.minLegNotionalUsd = 0;
    input.policy.maxLegNotionalUsd = 1e16;
    input.policy.maxGrossNotionalUsd = 3e16;
    input.policy.maxResidualDeltaUsd = 10;
    input.policy.maxDailyNotionalUsd = 3e16;
    input.policy.maxOpenOrdersPerSymbol = 100;
    input.policy.maxTotalOpenOrders = 100;
    return rebindIntent(input);
  };
  const largeBuy = {
    legKey: 'LARGE_BUY', venue: 'BINANCE_SPOT', symbol: SYMBOL,
    positionBucket: 'SPOT_CASH', side: 'BUY', intendedPrice: 1,
    intendedQty: 9e15, requiredPermission: 'SPOT',
    estimatedRequiredMarginUsd: 0,
  };
  const largeSell = {
    legKey: 'LARGE_SELL', venue: 'BINANCE_SPOT', symbol: SYMBOL,
    positionBucket: 'SPOT_CASH', side: 'SELL', intendedPrice: 1,
    intendedQty: 9e15, requiredPermission: 'SPOT',
    estimatedRequiredMarginUsd: 0,
  };
  const smallBuys = Array.from({ length: 20 }, (_, index) => ({
    legKey: `SMALL_BUY_${String(index + 1).padStart(2, '0')}`,
    venue: 'BINANCE_SPOT',
    symbol: SYMBOL,
    positionBucket: 'SPOT_CASH',
    side: 'BUY',
    intendedPrice: 1,
    intendedQty: 1,
    requiredPermission: 'SPOT',
    estimatedRequiredMarginUsd: 0,
  }));
  const arithmeticA = orderIndependentInput([largeBuy, ...smallBuys, largeSell]);
  const arithmeticB = orderIndependentInput([largeBuy, largeSell, ...smallBuys]);
  const arithmeticVerdictA = evaluateMultiLegRisk(arithmeticA);
  const arithmeticVerdictB = evaluateMultiLegRisk(arithmeticB);
  check('permuted semantic intent has one canonical digest', deriveRiskIntentDigest(arithmeticA.intent) === deriveRiskIntentDigest(arithmeticB.intent));
  check(
    'permuted arithmetic rejects the same true residual',
    checkByCode(arithmeticVerdictA, 'RESIDUAL_DELTA')?.status === 'FAIL' &&
      checkByCode(arithmeticVerdictB, 'RESIDUAL_DELTA')?.status === 'FAIL',
  );
  check('permuted semantic intent has byte-identical verdict', JSON.stringify(arithmeticVerdictA) === JSON.stringify(arithmeticVerdictB));

  const materialResidualRecovery = recoveryInput();
  materialResidualRecovery.intent.legs = [materialResidualRecovery.intent.legs[1]];
  materialResidualRecovery.intent.legs[0].side = 'SELL';
  materialResidualRecovery.intent.legs[0].intendedPrice = 1e300;
  materialResidualRecovery.intent.legs[0].intendedQty = 0.9999999995;
  materialResidualRecovery.market.legs = [materialResidualRecovery.market.legs[1]];
  materialResidualRecovery.market.legs[0].referencePrice = 1e300;
  materialResidualRecovery.market.legs[0].filters.minPrice = 0;
  materialResidualRecovery.market.legs[0].filters.maxPrice = null;
  materialResidualRecovery.market.legs[0].filters.tickSize = 1e300;
  materialResidualRecovery.market.legs[0].filters.minQty = 0;
  materialResidualRecovery.market.legs[0].filters.maxQty = null;
  materialResidualRecovery.market.legs[0].filters.stepSize = 1e-10;
  materialResidualRecovery.market.legs[0].filters.minNotionalUsd = 0;
  materialResidualRecovery.market.legs[0].filters.maxNotionalUsd = null;
  materialResidualRecovery.account.exposures.positions = [materialResidualRecovery.account.exposures.positions[1]];
  materialResidualRecovery.account.exposures.positions[0].signedBaseQty = 1;
  materialResidualRecovery.account.liquidations = [];
  materialResidualRecovery.policy.minLegNotionalUsd = 0;
  materialResidualRecovery.policy.maxLegNotionalUsd = Number.MAX_VALUE;
  materialResidualRecovery.policy.maxGrossNotionalUsd = Number.MAX_VALUE;
  materialResidualRecovery.policy.maxResidualDeltaUsd = Number.MAX_VALUE;
  materialResidualRecovery.policy.maxDailyNotionalUsd = Number.MAX_VALUE;
  rebindIntent(materialResidualRecovery);
  const materialResidualVerdict = evaluateMultiLegRisk(materialResidualRecovery);
  check(
    'tiny base residual with huge notional is still a proven reduction',
    checkByCode(materialResidualVerdict, 'RECOVERY_RISK_REDUCTION')?.status === 'PASS',
  );
  check(
    'material notional residual requires liquidation evidence',
    checkByCode(materialResidualVerdict, 'LIQUIDATION_DISTANCE')?.status === 'UNKNOWN',
  );
  check('material notional residual remains blocked without liquidation truth', !materialResidualVerdict.allowed);

  const boundedLegs = Array.from({ length: 64 }, (_, index) => ({
    legKey: `BOUND_${String(index + 1).padStart(2, '0')}`,
    venue: 'BINANCE_SPOT',
    symbol: SYMBOL,
    positionBucket: 'SPOT_CASH',
    side: index % 2 === 0 ? 'BUY' : 'SELL',
    intendedPrice: 1,
    intendedQty: 1,
    requiredPermission: 'SPOT',
    estimatedRequiredMarginUsd: 0,
  }));
  const boundedIntent = clone(allowedInput().intent);
  boundedIntent.legs = boundedLegs;
  check('64-leg intent is inside the structural ceiling', !validatePlanIntent(boundedIntent).some((issue) => issue.code === 'TOO_MANY_LEGS'));

  const oversizedIntent = clone(boundedIntent);
  oversizedIntent.legs.push({ ...boundedLegs[0], legKey: 'BOUND_65' });
  check('65-leg intent is rejected structurally', validatePlanIntent(oversizedIntent).some((issue) => issue.code === 'TOO_MANY_LEGS'));
  const oversizedInput = allowedInput();
  oversizedInput.intent = oversizedIntent;
  let oversizedThrew = false;
  try {
    evaluateMultiLegRisk(oversizedInput);
  } catch (error) {
    oversizedThrew = error instanceof TypeError && error.message.includes('TOO_MANY_LEGS');
  }
  check('65-leg evaluation fails before any arithmetic pass', oversizedThrew);
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'}: ${results.length - failed.length}/${results.length} risk checks passed.`);
if (failed.length > 0) process.exit(1);
