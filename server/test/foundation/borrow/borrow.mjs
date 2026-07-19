#!/usr/bin/env node
/** Lane J — read-only borrow truth proof. ZERO network, ZERO wall clock. */
import {
  BORROW_COLLATERAL_PRODUCTS,
  BORROW_EVIDENCE_AUTHORITIES,
  BORROW_READ_STATUSES,
  BORROW_TRUTH_STATES,
  MARGIN_ACCOUNT_MODES,
  compareNonNegativeDecimals,
  deriveBorrowTruth,
  deriveBorrowTruthBatch,
  isExactZero,
  normalizeNonNegativeDecimal,
  validateBorrowTruthForConsumption,
} from '../../../dist/foundation/borrow/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}
function throwsTypeError(fn) {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof TypeError;
  }
}

const T0 = 1_800_000_000_000;

function scope(overrides = {}) {
  return {
    accountId: 'acct-main',
    symbol: 'BTCUSDT',
    asset: 'USDT',
    mode: 'CROSS_CLASSIC',
    permissionId: 'key-read-margin-01',
    ...overrides,
  };
}

function stamp(sourceId, overrides = {}) {
  return {
    sourceTimeMs: T0 - 100,
    receivedAtMs: T0 - 50,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
    ...overrides,
  };
}

function account(identity = scope(), overrides = {}) {
  return {
    ...identity,
    status: 'OK',
    observedAt: stamp('binance.margin.account'),
    accountCreated: true,
    modeEnabled: true,
    borrowEnabled: true,
    ...overrides,
  };
}

function permission(identity = scope(), overrides = {}) {
  return {
    ...identity,
    status: 'OK',
    observedAt: stamp('binance.account.apiRestrictions'),
    enableReading: true,
    enableMargin: true,
    enableSpotAndMarginTrading: true,
    ...overrides,
  };
}

function maxBorrow(identity = scope(), overrides = {}) {
  return {
    ...identity,
    status: 'OK',
    observedAt: stamp('binance.margin.maxBorrowable'),
    amount: '5.2500',
    borrowLimit: '10.000',
    ...overrides,
  };
}

function rate(identity = scope(), overrides = {}) {
  return {
    ...identity,
    status: 'OK',
    observedAt: stamp('binance.margin.nextHourlyInterestRate'),
    hourlyRate: '0.0001200',
    ...overrides,
  };
}

function liability(identity = scope(), overrides = {}) {
  return {
    ...identity,
    status: 'OK',
    observedAt: stamp('binance.margin.account.liability'),
    currentBorrowedAsset: '1.5000',
    accruedInterestAsset: '0.012500',
    ...overrides,
  };
}

function collateral(identity = scope(), overrides = {}) {
  return {
    ...identity,
    status: 'OK',
    observedAt: stamp('fixture.margin.same-scope.collateral-ltv'),
    product: 'MARGIN_ACCOUNT',
    collateralAmount: '2500.000',
    collateralAsset: 'USDT',
    currentLtv: '0.2500',
    ...overrides,
  };
}

function completeInput(scopeOverrides = {}) {
  const identity = scope(scopeOverrides);
  return {
    scope: identity,
    nowMs: T0,
    account: account(identity),
    permission: permission(identity),
    maxBorrow: maxBorrow(identity),
    rate: rate(identity),
    liability: liability(identity),
    collateral: collateral(identity),
  };
}

function clone(value) {
  return structuredClone(value);
}

function trappedProxy(target) {
  const calls = [];
  const record = (name, operation) => (...args) => {
    calls.push(name);
    return operation(...args);
  };
  return {
    calls,
    proxy: new Proxy(target, {
      get: record('get', Reflect.get),
      getOwnPropertyDescriptor: record('getOwnPropertyDescriptor', Reflect.getOwnPropertyDescriptor),
      getPrototypeOf: record('getPrototypeOf', Reflect.getPrototypeOf),
      has: record('has', Reflect.has),
      ownKeys: record('ownKeys', Reflect.ownKeys),
    }),
  };
}

function zeroTimeInput() {
  const input = completeInput();
  input.nowMs = 0;
  for (const key of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    input[key].observedAt.sourceTimeMs = 0;
    input[key].observedAt.receivedAtMs = 0;
  }
  return input;
}

// ---------------------------------------------------------------------
section('1. exact public vocabulary and a fully evidenced AVAILABLE truth');
{
  check('eight states are exact and ordered', BORROW_TRUTH_STATES.join('|') === 'AVAILABLE|UNAVAILABLE|UNKNOWN|STALE|PERMISSION_MISSING|ACCOUNT_MODE_MISMATCH|RATE_LIMITED|SOURCE_ERROR');
  check('read statuses are closed', BORROW_READ_STATUSES.join('|') === 'OK|RATE_LIMITED|SOURCE_ERROR|UNAVAILABLE');
  check('collateral product identity admits margin account only', BORROW_COLLATERAL_PRODUCTS.join('|') === 'MARGIN_ACCOUNT');
  check('account modes keep cross generations distinct', MARGIN_ACCOUNT_MODES.join('|') === 'CROSS_CLASSIC|CROSS_PRO|ISOLATED');

  const input = completeInput();
  const before = JSON.stringify(input);
  const truth = deriveBorrowTruth(input);
  check('positive exact amount is AVAILABLE', truth.state === 'AVAILABLE' && truth.reason === 'BORROW_AMOUNT_POSITIVE');
  check('scope identity is preserved', truth.accountId === input.scope.accountId && truth.symbol === 'BTCUSDT' && truth.asset === 'USDT');
  check('permission snapshot identity is preserved', truth.permissionId === input.scope.permissionId);
  check('owner content digest is canonical and deterministic', /^borrow_truth_[0-9a-f]{32}$/.test(truth.contentDigest) && truth.contentDigest === deriveBorrowTruth(completeInput()).contentDigest);
  check('cross modes map to the cross risk bucket', truth.positionBucket === 'MARGIN_CROSS');
  check('amount is canonical without binary conversion', truth.maxBorrowableAsset === '5.25');
  check('account limit is independently retained', truth.borrowLimitAsset === '10');
  check('hourly rate is canonical without rounding', truth.hourlyRate === '0.00012');
  check('current borrowed amount is canonical without folding in interest', truth.currentBorrowedAsset === '1.5');
  check('accrued interest remains a separate exact fact', truth.accruedInterestAsset === '0.0125');
  check('optional same-margin collateral amount retains its explicit unit', truth.collateralAmount === '2500' && truth.collateralAsset === 'USDT');
  check('independently supplied same-margin LTV remains a fractional exact value', truth.currentLtv === '0.25');
  check('injected time is the only evaluation time', truth.evaluatedAtMs === T0);
  check('earliest evidence expiry is explicit and inclusive', truth.expiresAtMs === T0 + 900);
  check('all six freshness reports are FRESH', Object.values(truth.freshness).every((x) => x?.state === 'FRESH'));
  check('source identity survives in provenance', truth.provenance.maxBorrow.sourceId === 'binance.margin.maxBorrowable');
  check('liability and optional collateral retain independent source identities', truth.provenance.liability.sourceId === 'binance.margin.account.liability' && truth.provenance.collateral.sourceId === 'fixture.margin.same-scope.collateral-ltv');
  check('input was not mutated', JSON.stringify(input) === before);
  check('result, provenance, freshness and timestamps are frozen', Object.isFrozen(truth) && Object.isFrozen(truth.provenance) && Object.isFrozen(truth.freshness) && Object.isFrozen(truth.provenance.maxBorrow));
  const originalState = truth.state;
  try { truth.state = 'UNKNOWN'; } catch {}
  try { truth.provenance.maxBorrow.sourceId = 'tampered'; } catch {}
  check('mutation attempts cannot alter truth', truth.state === originalState && truth.provenance.maxBorrow.sourceId === 'binance.margin.maxBorrowable');

  check(
    'private-account evidence authorities are explicit and closed',
    BORROW_EVIDENCE_AUTHORITIES.join('|') === 'LIVE_PRIVATE|RECORDED_REPLAY|SYNTHETIC_TEST',
  );
  const consumed = validateBorrowTruthForConsumption(truth, {
    evaluatedAtMs: T0,
    acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
    requireRate: false,
  });
  check(
    'a canonical AVAILABLE truth passes the reusable exact consumer boundary',
    consumed.issues.length === 0 && consumed.truth !== null,
  );
  check(
    'consumer boundary returns one deeply frozen detached exact snapshot',
    consumed.truth !== truth
      && Object.isFrozen(consumed)
      && Object.isFrozen(consumed.issues)
      && Object.isFrozen(consumed.truth)
      && Object.isFrozen(consumed.truth.provenance)
      && Object.isFrozen(consumed.truth.freshness)
      && Object.values(consumed.truth.provenance).every((value) => value === null || Object.isFrozen(value))
      && Object.values(consumed.truth.freshness).every((value) => value === null || Object.isFrozen(value)),
  );

  const savedNow = Date.now;
  Date.now = () => { throw new Error('wall clock forbidden'); };
  let pureState = null;
  try { pureState = deriveBorrowTruth(completeInput()).state; } finally { Date.now = savedNow; }
  check('derivation never reads wall clock', pureState === 'AVAILABLE');
}

// ---------------------------------------------------------------------
section('1b. private/replay/test authority is explicit and mixed cuts fail closed');
{
  for (const authority of BORROW_EVIDENCE_AUTHORITIES) {
    const input = completeInput();
    for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
      input[evidenceName].observedAt.authority = authority;
    }
    check(`${authority} is admitted when the whole evidence cut agrees`, deriveBorrowTruth(input).state === 'AVAILABLE');
  }

  for (const authority of ['LIVE_PUBLIC', 'DERIVED_LIVE']) {
    const input = completeInput();
    for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
      input[evidenceName].observedAt.authority = authority;
    }
    const truth = deriveBorrowTruth(input);
    check(
      `${authority} cannot impersonate signed private-account evidence`,
      truth.state === 'SOURCE_ERROR' && truth.reason === 'PRIVATE_AUTHORITY_REQUIRED',
    );
  }

  const mixed = completeInput();
  for (const evidenceName of ['permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    mixed[evidenceName].observedAt.authority = 'RECORDED_REPLAY';
  }
  mixed.account.observedAt.authority = 'LIVE_PRIVATE';
  const mixedTruth = deriveBorrowTruth(mixed);
  check(
    'a mixed accepted-authority cut is never published as AVAILABLE',
    mixedTruth.state === 'SOURCE_ERROR' && mixedTruth.reason === 'EVIDENCE_AUTHORITY_MISMATCH',
  );

  const generic = completeInput();
  generic.maxBorrow.observedAt.authority = 'GENERIC_INJECTED';
  check('an open-ended injected authority is structurally rejected', throwsTypeError(() => deriveBorrowTruth(generic)));

  const canonical = deriveBorrowTruth(completeInput());
  const forgedLiability = { ...canonical, currentBorrowedAsset: null };
  const liabilityIssues = validateBorrowTruthForConsumption(forgedLiability, {
    evaluatedAtMs: T0,
    acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
    requireRate: false,
  }).issues;
  check(
    'consumer validation rejects a hand-shaped AVAILABLE truth with incomplete liability',
    liabilityIssues.includes('BORROW_TRUTH_AVAILABLE_CURRENT_BORROW_MISSING'),
  );

  const extra = { ...canonical, injectedConfidence: '1' };
  check(
    'consumer validation enforces the exact BorrowTruth key set',
    validateBorrowTruthForConsumption(extra, {
      evaluatedAtMs: T0,
      acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
      requireRate: false,
    }).issues.includes('BORROW_TRUTH_SCHEMA_INVALID'),
  );

  const noRateInput = completeInput();
  noRateInput.rate = null;
  const noRateTruth = deriveBorrowTruth(noRateInput);
  const economicsIssues = validateBorrowTruthForConsumption(noRateTruth, {
    evaluatedAtMs: T0,
    acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
    requireRate: true,
  }).issues;
  check(
    'a rate-requiring consumer can reuse the boundary without weakening Borrow availability',
    economicsIssues.includes('BORROW_TRUTH_AVAILABLE_RATE_MISSING')
      && economicsIssues.includes('BORROW_TRUTH_RATE_EVIDENCE_MISSING'),
  );

  const staleCollateralInput = completeInput();
  staleCollateralInput.collateral.observedAt.sourceTimeMs = T0 - 1_001;
  const staleCollateralTruth = deriveBorrowTruth(staleCollateralInput);
  check(
    'stale optional collateral remains honest null and does not invalidate the authorized liability cut',
    validateBorrowTruthForConsumption(staleCollateralTruth, {
      evaluatedAtMs: T0,
      acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
      requireRate: false,
    }).issues.length === 0,
  );
}

// ---------------------------------------------------------------------
section('1c. retained-digest forgeries cannot preserve owner identity');
{
  const canonical = deriveBorrowTruth(completeInput());
  const policy = {
    evaluatedAtMs: T0,
    acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
    requireRate: false,
  };
  const publishedFactMutations = [
    ['accountId', (truth) => { truth.accountId = 'acct-other'; }],
    ['symbol', (truth) => { truth.symbol = 'ETHUSDT'; }],
    ['asset', (truth) => { truth.asset = 'BTC'; }],
    ['mode', (truth) => { truth.mode = 'CROSS_PRO'; }],
    ['permissionId', (truth) => { truth.permissionId = 'key-read-margin-02'; }],
    ['state', (truth) => { truth.state = 'UNKNOWN'; }],
    ['reason', (truth) => { truth.reason = 'BORROW_AMOUNT_ZERO'; }],
    ['maxBorrowableAsset', (truth) => { truth.maxBorrowableAsset = '5'; }],
    ['borrowLimitAsset', (truth) => { truth.borrowLimitAsset = '11'; }],
    ['hourlyRate', (truth) => { truth.hourlyRate = '0.00013'; }],
    ['currentBorrowedAsset', (truth) => { truth.currentBorrowedAsset = '1.6'; }],
    ['accruedInterestAsset', (truth) => { truth.accruedInterestAsset = '0.0126'; }],
    ['collateralAmount', (truth) => { truth.collateralAmount = '2501'; }],
    ['collateralAsset', (truth) => { truth.collateralAsset = 'USDC'; }],
    ['currentLtv', (truth) => { truth.currentLtv = '0.26'; }],
    ['evaluatedAtMs', (truth) => { truth.evaluatedAtMs = T0 - 1; }],
    ['expiresAtMs', (truth) => { truth.expiresAtMs = T0 + 899; }],
  ];
  for (const [field, mutate] of publishedFactMutations) {
    const forged = clone(canonical);
    mutate(forged);
    const result = validateBorrowTruthForConsumption(forged, policy);
    check(
      `retaining a digest while changing ${field} is rejected`,
      result.issues.includes('BORROW_TRUTH_CONTENT_DIGEST_MISMATCH'),
    );
  }

  const isolated = deriveBorrowTruth(completeInput({ mode: 'ISOLATED' }));
  const forgedBucket = clone(isolated);
  forgedBucket.mode = 'CROSS_CLASSIC';
  forgedBucket.positionBucket = 'MARGIN_CROSS';
  check(
    'retaining a digest across a structurally valid position-bucket change is rejected',
    validateBorrowTruthForConsumption(forgedBucket, policy).issues.includes('BORROW_TRUTH_CONTENT_DIGEST_MISMATCH'),
  );

  for (const key of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    const forgedProvenance = clone(canonical);
    forgedProvenance.provenance[key].sourceId += '.forged';
    check(
      `retaining a digest while changing ${key} provenance is rejected`,
      validateBorrowTruthForConsumption(forgedProvenance, policy).issues.includes('BORROW_TRUTH_CONTENT_DIGEST_MISMATCH'),
    );

    const forgedFreshness = clone(canonical);
    forgedFreshness.freshness[key].ageMs += 1;
    check(
      `retaining a digest while changing ${key} freshness is rejected`,
      validateBorrowTruthForConsumption(forgedFreshness, policy).issues.includes('BORROW_TRUTH_CONTENT_DIGEST_MISMATCH'),
    );
  }

  const forgedDigest = clone(canonical);
  forgedDigest.contentDigest = 'borrow_truth_00000000000000000000000000000000';
  check(
    'a shape-valid invented digest cannot mint a BorrowTruth',
    validateBorrowTruthForConsumption(forgedDigest, policy).issues.includes('BORROW_TRUTH_CONTENT_DIGEST_MISMATCH'),
  );
}

// ---------------------------------------------------------------------
section('2. exact zero, unknown, disabled and unavailable stay distinct');
{
  for (const zero of ['0', '0.0', '000.000000']) {
    const input = completeInput();
    input.maxBorrow.amount = zero;
    const truth = deriveBorrowTruth(input);
    check(`exact zero ${zero} is known UNAVAILABLE`, truth.state === 'UNAVAILABLE' && truth.reason === 'BORROW_AMOUNT_ZERO' && truth.maxBorrowableAsset === '0');
  }

  const unknownAmount = completeInput();
  unknownAmount.maxBorrow.amount = null;
  check('null amount is UNKNOWN, not zero', deriveBorrowTruth(unknownAmount).state === 'UNKNOWN' && deriveBorrowTruth(unknownAmount).reason === 'BORROW_AMOUNT_UNKNOWN');

  const disabled = completeInput();
  disabled.account.borrowEnabled = false;
  check('explicit account borrow disable is UNAVAILABLE', deriveBorrowTruth(disabled).state === 'UNAVAILABLE' && deriveBorrowTruth(disabled).reason === 'BORROW_DISABLED');

  const unavailable = completeInput();
  unavailable.maxBorrow = maxBorrow(unavailable.scope, { status: 'UNAVAILABLE', amount: null, borrowLimit: null });
  check('fresh explicit source unavailability is UNAVAILABLE', deriveBorrowTruth(unavailable).state === 'UNAVAILABLE' && deriveBorrowTruth(unavailable).reason === 'SOURCE_UNAVAILABLE');

  for (const missing of ['account', 'permission', 'maxBorrow', 'liability']) {
    const input = completeInput();
    input[missing] = null;
    const truth = deriveBorrowTruth(input);
    check(`missing ${missing} is explicit UNKNOWN`, truth.state === 'UNKNOWN' && truth.reason === 'REQUIRED_EVIDENCE_MISSING');
  }

  const optionalRate = completeInput();
  optionalRate.rate = null;
  const noRate = deriveBorrowTruth(optionalRate);
  check('missing optional rate does not fabricate or erase availability', noRate.state === 'AVAILABLE' && noRate.hourlyRate === null && noRate.provenance.rate === null);

  const absentCollateral = completeInput();
  absentCollateral.collateral = null;
  const noCollateralEvidence = deriveBorrowTruth(absentCollateral);
  check(
    'ENGINE §11 optional collateral absence preserves borrow availability without fabricating fields',
    noCollateralEvidence.state === 'AVAILABLE'
      && noCollateralEvidence.collateralAmount === null
      && noCollateralEvidence.collateralAsset === null
      && noCollateralEvidence.currentLtv === null
      && noCollateralEvidence.provenance.collateral === null
      && noCollateralEvidence.freshness.collateral === null,
  );

  for (const field of ['enableReading', 'enableMargin', 'enableSpotAndMarginTrading']) {
    const input = completeInput();
    input.permission[field] = null;
    const truth = deriveBorrowTruth(input);
    check(`unknown ${field} remains UNKNOWN`, truth.state === 'UNKNOWN' && truth.reason === 'PERMISSION_UNKNOWN');
  }
  for (const field of ['accountCreated', 'modeEnabled', 'borrowEnabled']) {
    const input = completeInput();
    input.account[field] = null;
    const truth = deriveBorrowTruth(input);
    check(`unknown ${field} remains UNKNOWN`, truth.state === 'UNKNOWN' && truth.reason === 'ACCOUNT_STATUS_UNKNOWN');
  }

  for (const [field, reason] of [
    ['currentBorrowedAsset', 'CURRENT_BORROW_UNKNOWN'],
    ['accruedInterestAsset', 'ACCRUED_INTEREST_UNKNOWN'],
  ]) {
    const input = completeInput();
    input.liability[field] = null;
    const truth = deriveBorrowTruth(input);
    check(`unknown ${field} remains null and blocks availability`, truth.state === 'UNKNOWN' && truth.reason === reason && truth[field] === null);
  }

  const missingCollateral = completeInput();
  Object.assign(missingCollateral.collateral, { collateralAmount: null, collateralAsset: null, currentLtv: null });
  const noCollateral = deriveBorrowTruth(missingCollateral);
  check('same-margin collateral field unknowns stay null without blocking required preflight', noCollateral.state === 'AVAILABLE' && noCollateral.collateralAmount === null && noCollateral.collateralAsset === null && noCollateral.currentLtv === null);

  const missingLtv = completeInput();
  missingLtv.collateral.currentLtv = null;
  const noLtv = deriveBorrowTruth(missingLtv);
  check('missing same-margin LTV is never derived from borrowed and collateral amounts', noLtv.state === 'AVAILABLE' && noLtv.collateralAmount === '2500' && noLtv.currentLtv === null);

  const exactZeroExposure = completeInput();
  Object.assign(exactZeroExposure.liability, { currentBorrowedAsset: '0.000', accruedInterestAsset: '0' });
  Object.assign(exactZeroExposure.collateral, { collateralAmount: '0', collateralAsset: 'USDT', currentLtv: '0.0' });
  const zeroExposure = deriveBorrowTruth(exactZeroExposure);
  check('observed zero exposure stays an exact zero rather than unknown', zeroExposure.state === 'AVAILABLE' && zeroExposure.currentBorrowedAsset === '0' && zeroExposure.accruedInterestAsset === '0' && zeroExposure.collateralAmount === '0' && zeroExposure.currentLtv === '0');

  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability']) {
    const input = completeInput();
    input[evidenceName].observedAt.completeness = 'PARTIAL';
    const truth = deriveBorrowTruth(input);
    check(`partial ${evidenceName} evidence is UNKNOWN`, truth.state === 'UNKNOWN' && truth.reason === 'EVIDENCE_PARTIAL');
  }

  const partialCollateral = completeInput();
  partialCollateral.collateral.observedAt.completeness = 'PARTIAL';
  const partialCollateralTruth = deriveBorrowTruth(partialCollateral);
  check(
    'partial optional collateral is field-unknown without blocking required preflight',
    partialCollateralTruth.state === 'AVAILABLE'
      && partialCollateralTruth.collateralAmount === null
      && partialCollateralTruth.currentLtv === null
      && partialCollateralTruth.provenance.collateral.completeness === 'PARTIAL',
  );
}

// ---------------------------------------------------------------------
section('3. evidence expiry, receipt fallback, and clock skew are explicit');
{
  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability']) {
    const boundary = completeInput();
    boundary[evidenceName].observedAt.sourceTimeMs = T0 - 1_000;
    check(`${evidenceName} is fresh at exact max-age boundary`, deriveBorrowTruth(boundary).state === 'AVAILABLE');

    const stale = completeInput();
    stale[evidenceName].observedAt.sourceTimeMs = T0 - 1_001;
    const truth = deriveBorrowTruth(stale);
    check(`${evidenceName} expires one millisecond after boundary`, truth.state === 'STALE' && truth.reason === 'EVIDENCE_EXPIRED');
  }

  const staleCollateral = completeInput();
  staleCollateral.collateral.observedAt.sourceTimeMs = T0 - 1_001;
  const staleCollateralTruth = deriveBorrowTruth(staleCollateral);
  check(
    'stale optional collateral cannot publish fields or shorten required truth expiry',
    staleCollateralTruth.state === 'AVAILABLE'
      && staleCollateralTruth.collateralAmount === null
      && staleCollateralTruth.currentLtv === null
      && staleCollateralTruth.freshness.collateral.state === 'STALE'
      && staleCollateralTruth.expiresAtMs === T0 + 900,
  );

  const skewedCollateral = completeInput();
  skewedCollateral.collateral.observedAt.sourceTimeMs = T0 + 2_001;
  const skewedCollateralTruth = deriveBorrowTruth(skewedCollateral);
  check(
    'clock-skewed optional collateral remains field-unknown',
    skewedCollateralTruth.state === 'AVAILABLE'
      && skewedCollateralTruth.collateralAmount === null
      && skewedCollateralTruth.currentLtv === null
      && skewedCollateralTruth.freshness.collateral.state === 'CLOCK_SKEWED',
  );

  const sourceWins = completeInput();
  sourceWins.maxBorrow.observedAt.sourceTimeMs = T0 - 1_001;
  sourceWins.maxBorrow.observedAt.receivedAtMs = T0;
  check('source time wins over a fresh local receipt', deriveBorrowTruth(sourceWins).state === 'STALE');

  const receiptFallback = completeInput();
  receiptFallback.maxBorrow.observedAt.sourceTimeMs = null;
  receiptFallback.maxBorrow.observedAt.receivedAtMs = T0 - 1_000;
  check('receipt time is used only when source time is absent', deriveBorrowTruth(receiptFallback).state === 'AVAILABLE' && deriveBorrowTruth(receiptFallback).freshness.maxBorrow.basis === 'RECEIPT_TIME');
  receiptFallback.maxBorrow.observedAt.receivedAtMs = T0 - 1_001;
  check('receipt fallback also expires', deriveBorrowTruth(receiptFallback).state === 'STALE');

  const skewBoundary = completeInput();
  skewBoundary.account.observedAt.sourceTimeMs = T0 + 2_000;
  check('future fact at skew tolerance remains fresh', deriveBorrowTruth(skewBoundary).state === 'AVAILABLE');
  skewBoundary.account.observedAt.sourceTimeMs = T0 + 2_001;
  const skewed = deriveBorrowTruth(skewBoundary);
  check('future fact beyond skew tolerance is SOURCE_ERROR', skewed.state === 'SOURCE_ERROR' && skewed.reason === 'EVIDENCE_CLOCK_SKEWED');

  const unavailableAuthority = completeInput();
  unavailableAuthority.permission.observedAt.authority = 'UNAVAILABLE';
  unavailableAuthority.permission.observedAt.completeness = 'UNAVAILABLE';
  check('unavailable timestamp authority cannot be upgraded', deriveBorrowTruth(unavailableAuthority).state === 'UNAVAILABLE');
}

// ---------------------------------------------------------------------
section('4. permissions, account mode and all source outcomes are fail-closed');
{
  for (const field of ['enableReading', 'enableMargin', 'enableSpotAndMarginTrading']) {
    const input = completeInput();
    input.permission[field] = false;
    const truth = deriveBorrowTruth(input);
    check(`false ${field} is PERMISSION_MISSING`, truth.state === 'PERMISSION_MISSING' && truth.reason === 'MARGIN_PERMISSION_DISABLED');
  }

  const wrongPermissionIdentity = completeInput();
  wrongPermissionIdentity.permission.permissionId = 'different-key-snapshot';
  const wrongPermissionTruth = deriveBorrowTruth(wrongPermissionIdentity);
  check('wrong permission snapshot identity is PERMISSION_MISSING', wrongPermissionTruth.state === 'PERMISSION_MISSING' && wrongPermissionTruth.reason === 'PERMISSION_IDENTITY_MISMATCH');

  for (const field of ['accountCreated', 'modeEnabled']) {
    const input = completeInput();
    input.account[field] = false;
    const truth = deriveBorrowTruth(input);
    check(`false ${field} is ACCOUNT_MODE_MISMATCH`, truth.state === 'ACCOUNT_MODE_MISMATCH');
  }

  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    const input = completeInput();
    input[evidenceName].mode = 'ISOLATED';
    const truth = deriveBorrowTruth(input);
    check(`mode mismatch on ${evidenceName} is ACCOUNT_MODE_MISMATCH`, truth.state === 'ACCOUNT_MODE_MISMATCH' && truth.reason === 'MODE_IDENTITY_MISMATCH');
  }

  const isolated = completeInput({ accountId: 'acct-iso', symbol: 'ETHUSDT', asset: 'USDT', mode: 'ISOLATED' });
  check('isolated identity maps to isolated bucket', deriveBorrowTruth(isolated).positionBucket === 'MARGIN_ISOLATED');
  const crossPro = completeInput({ mode: 'CROSS_PRO' });
  check('cross-pro identity remains cross bucket', deriveBorrowTruth(crossPro).positionBucket === 'MARGIN_CROSS');

  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability']) {
    const input = completeInput();
    const emptyPayload = evidenceName === 'account'
      ? { accountCreated: null, modeEnabled: null, borrowEnabled: null }
      : evidenceName === 'permission'
        ? { enableReading: null, enableMargin: null, enableSpotAndMarginTrading: null }
        : evidenceName === 'maxBorrow'
          ? { amount: null, borrowLimit: null }
          : evidenceName === 'rate'
            ? { hourlyRate: null }
            : evidenceName === 'liability'
              ? { currentBorrowedAsset: null, accruedInterestAsset: null }
              : { collateralAmount: null, collateralAsset: null, currentLtv: null };
    Object.assign(input[evidenceName], emptyPayload, { status: 'RATE_LIMITED' });
    const truth = deriveBorrowTruth(input);
    check(`rate limit on ${evidenceName} is RATE_LIMITED`, truth.state === 'RATE_LIMITED' && truth.reason === 'SOURCE_RATE_LIMITED');
  }

  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability']) {
    const input = completeInput();
    const emptyPayload = evidenceName === 'account'
      ? { accountCreated: null, modeEnabled: null, borrowEnabled: null }
      : evidenceName === 'permission'
        ? { enableReading: null, enableMargin: null, enableSpotAndMarginTrading: null }
        : evidenceName === 'maxBorrow'
          ? { amount: null, borrowLimit: null }
          : evidenceName === 'rate'
            ? { hourlyRate: null }
            : evidenceName === 'liability'
              ? { currentBorrowedAsset: null, accruedInterestAsset: null }
              : { collateralAmount: null, collateralAsset: null, currentLtv: null };
    Object.assign(input[evidenceName], emptyPayload, { status: 'SOURCE_ERROR' });
    const truth = deriveBorrowTruth(input);
    check(`source failure on ${evidenceName} is SOURCE_ERROR`, truth.state === 'SOURCE_ERROR' && truth.reason === 'SOURCE_REPORTED_ERROR');
  }

  for (const status of ['RATE_LIMITED', 'SOURCE_ERROR', 'UNAVAILABLE']) {
    const optionalFailure = completeInput();
    Object.assign(optionalFailure.collateral, {
      status,
      collateralAmount: null,
      collateralAsset: null,
      currentLtv: null,
    });
    const truth = deriveBorrowTruth(optionalFailure);
    check(
      `${status} optional collateral stays field-unknown without blocking required preflight`,
      truth.state === 'AVAILABLE'
        && truth.collateralAmount === null
        && truth.collateralAsset === null
        && truth.currentLtv === null,
    );
  }

  const errorAndLimit = completeInput();
  Object.assign(errorAndLimit.account, { status: 'RATE_LIMITED', accountCreated: null, modeEnabled: null, borrowEnabled: null });
  Object.assign(errorAndLimit.maxBorrow, { status: 'SOURCE_ERROR', amount: null, borrowLimit: null });
  check('source error deterministically outranks simultaneous rate limit', deriveBorrowTruth(errorAndLimit).state === 'SOURCE_ERROR');

  const limitAndUnavailable = completeInput();
  Object.assign(limitAndUnavailable.permission, { status: 'RATE_LIMITED', enableReading: null, enableMargin: null, enableSpotAndMarginTrading: null });
  Object.assign(limitAndUnavailable.maxBorrow, { status: 'UNAVAILABLE', amount: null, borrowLimit: null });
  check('rate limit deterministically outranks explicit read unavailability', deriveBorrowTruth(limitAndUnavailable).state === 'RATE_LIMITED');
}

// ---------------------------------------------------------------------
section('5. account, symbol, asset, mode and permission evidence cannot be substituted');
{
  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    for (const [field, wrong] of [['accountId', 'acct-other'], ['symbol', 'ETHUSDT'], ['asset', 'ETH']]) {
      const input = completeInput();
      input[evidenceName][field] = wrong;
      const truth = deriveBorrowTruth(input);
      check(`${evidenceName} ${field} substitution is SOURCE_ERROR`, truth.state === 'SOURCE_ERROR' && truth.reason === 'EVIDENCE_IDENTITY_MISMATCH');
    }
  }

  const wrongQuote = completeInput();
  wrongQuote.maxBorrow.symbol = 'ETHUSDT';
  const wrongQuoteTruth = deriveBorrowTruth(wrongQuote);
  check('mismatched max-borrow values are never relabelled under target scope', wrongQuoteTruth.maxBorrowableAsset === null && wrongQuoteTruth.borrowLimitAsset === null);
  const wrongRate = completeInput();
  wrongRate.rate.asset = 'BTC';
  check('mismatched rate value is never relabelled under target scope', deriveBorrowTruth(wrongRate).hourlyRate === null);

  const wrongCollateral = completeInput();
  wrongCollateral.collateral.symbol = 'ETHUSDT';
  const wrongCollateralTruth = deriveBorrowTruth(wrongCollateral);
  check('mismatched optional collateral is never relabelled under margin truth', wrongCollateralTruth.state === 'SOURCE_ERROR' && wrongCollateralTruth.collateralAmount === null && wrongCollateralTruth.currentLtv === null);

  const failedWrongCollateral = completeInput();
  Object.assign(failedWrongCollateral.collateral, {
    symbol: 'ETHUSDT',
    status: 'SOURCE_ERROR',
    collateralAmount: null,
    collateralAsset: null,
    currentLtv: null,
  });
  const failedWrongCollateralTruth = deriveBorrowTruth(failedWrongCollateral);
  check(
    'optional collateral source failure cannot hide a cross-scope substitution',
    failedWrongCollateralTruth.state === 'SOURCE_ERROR'
      && failedWrongCollateralTruth.reason === 'EVIDENCE_IDENTITY_MISMATCH'
      && failedWrongCollateralTruth.collateralAmount === null,
  );

  for (const evidenceName of ['account', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    const input = completeInput();
    input[evidenceName].permissionId = 'different-key-snapshot';
    check(`${evidenceName} permission binding cannot be substituted`, deriveBorrowTruth(input).state === 'SOURCE_ERROR');
  }

  const modeOutranksStatus = completeInput();
  Object.assign(modeOutranksStatus.maxBorrow, { mode: 'ISOLATED', status: 'RATE_LIMITED', amount: null, borrowLimit: null });
  check('identity mode mismatch is visible even when read was rate limited', deriveBorrowTruth(modeOutranksStatus).state === 'ACCOUNT_MODE_MISMATCH');

  const permissionOutranksStatus = completeInput();
  Object.assign(permissionOutranksStatus.permission, { permissionId: 'wrong-key', status: 'SOURCE_ERROR', enableReading: null, enableMargin: null, enableSpotAndMarginTrading: null });
  check('permission identity mismatch is visible even when permission read failed', deriveBorrowTruth(permissionOutranksStatus).state === 'PERMISSION_MISSING');
}

// ---------------------------------------------------------------------
section('6. malformed and contradictory evidence fails consistently with TypeError');
{
  check('null input rejected', throwsTypeError(() => deriveBorrowTruth(null)));
  check('array input rejected', throwsTypeError(() => deriveBorrowTruth([])));
  check('class-instance input rejected', throwsTypeError(() => deriveBorrowTruth(new (class Fixture {})())));
  const missingNow = completeInput(); delete missingNow.nowMs;
  check('missing injected time rejected', throwsTypeError(() => deriveBorrowTruth(missingNow)));
  for (const badNow of [NaN, Infinity, -1, 1.5, '1800000000000']) {
    const input = completeInput(); input.nowMs = badNow;
    check(`invalid nowMs ${String(badNow)} rejected`, throwsTypeError(() => deriveBorrowTruth(input)));
  }
  const plusZeroTruth = deriveBorrowTruth(zeroTimeInput());
  check(
    'positive zero is a valid injected clock and remains positive in every derived time cut',
    Object.is(plusZeroTruth.evaluatedAtMs, 0)
      && Object.values(plusZeroTruth.provenance).every((value) => Object.is(value.sourceTimeMs, 0) && Object.is(value.receivedAtMs, 0))
      && Object.values(plusZeroTruth.freshness).every((value) => Object.is(value.ageMs, 0) && Object.is(value.evaluatedAt, 0))
      && validateBorrowTruthForConsumption(plusZeroTruth, {
        evaluatedAtMs: 0,
        acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
        requireRate: false,
      }).issues.length === 0,
  );
  const negativeZeroNow = zeroTimeInput(); negativeZeroNow.nowMs = -0;
  check('negative-zero nowMs is rejected before digest derivation', throwsTypeError(() => deriveBorrowTruth(negativeZeroNow)));
  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    for (const field of ['sourceTimeMs', 'receivedAtMs', 'maxAgeMs']) {
      const input = zeroTimeInput(); input[evidenceName].observedAt[field] = -0;
      check(
        `negative-zero ${evidenceName}.${field} is rejected before freshness/digest derivation`,
        throwsTypeError(() => deriveBorrowTruth(input)),
      );
    }
  }

  check(
    'negative-zero consumer policy time is rejected before truth capture',
    throwsTypeError(() => validateBorrowTruthForConsumption(plusZeroTruth, {
      evaluatedAtMs: -0,
      acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
      requireRate: false,
    })),
  );
  for (const [field, issue] of [
    ['evaluatedAtMs', 'BORROW_TRUTH_EVALUATED_AT_INVALID'],
    ['expiresAtMs', 'BORROW_TRUTH_EXPIRES_AT_INVALID'],
  ]) {
    const truth = clone(plusZeroTruth); truth[field] = -0;
    const result = validateBorrowTruthForConsumption(truth, {
      evaluatedAtMs: 0,
      acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
      requireRate: false,
    });
    check(`negative-zero truth ${field} fails structurally before digest comparison`, result.truth === null && result.issues.includes(issue));
  }
  for (const key of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    for (const field of ['sourceTimeMs', 'receivedAtMs', 'maxAgeMs']) {
      const truth = clone(plusZeroTruth); truth.provenance[key][field] = -0;
      const result = validateBorrowTruthForConsumption(truth, {
        evaluatedAtMs: 0,
        acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
        requireRate: false,
      });
      check(
        `negative-zero ${key} provenance ${field} fails structurally before digest comparison`,
        result.truth === null && result.issues.includes(`BORROW_TRUTH_${key.toUpperCase()}_SOURCE_SCHEMA_INVALID`),
      );
    }
    for (const field of ['ageMs', 'evaluatedAt']) {
      const truth = clone(plusZeroTruth); truth.freshness[key][field] = -0;
      const result = validateBorrowTruthForConsumption(truth, {
        evaluatedAtMs: 0,
        acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
        requireRate: false,
      });
      check(
        `negative-zero ${key} freshness ${field} fails structurally before digest comparison`,
        result.truth === null && result.issues.includes(`BORROW_TRUTH_${key.toUpperCase()}_FRESHNESS_SCHEMA_INVALID`),
      );
    }
  }

  for (const [field, bad] of [
    ['accountId', ''], ['accountId', 'with space'], ['symbol', 'btcusdt'], ['symbol', 'B/USDT'],
    ['asset', 'usd t'], ['mode', 'CROSS'], ['permissionId', ''], ['permissionId', 'secret key'],
  ]) {
    const input = completeInput(); input.scope[field] = bad;
    check(`invalid scope ${field} rejected`, throwsTypeError(() => deriveBorrowTruth(input)));
  }

  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    const implicit = completeInput(); delete implicit[evidenceName];
    check(`implicit undefined ${evidenceName} rejected; null required`, throwsTypeError(() => deriveBorrowTruth(implicit)));
    const nonObject = completeInput(); nonObject[evidenceName] = [];
    check(`non-object ${evidenceName} rejected`, throwsTypeError(() => deriveBorrowTruth(nonObject)));
    const badStatus = completeInput(); badStatus[evidenceName].status = 'TIMEOUT';
    check(`unknown ${evidenceName} status rejected`, throwsTypeError(() => deriveBorrowTruth(badStatus)));
    const badTimestamp = completeInput(); badTimestamp[evidenceName].observedAt.maxAgeMs = 0;
    check(`malformed ${evidenceName} timestamp rejected`, throwsTypeError(() => deriveBorrowTruth(badTimestamp)));
  }

  for (const field of ['accountCreated', 'modeEnabled', 'borrowEnabled']) {
    const input = completeInput(); input.account[field] = 1;
    check(`non-boolean account ${field} rejected`, throwsTypeError(() => deriveBorrowTruth(input)));
  }
  for (const field of ['enableReading', 'enableMargin', 'enableSpotAndMarginTrading']) {
    const input = completeInput(); input.permission[field] = 'true';
    check(`non-boolean permission ${field} rejected`, throwsTypeError(() => deriveBorrowTruth(input)));
  }

  for (const bad of ['', '-1', '+1', '.5', '1.', '1e3', ' 1', '1 ', 'NaN', 'Infinity', '1_000', '1,000', 1, null]) {
    const input = completeInput(); input.maxBorrow.amount = bad;
    const shouldThrow = bad !== null;
    check(`malformed amount ${String(bad)} ${shouldThrow ? 'rejected' : 'is explicit unknown'}`, shouldThrow ? throwsTypeError(() => deriveBorrowTruth(input)) : deriveBorrowTruth(input).state === 'UNKNOWN');
  }
  const tooLong = completeInput(); tooLong.maxBorrow.amount = '1'.repeat(121);
  check('unbounded decimal length rejected', throwsTypeError(() => deriveBorrowTruth(tooLong)));
  const negativeRate = completeInput(); negativeRate.rate.hourlyRate = '-0.1';
  check('negative hourly rate rejected', throwsTypeError(() => deriveBorrowTruth(negativeRate)));
  const numericRate = completeInput(); numericRate.rate.hourlyRate = 0.01;
  check('numeric hourly rate rejected to prevent binary ambiguity', throwsTypeError(() => deriveBorrowTruth(numericRate)));
  const numericBorrowed = completeInput(); numericBorrowed.liability.currentBorrowedAsset = 1;
  check('numeric current borrowed amount is rejected', throwsTypeError(() => deriveBorrowTruth(numericBorrowed)));
  const overOneLtv = completeInput(); overOneLtv.collateral.currentLtv = '1.0000000001';
  check('LTV above one cannot be admitted as a fractional ratio', throwsTypeError(() => deriveBorrowTruth(overOneLtv)));
  const numericLtv = completeInput(); numericLtv.collateral.currentLtv = 0.25;
  check('numeric LTV is rejected to prevent binary ambiguity', throwsTypeError(() => deriveBorrowTruth(numericLtv)));
  const flexibleLoanCollateral = completeInput(); flexibleLoanCollateral.collateral.product = 'FLEXIBLE_LOAN';
  check('flexible-loan collateral/LTV cannot be relabelled as margin BorrowTruth', throwsTypeError(() => deriveBorrowTruth(flexibleLoanCollateral)));
  const productlessCollateral = completeInput(); delete productlessCollateral.collateral.product;
  check('collateral evidence requires an explicit margin product identity', throwsTypeError(() => deriveBorrowTruth(productlessCollateral)));
  const orphanCollateralAmount = completeInput(); orphanCollateralAmount.collateral.collateralAsset = null;
  check('collateral quantity cannot lose its asset unit', throwsTypeError(() => deriveBorrowTruth(orphanCollateralAmount)));
  const orphanCollateralAsset = completeInput(); orphanCollateralAsset.collateral.collateralAmount = null;
  check('collateral asset cannot imply an unknown quantity', throwsTypeError(() => deriveBorrowTruth(orphanCollateralAsset)));
  const aboveLimit = completeInput(); aboveLimit.maxBorrow.amount = '10.0000000000000000001'; aboveLimit.maxBorrow.borrowLimit = '10';
  check('amount above account limit is contradictory', throwsTypeError(() => deriveBorrowTruth(aboveLimit)));
  const equalLimit = completeInput(); equalLimit.maxBorrow.amount = '10.000'; equalLimit.maxBorrow.borrowLimit = '10';
  check('amount exactly equal to limit is valid', deriveBorrowTruth(equalLimit).state === 'AVAILABLE');

  const contradictions = [
    ['account', { status: 'SOURCE_ERROR' }],
    ['permission', { status: 'RATE_LIMITED' }],
    ['maxBorrow', { status: 'UNAVAILABLE' }],
    ['rate', { status: 'SOURCE_ERROR' }],
    ['liability', { status: 'RATE_LIMITED' }],
    ['collateral', { status: 'UNAVAILABLE' }],
  ];
  for (const [name, override] of contradictions) {
    const input = completeInput(); Object.assign(input[name], override);
    check(`${name} failed status cannot retain payload`, throwsTypeError(() => deriveBorrowTruth(input)));
  }

  const overflow = completeInput();
  overflow.maxBorrow.observedAt.sourceTimeMs = 4_102_444_800_000;
  overflow.maxBorrow.observedAt.receivedAtMs = 4_102_444_800_000;
  overflow.maxBorrow.observedAt.maxAgeMs = Number.MAX_SAFE_INTEGER;
  check('unsafe evidence expiry rejected', throwsTypeError(() => deriveBorrowTruth(overflow)));

  const extraInput = completeInput(); extraInput.apiKey = 'forbidden-fixture';
  check('unknown top-level fields are rejected, never silently stripped', throwsTypeError(() => deriveBorrowTruth(extraInput)));
  const extraScope = completeInput(); extraScope.scope.extra = true;
  check('unknown scope fields are rejected', throwsTypeError(() => deriveBorrowTruth(extraScope)));
  const extraEvidence = completeInput(); extraEvidence.maxBorrow.secret = 'forbidden-fixture';
  check('unknown evidence fields are rejected', throwsTypeError(() => deriveBorrowTruth(extraEvidence)));
  const extraTimestamp = completeInput(); extraTimestamp.account.observedAt.extra = true;
  check('unknown timestamp fields are rejected', throwsTypeError(() => deriveBorrowTruth(extraTimestamp)));

  let getterCalls = 0;
  const accessorInput = completeInput();
  Object.defineProperty(accessorInput.maxBorrow, 'amount', {
    enumerable: true,
    get() { getterCalls += 1; return '5'; },
  });
  check('evidence accessors are rejected without invocation', throwsTypeError(() => deriveBorrowTruth(accessorInput)) && getterCalls === 0);

  const symbolEvidence = completeInput();
  symbolEvidence.permission[Symbol('apiKey')] = 'forbidden-fixture';
  check('symbol evidence fields are rejected', throwsTypeError(() => deriveBorrowTruth(symbolEvidence)));
}

// ---------------------------------------------------------------------
section('6b. every caller-controlled Proxy is rejected at trap zero');
{
  const root = trappedProxy(completeInput());
  check(
    'root input Proxy is rejected before any trap',
    throwsTypeError(() => deriveBorrowTruth(root.proxy)) && root.calls.length === 0,
    root.calls.join(','),
  );

  const nestedScopeInput = completeInput();
  const nestedScope = trappedProxy(nestedScopeInput.scope);
  nestedScopeInput.scope = nestedScope.proxy;
  check(
    'nested scope Proxy is rejected before any trap',
    throwsTypeError(() => deriveBorrowTruth(nestedScopeInput)) && nestedScope.calls.length === 0,
    nestedScope.calls.join(','),
  );

  for (const evidenceName of ['account', 'permission', 'maxBorrow', 'rate', 'liability', 'collateral']) {
    const evidenceInput = completeInput();
    const evidence = trappedProxy(evidenceInput[evidenceName]);
    evidenceInput[evidenceName] = evidence.proxy;
    check(
      `${evidenceName} evidence Proxy is rejected before any trap`,
      throwsTypeError(() => deriveBorrowTruth(evidenceInput)) && evidence.calls.length === 0,
      evidence.calls.join(','),
    );

    const timestampInput = completeInput();
    const timestamp = trappedProxy(timestampInput[evidenceName].observedAt);
    timestampInput[evidenceName].observedAt = timestamp.proxy;
    check(
      `${evidenceName} timestamp Proxy is rejected before any trap`,
      throwsTypeError(() => deriveBorrowTruth(timestampInput)) && timestamp.calls.length === 0,
      timestamp.calls.join(','),
    );
  }

  const revokedRoot = Proxy.revocable(completeInput(), {});
  revokedRoot.revoke();
  check('revoked root Proxy is rejected without touching revoked state', throwsTypeError(() => deriveBorrowTruth(revokedRoot.proxy)));
  const revokedTimestampInput = completeInput();
  const revokedTimestamp = Proxy.revocable(revokedTimestampInput.account.observedAt, {});
  revokedTimestamp.revoke();
  revokedTimestampInput.account.observedAt = revokedTimestamp.proxy;
  check('revoked nested timestamp Proxy is rejected without touching revoked state', throwsTypeError(() => deriveBorrowTruth(revokedTimestampInput)));

  const canonical = deriveBorrowTruth(completeInput());
  const hostileTruth = trappedProxy(clone(canonical));
  const consumerResult = validateBorrowTruthForConsumption(hostileTruth.proxy, {
    evaluatedAtMs: T0,
    acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
    requireRate: false,
  });
  check(
    'consumer root Proxy fails closed at trap zero',
    consumerResult.truth === null
      && consumerResult.issues.includes('BORROW_TRUTH_SCHEMA_INVALID')
      && hostileTruth.calls.length === 0,
    hostileTruth.calls.join(','),
  );
  for (const [label, install] of [
    ['provenance record', (truth, proxy) => { truth.provenance = proxy; }],
    ['freshness record', (truth, proxy) => { truth.freshness = proxy; }],
    ['provenance timestamp', (truth, proxy) => { truth.provenance.account = proxy; }],
    ['freshness report', (truth, proxy) => { truth.freshness.account = proxy; }],
  ]) {
    const truth = clone(canonical);
    const target = label === 'provenance record'
      ? truth.provenance
      : label === 'freshness record'
        ? truth.freshness
        : label === 'provenance timestamp'
          ? truth.provenance.account
          : truth.freshness.account;
    const hostile = trappedProxy(target);
    install(truth, hostile.proxy);
    const result = validateBorrowTruthForConsumption(truth, {
      evaluatedAtMs: T0,
      acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
      requireRate: false,
    });
    check(
      `consumer nested ${label} Proxy fails closed at trap zero`,
      result.truth === null && hostile.calls.length === 0,
      hostile.calls.join(','),
    );
  }

  const hostilePolicy = trappedProxy({
    evaluatedAtMs: T0,
    acceptedAuthorities: BORROW_EVIDENCE_AUTHORITIES,
    requireRate: false,
  });
  check(
    'consumer policy Proxy is rejected before any trap',
    throwsTypeError(() => validateBorrowTruthForConsumption(canonical, hostilePolicy.proxy))
      && hostilePolicy.calls.length === 0,
    hostilePolicy.calls.join(','),
  );
  const authorityArray = trappedProxy([...BORROW_EVIDENCE_AUTHORITIES]);
  check(
    'consumer authority-array Proxy is rejected before any trap',
    throwsTypeError(() => validateBorrowTruthForConsumption(canonical, {
      evaluatedAtMs: T0,
      acceptedAuthorities: authorityArray.proxy,
      requireRate: false,
    })) && authorityArray.calls.length === 0,
    authorityArray.calls.join(','),
  );

  const batch = trappedProxy([completeInput()]);
  check(
    'batch Proxy is rejected before length, ownKeys, or materialization traps',
    throwsTypeError(() => deriveBorrowTruthBatch(batch.proxy)) && batch.calls.length === 0,
    batch.calls.join(','),
  );
  const revokedBatch = Proxy.revocable([completeInput()], {});
  revokedBatch.revoke();
  check('revoked batch Proxy is rejected without touching revoked state', throwsTypeError(() => deriveBorrowTruthBatch(revokedBatch.proxy)));
  let batchAccessorCalls = 0;
  const accessorBatch = [completeInput()];
  Object.defineProperty(accessorBatch, '0', {
    enumerable: true,
    configurable: true,
    get() { batchAccessorCalls += 1; return completeInput(); },
  });
  check(
    'batch accessors are rejected without materialization',
    throwsTypeError(() => deriveBorrowTruthBatch(accessorBatch)) && batchAccessorCalls === 0,
  );
}

// ---------------------------------------------------------------------
section('7. decimal utility remains exact for very large and very precise values');
{
  check('leading/trailing zeros canonicalize', normalizeNonNegativeDecimal('000123.450000') === '123.45');
  check('integer zeros canonicalize', normalizeNonNegativeDecimal('0000') === '0');
  check('large integer comparison is exact', compareNonNegativeDecimals('900719925474099300000', '900719925474099299999') === 1);
  check('fraction comparison is exact', compareNonNegativeDecimals('0.10000000000000000001', '0.1') === 1);
  check('equivalent decimals compare equal', compareNonNegativeDecimals('001.2300', '1.23') === 0);
  check('zero helper accepts decimal zeros', isExactZero('000.000'));
  check('zero helper rejects positive dust', !isExactZero('0.000000000000000001'));
  check('decimal helper rejects exponent notation', throwsTypeError(() => normalizeNonNegativeDecimal('1e-8')));
}

// ---------------------------------------------------------------------
section('8. batch derivation is bounded, duplicate-safe, stable and immutable');
{
  const batch = deriveBorrowTruthBatch([
    completeInput({ accountId: 'acct-z', mode: 'ISOLATED', symbol: 'ETHUSDT', asset: 'USDT' }),
    completeInput({ accountId: 'acct-a', mode: 'CROSS_PRO', symbol: 'BTCUSDT', asset: 'BTC' }),
    completeInput({ accountId: 'acct-a', mode: 'CROSS_CLASSIC', symbol: 'BTCUSDT', asset: 'USDT' }),
  ]);
  check('batch uses locale-independent canonical ordering', batch.map((x) => `${x.accountId}/${x.mode}/${x.symbol}/${x.asset}`).join('|') === 'acct-a/CROSS_CLASSIC/BTCUSDT/USDT|acct-a/CROSS_PRO/BTCUSDT/BTC|acct-z/ISOLATED/ETHUSDT/USDT');
  check('batch array and every result are frozen', Object.isFrozen(batch) && batch.every(Object.isFrozen));
  check('empty batch is valid and frozen', deriveBorrowTruthBatch([]).length === 0 && Object.isFrozen(deriveBorrowTruthBatch([])));
  const duplicate = completeInput();
  check('duplicate decision scope rejected', throwsTypeError(() => deriveBorrowTruthBatch([duplicate, clone(duplicate)])));
  check('non-array batch rejected', throwsTypeError(() => deriveBorrowTruthBatch({})));
  const sparse = new Array(1);
  check('sparse batch rejected', throwsTypeError(() => deriveBorrowTruthBatch(sparse)));
  const sideProperty = [completeInput()]; sideProperty.apiKey = 'forbidden-fixture';
  check('batch named side-properties rejected', throwsTypeError(() => deriveBorrowTruthBatch(sideProperty)));
  const symbolBatch = [completeInput()]; symbolBatch[Symbol('private')] = true;
  check('batch symbol properties rejected', throwsTypeError(() => deriveBorrowTruthBatch(symbolBatch)));
  check('batch size is bounded', throwsTypeError(() => deriveBorrowTruthBatch(Array.from({ length: 1_001 }, (_, index) => completeInput({ accountId: `acct-${index}` })))));
}

const failed = results.filter((result) => !result.pass);
console.log(`\nBorrow truth: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
