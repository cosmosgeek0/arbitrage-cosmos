/**
 * Lane D — multi-leg risk evaluator: check builders.
 *
 * Every builder is a pure function from (snapshot slice, policy, nowMs,
 * riskClass) to one or more frozen RiskCheck values. Builders never throw on
 * missing/malformed EVIDENCE — that becomes status UNKNOWN, which the
 * fail-closed derivation law treats exactly like FAIL on blocking checks.
 *
 * BLOCKING LAW (risk-class distinction, spec section 12):
 *   - RISK_INCREASING: every check family blocks.
 *   - RISK_REDUCING (explicitly authorized close/recovery): only the
 *     safety-critical families that govern order VALIDITY still block —
 *     approval validity, evidence authority/freshness/skew, permission
 *     posture, spot funding, symbol filters, bounded naked duration, and any
 *     margin/borrow facts actually required by the recovery. Entry-size,
 *     daily-volume, duplicate-plan, open-order, cooldown, and edge-quality
 *     limits remain visible but cannot trap a proven risk reduction.
 *     Authorization is enforced by the APPROVAL_SCOPE check: a RISK_REDUCING
 *     evaluation without an approval explicitly scoped to RISK_REDUCING is
 *     blocked there, so the kill-switch exemption can never be abused.
 *
 * evidenceTimestamp honesty: the basis time of the evidence actually used
 * (source time when the venue supplied one, else local receipt time), or the
 * observation time for control-plane facts; null when a check consumed no
 * timed evidence (pure intent-vs-policy comparisons) or none exists.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import type {
  ActionRiskClass,
  FreshnessReport,
  RiskCheck,
  SourcedTimestamp,
} from '../contracts/index.js';
import {
  AUTHORITY_STRENGTH,
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  evaluateFreshness,
  isCanonicalLifecycle,
  isPlanLifecycle,
  isTerminalPlanLifecycle,
  isValidUtcMillis,
  isVenue,
  validateSourcedTimestamp,
} from '../contracts/index.js';
import type {
  AccountEvidence,
  ApprovalEvidence,
  BorrowEvidence,
  CooldownEvidence,
  ExistingPlansEvidence,
  KillSwitchEvidence,
  LegMarketEvidence,
  MarketEvidence,
  PlanIntent,
  PlanLegIntent,
  PositionBucket,
  ProposalEvidence,
  RiskPolicy,
} from './types.js';
import { deriveRiskIntentDigest, isPositionBucket } from './types.js';
import { isActionRiskClass as _iarc } from '../contracts/index.js';

// ---------- check families and the close-blocking law ----------

/** Families that STILL block an explicitly authorized RISK_REDUCING action. */
export const CLOSE_BLOCKING_FAMILIES = Object.freeze([
  'APPROVAL_PRESENT',
  'APPROVAL_EXPIRY',
  'APPROVAL_SCOPE',
  'RECOVERY_RISK_REDUCTION',
  'EVIDENCE_AUTHORITY',
  'LEG_EVIDENCE_FRESHNESS',
  'SPOT_PERP_SKEW',
  'PERMISSION_POSTURE',
  'SPOT_INVENTORY',
  'SYMBOL_FILTERS',
  'MAX_NAKED_DURATION',
  'MARGIN_HEADROOM',
  'LIQUIDATION_DISTANCE',
  'BORROW_AVAILABILITY',
  'BORROW_AMOUNT',
  'BORROW_RATE',
  'BORROW_FRESHNESS',
  'DUPLICATE_ACTIVE_PLAN',
] as const);

/** Blocking flag for a family under the given risk class. */
export function isBlockingFamily(family: string, riskClass: ActionRiskClass): boolean {
  return riskClass === 'RISK_INCREASING'
    ? true
    : (CLOSE_BLOCKING_FAMILIES as readonly string[]).includes(family);
}

// ---------- small pure helpers ----------

function makeCheck(
  code: string,
  status: RiskCheck['status'],
  blocking: boolean,
  detail: string,
  observed: RiskCheck['observed'],
  limit: RiskCheck['limit'],
  evidenceTimestamp: number | null,
): Readonly<RiskCheck> {
  const safeScalar = (value: RiskCheck['observed']): RiskCheck['observed'] => {
    if (value === null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value.length === 0 ? null : value.slice(0, 300);
    return null;
  };
  const safeDetail =
    typeof detail === 'string' && detail.trim().length > 0
      ? detail.slice(0, 1_000)
      : 'Risk check produced no diagnostic detail.';
  return Object.freeze({
    code,
    status,
    blocking,
    detail: safeDetail,
    observed: safeScalar(observed),
    limit: safeScalar(limit),
    evidenceTimestamp: isValidUtcMillis(evidenceTimestamp) ? evidenceTimestamp : null,
  });
}

/** Basis time of a sourced timestamp: source event time wins, else receipt. */
function basisTime(ts: SourcedTimestamp): number {
  return ts.sourceTimeMs !== null ? ts.sourceTimeMs : ts.receivedAtMs;
}

/**
 * Freshness that never throws: malformed evidence timestamps are an
 * operational condition, reported as null (=> UNKNOWN check), not a crash.
 */
function safeFreshness(ts: unknown, nowMs: number): Readonly<FreshnessReport> | null {
  if (typeof ts !== 'object' || ts === null) return null;
  if (validateSourcedTimestamp(ts).length > 0) return null;
  const sourced = ts as SourcedTimestamp;
  if (
    (sourced.sourceTimeMs !== null && sourced.sourceTimeMs > sourced.receivedAtMs) ||
    sourced.receivedAtMs > nowMs + DEFAULT_CLOCK_SKEW_TOLERANCE_MS
  ) {
    const usingSource = sourced.sourceTimeMs !== null;
    const basisTimeMs = usingSource ? (sourced.sourceTimeMs as number) : sourced.receivedAtMs;
    return Object.freeze({
      state: 'CLOCK_SKEWED' as const,
      ageMs: nowMs - basisTimeMs,
      basis: usingSource ? ('SOURCE_TIME' as const) : ('RECEIPT_TIME' as const),
      effectiveAuthority: 'UNAVAILABLE' as const,
      evaluatedAt: nowMs,
    });
  }
  return evaluateFreshness(sourced, nowMs);
}

/** Safe basis time for possibly-malformed evidence. */
function safeBasisTime(ts: unknown): number | null {
  if (typeof ts !== 'object' || ts === null) return null;
  if (validateSourcedTimestamp(ts).length > 0) return null;
  return basisTime(ts as SourcedTimestamp);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isFiniteNonNegative(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

/** Exact base-10 value of a finite JavaScript number's canonical text form. */
interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

function exactDecimal(value: number): ExactDecimal | null {
  if (!Number.isFinite(value)) return null;
  const match = value
    .toString()
    .match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (match === null) return null;
  const negative = match[1] === '-';
  const fraction = match[3] ?? '';
  const exponent = Number.parseInt(match[4] ?? '0', 10);
  let coefficient = BigInt(`${match[2]}${fraction}`);
  if (negative) coefficient = -coefficient;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function exactRescale(value: ExactDecimal, scale: number): bigint {
  return value.coefficient * 10n ** BigInt(scale - value.scale);
}

function exactAdd(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: exactRescale(left, scale) + exactRescale(right, scale),
    scale,
  };
}

function exactMultiply(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return {
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  };
}

function exactNegate(value: ExactDecimal): ExactDecimal {
  return { coefficient: -value.coefficient, scale: value.scale };
}

function exactAbs(value: ExactDecimal): ExactDecimal {
  return value.coefficient < 0n ? exactNegate(value) : value;
}

function exactCompare(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const scale = Math.max(left.scale, right.scale);
  const a = exactRescale(left, scale);
  const b = exactRescale(right, scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

function exactProduct(left: number, right: number): ExactDecimal | null {
  const a = exactDecimal(left);
  const b = exactDecimal(right);
  return a === null || b === null ? null : exactMultiply(a, b);
}

function exactDisplay(value: ExactDecimal): string {
  const sign = value.coefficient < 0n ? '-' : '';
  const digits = (value.coefficient < 0n ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return `${sign}${digits}`;
  if (digits.length > value.scale) {
    const point = digits.length - value.scale;
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return `${sign}0.${'0'.repeat(value.scale - digits.length)}${digits}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sourceMatchesVenue(timestamp: SourcedTimestamp, venue: PlanLegIntent['venue']): boolean {
  const source = timestamp.sourceId.toLowerCase();
  return venue === 'BINANCE_SPOT'
    ? source.includes('binance.spot.') || source.includes('.spot')
    : source.includes('binance.usdm.') || source.includes('.usdm');
}

function positionBucketMatchesVenue(bucket: PositionBucket, venue: PlanLegIntent['venue']): boolean {
  return venue === 'BINANCE_USDM'
    ? bucket === 'USDM_ONE_WAY'
    : bucket !== 'USDM_ONE_WAY';
}

function safeText(value: unknown, maxLength = 160): string {
  if (typeof value === 'string') return value.slice(0, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).slice(0, maxLength);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return '[malformed value]';
}

/** value conforms to an exchange increment (tick/step) within float tolerance. */
function conformsToIncrement(value: number, increment: number, origin = 0): boolean {
  if (!isFiniteNumber(value) || !isFiniteNumber(increment) || !isFiniteNumber(origin) || increment <= 0) {
    return false;
  }
  const exactValue = exactDecimal(value);
  const exactIncrement = exactDecimal(increment);
  const exactOrigin = exactDecimal(origin);
  if (exactValue === null || exactIncrement === null || exactOrigin === null) return false;
  const scale = Math.max(exactValue.scale, exactIncrement.scale, exactOrigin.scale);
  const delta = exactRescale(exactValue, scale) - exactRescale(exactOrigin, scale);
  const step = exactRescale(exactIncrement, scale);
  return step > 0n && delta % step === 0n;
}

function displayNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : Number(v.toPrecision(12)).toString();
}

// ---------- 1. kill switch ----------

export function checkKillSwitch(
  killSwitch: KillSwitchEvidence | null,
  nowMs: number,
  riskClass: ActionRiskClass,
  accountId: string,
): Readonly<RiskCheck> {
  // The kill switch blocks NEW risk only. For RISK_REDUCING the check is
  // reported but non-blocking; authorization is enforced by APPROVAL_SCOPE.
  const blocking = riskClass === 'RISK_INCREASING';
  const exemptionNote =
    riskClass === 'RISK_REDUCING'
      ? ' Non-blocking for a risk-reducing action: an explicitly authorized close/recovery must not be trapped by the kill switch (authorization is enforced by APPROVAL_SCOPE).'
      : '';
  if (killSwitch === null || typeof killSwitch !== 'object' || typeof killSwitch.engaged !== 'boolean') {
    return makeCheck(
      'KILL_SWITCH',
      'UNKNOWN',
      blocking,
      `Kill-switch state was not supplied; a new entry cannot proceed on unknown safety state.${exemptionNote}`,
      null,
      'DISARMED',
      null,
    );
  }
  const report = safeFreshness(killSwitch.observedAt, nowMs);
  const ts = safeBasisTime(killSwitch.observedAt);
  if (typeof killSwitch.accountId !== 'string' || killSwitch.accountId !== accountId) {
    return makeCheck('KILL_SWITCH', 'FAIL', blocking, 'Kill-switch evidence belongs to a different or unknown account scope.', safeText(killSwitch.accountId, 300), accountId, ts);
  }
  if (
    report === null ||
    report.state !== 'FRESH' ||
    killSwitch.observedAt.completeness !== 'COMPLETE'
  ) {
    return makeCheck(
      'KILL_SWITCH',
      report?.state === 'STALE' || report?.state === 'CLOCK_SKEWED' ? 'FAIL' : 'UNKNOWN',
      blocking,
      `Kill-switch evidence is ${report === null ? 'malformed' : report.state}; current safety state cannot be trusted.${exemptionNote}`,
      report?.state ?? null,
      'FRESH',
      ts,
    );
  }
  if (killSwitch.engaged) {
    return makeCheck(
      'KILL_SWITCH',
      'FAIL',
      blocking,
      `Kill switch is ENGAGED${killSwitch.reason ? ` (reason: ${safeText(killSwitch.reason, 300)})` : ''}.${exemptionNote}`,
      'ENGAGED',
      'DISARMED',
      ts,
    );
  }
  return makeCheck('KILL_SWITCH', 'PASS', blocking, 'Kill switch is disarmed and its evidence is fresh.', 'DISARMED', 'DISARMED', ts);
}

// ---------- 2-4. approval ----------

export function checkApproval(
  approval: ApprovalEvidence | null,
  intent: PlanIntent,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const bPresent = isBlockingFamily('APPROVAL_PRESENT', riskClass);
  const bExpiry = isBlockingFamily('APPROVAL_EXPIRY', riskClass);
  const bScope = isBlockingFamily('APPROVAL_SCOPE', riskClass);
  if (approval === null || typeof approval !== 'object') {
    const detail = 'No approval evidence was supplied; unapproved actions fail closed.';
    return [
      makeCheck('APPROVAL_PRESENT', 'UNKNOWN', bPresent, detail, null, intent.planId, null),
      makeCheck('APPROVAL_EXPIRY', 'UNKNOWN', bExpiry, detail, null, 0, null),
      makeCheck('APPROVAL_SCOPE', 'UNKNOWN', bScope, detail, null, intent.riskClass, null),
    ];
  }
  const grantedTs = isValidUtcMillis(approval.grantedAtMs) ? approval.grantedAtMs : null;
  const approvalReport = safeFreshness(approval.observedAt, nowMs);
  const approvalTs = safeBasisTime(approval.observedAt);

  let present: Readonly<RiskCheck>;
  if (
    typeof approval.approvalId !== 'string' ||
    approval.approvalId.trim().length === 0 ||
    approval.approvalId.length > 128
  ) {
    present = makeCheck(
      'APPROVAL_PRESENT',
      'UNKNOWN',
      bPresent,
      'Approval identifier is malformed; approval identity cannot be established.',
      null,
      intent.planId,
      approvalTs,
    );
  } else if (
    approvalReport === null ||
    approvalReport.state !== 'FRESH' ||
    approval.observedAt.completeness !== 'COMPLETE'
  ) {
    present = makeCheck(
      'APPROVAL_PRESENT',
      approvalReport?.state === 'STALE' || approvalReport?.state === 'CLOCK_SKEWED' ? 'FAIL' : 'UNKNOWN',
      bPresent,
      `Approval-store evidence is ${approvalReport === null ? 'malformed' : approvalReport.state}; current authorization cannot be trusted.`,
      approvalReport?.state ?? null,
      'FRESH',
      approvalTs,
    );
  } else if (
    grantedTs !== null &&
    (approvalTs === null || approvalTs < grantedTs || approval.observedAt.receivedAtMs < grantedTs)
  ) {
    present = makeCheck(
      'APPROVAL_PRESENT',
      'FAIL',
      bPresent,
      'Approval record claims it was observed before it was granted.',
      approvalTs,
      grantedTs,
      approvalTs,
    );
  } else if (typeof approval.subjectPlanId !== 'string' || approval.subjectPlanId !== intent.planId) {
    present = makeCheck(
      'APPROVAL_PRESENT',
      'FAIL',
      bPresent,
      `Approval ${safeText(approval.approvalId)} covers plan '${safeText(approval.subjectPlanId)}', not the evaluated plan.`,
      safeText(approval.subjectPlanId, 300),
      intent.planId,
      grantedTs,
    );
  } else if (grantedTs !== null && grantedTs > nowMs) {
    present = makeCheck(
      'APPROVAL_PRESENT',
      'FAIL',
      bPresent,
      `Approval ${safeText(approval.approvalId)} is granted in the future (clock skew or forged grant time).`,
      approval.grantedAtMs,
      nowMs,
      grantedTs,
    );
  } else if (grantedTs === null) {
    present = makeCheck(
      'APPROVAL_PRESENT',
      'UNKNOWN',
      bPresent,
      `Approval ${safeText(approval.approvalId)} has a malformed grant time; validity cannot be established.`,
      null,
      intent.planId,
      null,
    );
  } else {
    present = makeCheck(
      'APPROVAL_PRESENT',
      'PASS',
      bPresent,
      `Approval ${safeText(approval.approvalId)} covers plan ${intent.planId}.`,
      approval.subjectPlanId,
      intent.planId,
      grantedTs,
    );
  }

  let expiry: Readonly<RiskCheck>;
  if (!isValidUtcMillis(approval.expiresAtMs)) {
    expiry = makeCheck('APPROVAL_EXPIRY', 'UNKNOWN', bExpiry, 'Approval expiry is malformed; validity window cannot be established.', null, 0, grantedTs);
  } else if (grantedTs !== null && approval.expiresAtMs <= grantedTs) {
    expiry = makeCheck(
      'APPROVAL_EXPIRY',
      'FAIL',
      bExpiry,
      'Approval expiry is not later than its grant time.',
      approval.expiresAtMs,
      grantedTs,
      approvalTs,
    );
  } else {
    const remainingMs = approval.expiresAtMs - nowMs;
    expiry =
      remainingMs > 0
        ? makeCheck('APPROVAL_EXPIRY', 'PASS', bExpiry, `Approval valid for another ${remainingMs} ms.`, remainingMs, 0, grantedTs)
        : makeCheck('APPROVAL_EXPIRY', 'FAIL', bExpiry, `Approval is expired (remaining ${remainingMs} ms).`, remainingMs, 1, grantedTs);
  }

  let scope: Readonly<RiskCheck>;
  const expectedIntentDigest = deriveRiskIntentDigest(intent);
  if (!_iarc(approval.authorizedRiskClass)) {
    scope = makeCheck('APPROVAL_SCOPE', 'UNKNOWN', bScope, 'Approval risk-class scope is malformed.', null, intent.riskClass, grantedTs);
  } else if (approval.authorizedRiskClass !== intent.riskClass) {
    scope = makeCheck(
      'APPROVAL_SCOPE',
      'FAIL',
      bScope,
      `Approval authorizes ${approval.authorizedRiskClass} but the intent is ${intent.riskClass}; scope must match exactly.`,
      approval.authorizedRiskClass,
      intent.riskClass,
      grantedTs,
    );
  } else if (typeof approval.intentDigest !== 'string' || approval.intentDigest.length === 0) {
    scope = makeCheck('APPROVAL_SCOPE', 'UNKNOWN', bScope, 'Approval has no valid immutable intent binding.', null, expectedIntentDigest, grantedTs);
  } else if (approval.intentDigest !== expectedIntentDigest) {
    scope = makeCheck('APPROVAL_SCOPE', 'FAIL', bScope, 'Approval is bound to a different semantic intent.', approval.intentDigest, expectedIntentDigest, grantedTs);
  } else {
    scope = makeCheck('APPROVAL_SCOPE', 'PASS', bScope, `Approval explicitly authorizes this exact ${intent.riskClass} intent.`, approval.authorizedRiskClass, intent.riskClass, grantedTs);
  }
  return [present, expiry, scope];
}

// ---------- 5. proof that a recovery is actually risk-reducing ----------

export function checkRecoveryRiskReduction(
  intent: PlanIntent,
  account: AccountEvidence | null,
  nowMs: number,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('RECOVERY_RISK_REDUCTION', intent.riskClass);
  if (intent.riskClass === 'RISK_INCREASING') {
    return makeCheck(
      'RECOVERY_RISK_REDUCTION',
      'PASS',
      blocking,
      'Entry intent is explicitly risk-increasing; recovery reduction proof is not applicable.',
      'ENTRY',
      null,
      null,
    );
  }

  const snapshot = account?.exposures ?? null;
  if (snapshot === null || typeof snapshot !== 'object' || !Array.isArray(snapshot.positions)) {
    return makeCheck(
      'RECOVERY_RISK_REDUCTION',
      'UNKNOWN',
      blocking,
      'No complete current-exposure snapshot was supplied; a recovery label alone is not proof of reduced risk.',
      null,
      'STRICT_RISK_REDUCTION',
      null,
    );
  }
  const snapshotReport = safeFreshness(snapshot.observedAt, nowMs);
  const snapshotTs = safeBasisTime(snapshot.observedAt);
  if (
    snapshotReport === null ||
    snapshotReport.state !== 'FRESH' ||
    snapshot.observedAt.completeness !== 'COMPLETE'
  ) {
    return makeCheck(
      'RECOVERY_RISK_REDUCTION',
      snapshotReport?.state === 'STALE' || snapshotReport?.state === 'CLOCK_SKEWED' ? 'FAIL' : 'UNKNOWN',
      blocking,
      `Exposure snapshot is ${snapshotReport === null ? 'malformed' : snapshotReport.state} / ${safeText(snapshot.observedAt?.completeness)}; omitted positions cannot be treated as zero.`,
      snapshotReport?.state ?? null,
      'FRESH_COMPLETE',
      snapshotTs,
    );
  }

  if (typeof snapshot.accountId !== 'string') {
    return makeCheck(
      'RECOVERY_RISK_REDUCTION',
      'UNKNOWN',
      blocking,
      'Exposure snapshot has no valid account binding.',
      null,
      intent.accountId,
      snapshotTs,
    );
  }
  if (snapshot.accountId !== intent.accountId) {
    return makeCheck(
      'RECOVERY_RISK_REDUCTION',
      'FAIL',
      blocking,
      'Exposure snapshot belongs to a different account.',
      safeText(snapshot.accountId, 300),
      intent.accountId,
      snapshotTs,
    );
  }
  if (intent.legs.some((leg) => leg.venue === 'BINANCE_USDM')) {
    if (snapshot.positionMode === null || snapshot.positionMode === undefined) {
      return makeCheck(
        'RECOVERY_RISK_REDUCTION',
        'UNKNOWN',
        blocking,
        'USD-M recovery cannot be proven without an explicit position-mode fact.',
        null,
        'ONE_WAY',
        snapshotTs,
      );
    }
    if (snapshot.positionMode !== 'ONE_WAY') {
      return makeCheck(
        'RECOVERY_RISK_REDUCTION',
        'FAIL',
        blocking,
        'Signed net exposure cannot prove a safe USD-M recovery while hedge mode is active or malformed.',
        safeText(snapshot.positionMode, 300),
        'ONE_WAY',
        snapshotTs,
      );
    }
  }

  const affectedSymbols = new Set(intent.legs.map((leg) => leg.symbol));
  const zero: ExactDecimal = { coefficient: 0n, scale: 0 };
  const current = new Map<string, Map<PositionBucket, ExactDecimal>>();
  let latestTs = snapshotTs;
  for (const row of snapshot.positions) {
    if (
      typeof row === 'object' &&
      row !== null &&
      typeof row.symbol === 'string' &&
      !affectedSymbols.has(row.symbol)
    ) {
      continue;
    }
    if (
      typeof row !== 'object' ||
      row === null ||
      !isVenue(row.venue) ||
      typeof row.symbol !== 'string' ||
      row.symbol.length === 0 ||
      !isPositionBucket(row.positionBucket) ||
      !positionBucketMatchesVenue(row.positionBucket, row.venue) ||
      !isFiniteNumber(row.signedBaseQty)
    ) {
      return makeCheck(
        'RECOVERY_RISK_REDUCTION',
        'UNKNOWN',
        blocking,
        'Exposure snapshot contains a malformed position row.',
        null,
        'VALID_POSITION_ROWS',
        snapshotTs,
      );
    }
    const report = safeFreshness(row.observedAt, nowMs);
    const rowTs = safeBasisTime(row.observedAt);
    if (
      report === null ||
      report.state !== 'FRESH' ||
      row.observedAt.completeness !== 'COMPLETE'
    ) {
      return makeCheck(
        'RECOVERY_RISK_REDUCTION',
        report?.state === 'STALE' || report?.state === 'CLOCK_SKEWED' ? 'FAIL' : 'UNKNOWN',
        blocking,
        `Exposure row ${row.venue}/${row.symbol} is ${report === null ? 'malformed' : report.state}.`,
        report?.state ?? null,
        'FRESH',
        rowTs,
      );
    }
    if (!sourceMatchesVenue(row.observedAt, row.venue)) {
      return makeCheck(
        'RECOVERY_RISK_REDUCTION',
        'FAIL',
        blocking,
        `Exposure row ${row.venue}/${row.symbol} provenance contradicts its venue.`,
        row.observedAt.sourceId,
        row.venue,
        rowTs,
      );
    }
    if (rowTs !== null) latestTs = latestTs === null ? rowTs : Math.max(latestTs, rowTs);
    const byBucket = current.get(row.symbol) ?? new Map<PositionBucket, ExactDecimal>();
    if (byBucket.has(row.positionBucket)) {
      return makeCheck(
        'RECOVERY_RISK_REDUCTION',
        'UNKNOWN',
        blocking,
        `Exposure snapshot contains duplicate rows for ${row.venue}/${row.symbol}.`,
        `${row.venue}/${row.symbol}`,
        'UNIQUE_POSITION_ROWS',
        rowTs,
      );
    }
    byBucket.set(row.positionBucket, exactDecimal(row.signedBaseQty) as ExactDecimal);
    current.set(row.symbol, byBucket);
  }

  const actions = new Map<string, Map<PositionBucket, ExactDecimal>>();
  for (const leg of intent.legs) {
    const byBucket = actions.get(leg.symbol) ?? new Map<PositionBucket, ExactDecimal>();
    const quantity = exactDecimal(leg.intendedQty) as ExactDecimal;
    const signed = leg.side === 'BUY' ? quantity : exactNegate(quantity);
    byBucket.set(leg.positionBucket, exactAdd(byBucket.get(leg.positionBucket) ?? zero, signed));
    actions.set(leg.symbol, byBucket);
  }

  const failures: string[] = [];
  const summaries: string[] = [];
  for (const symbol of [...affectedSymbols].sort()) {
    const currentByBucket = current.get(symbol) ?? new Map<PositionBucket, ExactDecimal>();
    const actionsByBucket = actions.get(symbol) ?? new Map<PositionBucket, ExactDecimal>();
    const buckets = new Set<PositionBucket>([
      ...currentByBucket.keys(),
      ...actionsByBucket.keys(),
    ]);

    let currentGross = zero;
    let projectedGross = zero;
    let currentNet = zero;
    let projectedNet = zero;
    let allPositionsNonIncreasing = true;
    let signFlip = false;
    for (const bucket of buckets) {
      const before = currentByBucket.get(bucket) ?? zero;
      const after = exactAdd(before, actionsByBucket.get(bucket) ?? zero);
      currentGross = exactAdd(currentGross, exactAbs(before));
      projectedGross = exactAdd(projectedGross, exactAbs(after));
      currentNet = exactAdd(currentNet, before);
      projectedNet = exactAdd(projectedNet, after);
      if (exactCompare(exactAbs(after), exactAbs(before)) > 0) allPositionsNonIncreasing = false;
      if (
        (before.coefficient > 0n && after.coefficient < 0n) ||
        (before.coefficient < 0n && after.coefficient > 0n)
      ) {
        signFlip = true;
      }
    }
    const absoluteCurrentNet = exactAbs(currentNet);
    const absoluteProjectedNet = exactAbs(projectedNet);
    const closesExposure =
      !signFlip &&
      allPositionsNonIncreasing &&
      exactCompare(projectedGross, currentGross) < 0 &&
      exactCompare(absoluteProjectedNet, absoluteCurrentNet) <= 0;
    const grossHedgeAllowance = exactAdd(
      currentGross,
      exactAdd(absoluteCurrentNet, exactNegate(absoluteProjectedNet)),
    );
    const hedgesResidual =
      !signFlip &&
      exactCompare(absoluteProjectedNet, absoluteCurrentNet) < 0 &&
      !(
        (currentNet.coefficient > 0n && projectedNet.coefficient < 0n) ||
        (currentNet.coefficient < 0n && projectedNet.coefficient > 0n)
      ) &&
      exactCompare(projectedGross, grossHedgeAllowance) <= 0;
    summaries.push(
      `${symbol}:gross ${exactDisplay(currentGross)}->${exactDisplay(projectedGross)},net ${exactDisplay(currentNet)}->${exactDisplay(projectedNet)}`,
    );
    if (!closesExposure && !hedgesResidual) failures.push(symbol);
  }

  if (failures.length > 0) {
    return makeCheck(
      'RECOVERY_RISK_REDUCTION',
      'FAIL',
      blocking,
      `Intent does not strictly reduce gross position exposure or absolute residual delta without overshoot for: ${failures.join(', ')}.`,
      summaries.join(';'),
      'STRICT_RISK_REDUCTION',
      latestTs,
    );
  }
  return makeCheck(
    'RECOVERY_RISK_REDUCTION',
    'PASS',
    blocking,
    'Fresh complete exposure evidence proves the authorized recovery strictly reduces risk for every affected symbol.',
    summaries.join(';'),
    'STRICT_RISK_REDUCTION',
    latestTs,
  );
}

// ---------- 6-7. proposal ----------

export function checkProposal(
  proposal: ProposalEvidence | null,
  intent: PlanIntent,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const bPresent = isBlockingFamily('PROPOSAL_PRESENT', riskClass);
  const bExpiry = isBlockingFamily('PROPOSAL_EXPIRY', riskClass);

  if (intent.proposalRef === null) {
    if (riskClass === 'RISK_REDUCING') {
      const detail = 'Close/recovery intent does not originate from a strategy proposal; no proposal is required.';
      return [
        makeCheck('PROPOSAL_PRESENT', 'PASS', bPresent, detail, 'NO_PROPOSAL_REQUIRED', null, null),
        makeCheck('PROPOSAL_EXPIRY', 'PASS', bExpiry, detail, 'NO_PROPOSAL_REQUIRED', null, null),
      ];
    }
    const detail = 'A risk-increasing entry must reference the strategy proposal it came from.';
    return [
      makeCheck('PROPOSAL_PRESENT', 'FAIL', bPresent, detail, 'NO_PROPOSAL_REF', 'PROPOSAL_REF_REQUIRED', null),
      makeCheck('PROPOSAL_EXPIRY', 'UNKNOWN', bExpiry, detail, null, nowMs, null),
    ];
  }

  if (proposal === null || typeof proposal !== 'object') {
    const detail = `Intent references proposal '${intent.proposalRef}' but no proposal evidence was supplied.`;
    return [
      makeCheck('PROPOSAL_PRESENT', 'UNKNOWN', bPresent, detail, null, intent.proposalRef, null),
      makeCheck('PROPOSAL_EXPIRY', 'UNKNOWN', bExpiry, detail, null, nowMs, null),
    ];
  }

  const ts = safeBasisTime(proposal.observedAt);
  const report = safeFreshness(proposal.observedAt, nowMs);

  let present: Readonly<RiskCheck>;
  if (
    typeof proposal.proposalId !== 'string' ||
    proposal.proposalId.trim().length === 0 ||
    proposal.proposalId.length > 300
  ) {
    present = makeCheck(
      'PROPOSAL_PRESENT',
      'UNKNOWN',
      bPresent,
      'Proposal identifier is malformed; source identity cannot be established.',
      null,
      intent.proposalRef,
      ts,
    );
  } else if (
    report === null ||
    report.state !== 'FRESH' ||
    proposal.observedAt.completeness !== 'COMPLETE'
  ) {
    present = makeCheck(
      'PROPOSAL_PRESENT',
      report?.state === 'STALE' || report?.state === 'CLOCK_SKEWED' ? 'FAIL' : 'UNKNOWN',
      bPresent,
      `Proposal evidence is ${report === null ? 'malformed' : report.state}; current proposal state cannot be trusted.`,
      report?.state ?? null,
      'FRESH',
      ts,
    );
  } else if (proposal.proposalId !== intent.proposalRef) {
    present = makeCheck(
      'PROPOSAL_PRESENT',
      'FAIL',
      bPresent,
      `Supplied proposal '${proposal.proposalId}' does not match the intent's reference '${intent.proposalRef}'.`,
      proposal.proposalId,
      intent.proposalRef,
      ts,
    );
  } else if (
    typeof proposal.entryIntentDigest !== 'string' ||
    proposal.entryIntentDigest !== deriveRiskIntentDigest(intent)
  ) {
    present = makeCheck(
      'PROPOSAL_PRESENT',
      typeof proposal.entryIntentDigest === 'string' ? 'FAIL' : 'UNKNOWN',
      bPresent,
      'Proposal is not bound to the exact semantic entry intent.',
      typeof proposal.entryIntentDigest === 'string' ? proposal.entryIntentDigest : null,
      deriveRiskIntentDigest(intent),
      ts,
    );
  } else if (!isCanonicalLifecycle(proposal.lifecycle)) {
    present = makeCheck(
      'PROPOSAL_PRESENT',
      'UNKNOWN',
      bPresent,
      `Proposal ${safeText(proposal.proposalId)} has an unrecognized lifecycle.`,
      safeText(proposal.lifecycle, 300),
      'OPEN',
      ts,
    );
  } else if (proposal.lifecycle !== 'OPEN') {
    present = makeCheck(
      'PROPOSAL_PRESENT',
      'FAIL',
      bPresent,
      `Proposal ${safeText(proposal.proposalId)} is ${proposal.lifecycle}, not OPEN.`,
      proposal.lifecycle,
      'OPEN',
      ts,
    );
  } else {
    present = makeCheck('PROPOSAL_PRESENT', 'PASS', bPresent, `Proposal ${proposal.proposalId} is OPEN and matches the intent.`, proposal.proposalId, intent.proposalRef, ts);
  }

  let expiry: Readonly<RiskCheck>;
  if (proposal.expiresAtMs === null) {
    expiry = makeCheck(
      'PROPOSAL_EXPIRY',
      'UNKNOWN',
      bExpiry,
      `Proposal ${safeText(proposal.proposalId)} declares no expiry; the intent's age cannot be bounded, so this fails closed.`,
      null,
      nowMs,
      ts,
    );
  } else if (!isValidUtcMillis(proposal.expiresAtMs)) {
    expiry = makeCheck('PROPOSAL_EXPIRY', 'UNKNOWN', bExpiry, 'Proposal expiry is malformed.', null, nowMs, ts);
  } else {
    const remainingMs = proposal.expiresAtMs - nowMs;
    expiry =
      remainingMs > 0
        ? makeCheck('PROPOSAL_EXPIRY', 'PASS', bExpiry, `Proposal valid for another ${remainingMs} ms.`, remainingMs, 0, ts)
        : makeCheck('PROPOSAL_EXPIRY', 'FAIL', bExpiry, `Proposal is expired (remaining ${remainingMs} ms).`, remainingMs, 1, ts);
  }
  return [present, expiry];
}

// ---------- 7. evidence authority ----------

export function checkEvidenceAuthority(
  input: {
    intent: PlanIntent;
    killSwitch: KillSwitchEvidence | null;
    approval: ApprovalEvidence | null;
    proposal: ProposalEvidence | null;
    market: MarketEvidence | null;
    account: AccountEvidence | null;
    borrow: BorrowEvidence | null;
    existingPlans: ExistingPlansEvidence | null;
    cooldown: CooldownEvidence | null;
  },
  policy: RiskPolicy,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('EVIDENCE_AUTHORITY', riskClass);
  const collected: { label: string; ts: SourcedTimestamp }[] = [];
  const missing: string[] = [];
  const wrongDomain: string[] = [];
  const requireTimestamp = (label: string, ts: unknown, domain: 'ANY' | 'PRIVATE' | 'CONTROL' = 'ANY'): void => {
    if (typeof ts === 'object' && ts !== null && validateSourcedTimestamp(ts).length === 0) {
      const sourced = ts as SourcedTimestamp;
      collected.push({ label, ts: sourced });
      if (
        domain === 'PRIVATE' &&
        !['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(sourced.authority)
      ) {
        wrongDomain.push(label);
      }
      if (
        domain === 'CONTROL' &&
        !['DERIVED_LIVE', 'LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(sourced.authority)
      ) {
        wrongDomain.push(label);
      }
    } else {
      missing.push(label);
    }
  };

  requireTimestamp('approval', input.approval?.observedAt, 'PRIVATE');

  const marketLegs = Array.isArray(input.market?.legs) ? input.market.legs : [];
  for (const leg of input.intent.legs) {
    const matches = marketLegs.filter(
      (candidate): candidate is LegMarketEvidence =>
        typeof candidate === 'object' && candidate !== null && candidate.legKey === leg.legKey,
    );
    if (matches.length !== 1) {
      missing.push(`market.${leg.legKey}`);
      missing.push(`filters.${leg.legKey}`);
      continue;
    }
    requireTimestamp(`market.${leg.legKey}`, matches[0].observedAt);
    requireTimestamp(`filters.${leg.legKey}`, matches[0].filters?.observedAt);
  }
  requireTimestamp('account.permissions', input.account?.permissions?.observedAt, 'PRIVATE');
  requireTimestamp('existingPlans', input.existingPlans?.observedAt, 'CONTROL');
  if (input.intent.legs.some((leg) => leg.venue === 'BINANCE_USDM')) {
    requireTimestamp('account.exposures', input.account?.exposures?.observedAt, 'PRIVATE');
  }
  const spotSymbols = new Set(
    input.intent.legs
      .filter((leg) => leg.venue === 'BINANCE_SPOT' && leg.requiredPermission === 'SPOT')
      .map((leg) => leg.symbol),
  );
  const inventoryRows = Array.isArray(input.account?.spotInventory)
    ? input.account.spotInventory
    : [];
  for (const symbol of spotSymbols) {
    const matches = inventoryRows.filter(
      (row) => typeof row === 'object' && row !== null && row.symbol === symbol,
    );
    if (matches.length === 1) {
      requireTimestamp(`account.spotInventory.${symbol}`, matches[0].observedAt, 'PRIVATE');
    } else {
      missing.push(`account.spotInventory.${symbol}`);
    }
  }

  if (riskClass === 'RISK_INCREASING') {
    requireTimestamp('killSwitch', input.killSwitch?.observedAt, 'CONTROL');
    requireTimestamp('account.openOrders', input.account?.openOrders?.observedAt, 'PRIVATE');
    requireTimestamp('proposal', input.proposal?.observedAt, 'CONTROL');
    requireTimestamp('market.edge', input.market?.edgeObservedAt, 'CONTROL');
    requireTimestamp('account.dailyStats', input.account?.dailyStatsObservedAt, 'PRIVATE');
    requireTimestamp('cooldown', input.cooldown?.observedAt, 'CONTROL');
    const perpLegs = input.intent.legs.filter((leg) => leg.venue === 'BINANCE_USDM');
    const liquidationRows = Array.isArray(input.account?.liquidations)
      ? input.account.liquidations
      : [];
    for (const leg of perpLegs) {
      const matches = liquidationRows.filter(
        (row) => typeof row === 'object' && row !== null && row.legKey === leg.legKey,
      );
      if (matches.length === 1) {
        requireTimestamp(`account.liquidation.${leg.legKey}`, matches[0].observedAt, 'PRIVATE');
      } else {
        missing.push(`account.liquidation.${leg.legKey}`);
      }
    }
  } else {
    requireTimestamp('account.exposures', input.account?.exposures?.observedAt, 'PRIVATE');
    const affectedSymbols = new Set(input.intent.legs.map((leg) => leg.symbol));
    const exposureRows = Array.isArray(input.account?.exposures?.positions)
      ? input.account.exposures.positions
      : [];
    for (const row of exposureRows) {
      if (typeof row === 'object' && row !== null && affectedSymbols.has(row.symbol)) {
        requireTimestamp(
          `account.exposure.${safeText(row.venue)}.${safeText(row.symbol)}`,
          row.observedAt,
          'PRIVATE',
        );
      }
    }
    // A close that leaves residual USD-M exposure consumes its account-bound
    // liquidation projection below. Collect any matching projection here so
    // public authority can never masquerade as private account risk truth.
    // A fully flattening close legitimately supplies no projection, so absence
    // is resolved by checkLiquidationDistance rather than marked missing here.
    const recoveryLiquidations = Array.isArray(input.account?.liquidations)
      ? input.account.liquidations
      : [];
    for (const leg of input.intent.legs.filter((candidate) => candidate.venue === 'BINANCE_USDM')) {
      const currentMatches = exposureRows.filter(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          row.venue === leg.venue &&
          row.symbol === leg.symbol &&
          row.positionBucket === leg.positionBucket &&
          isFiniteNumber(row.signedBaseQty),
      );
      if (currentMatches.length > 1) continue;
      let action: ExactDecimal = { coefficient: 0n, scale: 0 };
      for (const candidate of input.intent.legs.filter(
        (row) =>
          row.venue === leg.venue &&
          row.symbol === leg.symbol &&
          row.positionBucket === leg.positionBucket,
      )) {
        const quantity = exactDecimal(candidate.intendedQty) as ExactDecimal;
        action = exactAdd(action, candidate.side === 'BUY' ? quantity : exactNegate(quantity));
      }
      const before = exactDecimal(currentMatches[0]?.signedBaseQty ?? 0) as ExactDecimal;
      const projected = exactAdd(before, action);
      if (projected.coefficient === 0n) continue;
      const matches = recoveryLiquidations.filter(
        (row) => typeof row === 'object' && row !== null && row.legKey === leg.legKey,
      );
      if (matches.length === 1) {
        requireTimestamp(
          `account.liquidation.${leg.legKey}`,
          matches[0].observedAt,
          'PRIVATE',
        );
      }
    }
  }
  const marginRows = Array.isArray(input.account?.marginHeadrooms)
    ? input.account.marginHeadrooms
    : [];
  const seenMarginScopes = new Set<string>();
  for (const leg of input.intent.legs.filter(
    (candidate) => candidate.venue === 'BINANCE_USDM' || candidate.requiredPermission === 'MARGIN',
  )) {
    if (riskClass === 'RISK_REDUCING' && leg.estimatedRequiredMarginUsd === 0) continue;
    const scopeSymbol = leg.positionBucket === 'MARGIN_ISOLATED' ? leg.symbol : null;
    const scope = `${leg.positionBucket}:${scopeSymbol ?? '*'}`;
    if (seenMarginScopes.has(scope)) continue;
    seenMarginScopes.add(scope);
    const matches = marginRows.filter(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        row.positionBucket === leg.positionBucket &&
        row.scopeSymbol === scopeSymbol,
    );
    if (matches.length === 1) {
      requireTimestamp(`account.margin.${scope}`, matches[0].observedAt, 'PRIVATE');
    } else {
      missing.push(`account.margin.${scope}`);
    }
  }
  if (input.intent.requiredBorrowUsd !== 0) {
    requireTimestamp('borrow', input.borrow?.observedAt, 'PRIVATE');
  }

  if (missing.length > 0) {
    const labels = [...new Set(missing)].sort();
    return makeCheck(
      'EVIDENCE_AUTHORITY',
      'UNKNOWN',
      blocking,
      `Required evidence has missing or malformed provenance: ${labels.join(', ')}.`,
      labels.join(','),
      policy.minEvidenceAuthority,
      null,
    );
  }

  if (wrongDomain.length > 0) {
    const labels = [...new Set(wrongDomain)].sort();
    return makeCheck(
      'EVIDENCE_AUTHORITY',
      'FAIL',
      blocking,
      `Private/control evidence uses an authority that is invalid for its domain: ${labels.join(', ')}.`,
      labels.join(','),
      'LIVE_PRIVATE_OR_REPLAY_OR_TEST',
      null,
    );
  }

  if (collected.length === 0) {
    return makeCheck(
      'EVIDENCE_AUTHORITY',
      'UNKNOWN',
      blocking,
      'No structurally valid evidence was supplied; authority cannot be established.',
      null,
      policy.minEvidenceAuthority,
      null,
    );
  }
  let weakest = collected[0];
  for (const item of collected) {
    if (AUTHORITY_STRENGTH[item.ts.authority] < AUTHORITY_STRENGTH[weakest.ts.authority]) {
      weakest = item;
    }
  }
  const observed = weakest.ts.authority;
  const ts = basisTime(weakest.ts);
  if (observed === 'UNAVAILABLE') {
    return makeCheck('EVIDENCE_AUTHORITY', 'UNKNOWN', blocking, `Weakest evidence (${weakest.label}) has UNAVAILABLE authority.`, observed, policy.minEvidenceAuthority, ts);
  }
  if (AUTHORITY_STRENGTH[observed] < AUTHORITY_STRENGTH[policy.minEvidenceAuthority]) {
    return makeCheck(
      'EVIDENCE_AUTHORITY',
      'FAIL',
      blocking,
      `Weakest evidence (${weakest.label}) has authority ${observed}, below the policy minimum.`,
      observed,
      policy.minEvidenceAuthority,
      ts,
    );
  }
  return makeCheck('EVIDENCE_AUTHORITY', 'PASS', blocking, `All supplied evidence meets the policy authority floor (weakest: ${weakest.label} = ${observed}).`, observed, policy.minEvidenceAuthority, ts);
}

// ---------- 8-9. per-leg freshness + cross-leg skew ----------

function findLegEvidence(market: MarketEvidence | null, leg: PlanLegIntent): LegMarketEvidence | null {
  if (market === null || typeof market !== 'object' || !Array.isArray(market.legs)) return null;
  const matches = market.legs.filter(
    (candidate): candidate is LegMarketEvidence =>
      typeof candidate === 'object' && candidate !== null && candidate.legKey === leg.legKey,
  );
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (!isVenue(match.venue) || match.venue !== leg.venue || match.symbol !== leg.symbol) return null;
  return match;
}

/** Conservative USD exposure uses the larger of order intent and fresh market reference. */
function conservativeLegNotionalUsd(
  leg: PlanLegIntent,
  market: MarketEvidence | null,
): number | null {
  const evidence = findLegEvidence(market, leg);
  if (
    evidence === null ||
    !isFiniteNumber(evidence.referencePrice) ||
    evidence.referencePrice <= 0
  ) {
    return null;
  }
  const notional = Math.max(leg.intendedPrice, evidence.referencePrice) * leg.intendedQty;
  return isFiniteNumber(notional) ? notional : null;
}

function latestLegEvidenceTime(intent: PlanIntent, market: MarketEvidence | null): number | null {
  let latest: number | null = null;
  for (const leg of intent.legs) {
    const evidence = findLegEvidence(market, leg);
    const time = evidence === null ? null : safeBasisTime(evidence.observedAt);
    if (time === null) return null;
    latest = latest === null ? time : Math.max(latest, time);
  }
  return latest;
}

export function checkLegFreshness(
  intent: PlanIntent,
  market: MarketEvidence | null,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const blocking = isBlockingFamily('LEG_EVIDENCE_FRESHNESS', riskClass);
  return intent.legs.map((leg) => {
    const code = `LEG_EVIDENCE_FRESHNESS_${leg.legKey}`;
    const rawMatches = Array.isArray(market?.legs)
      ? market.legs.filter(
          (row) => typeof row === 'object' && row !== null && row.legKey === leg.legKey,
        )
      : [];
    if (
      rawMatches.length === 1 &&
      (rawMatches[0].venue !== leg.venue || rawMatches[0].symbol !== leg.symbol)
    ) {
      return makeCheck(code, 'FAIL', blocking, `Leg ${leg.legKey} evidence is bound to the wrong venue or symbol.`, `${safeText(rawMatches[0].venue)}/${safeText(rawMatches[0].symbol)}`, `${leg.venue}/${leg.symbol}`, safeBasisTime(rawMatches[0].observedAt));
    }
    const ev = findLegEvidence(market, leg);
    if (ev === null) {
      return makeCheck(code, 'UNKNOWN', blocking, `Exactly one venue/symbol-matched market row is required for leg ${leg.legKey} (${leg.venue}/${leg.symbol}).`, null, 'FRESH', null);
    }
    const report = safeFreshness(ev.observedAt, nowMs);
    if (report === null) {
      return makeCheck(code, 'UNKNOWN', blocking, `Leg ${leg.legKey} evidence timestamp is malformed; freshness cannot be established.`, null, 'FRESH', null);
    }
    const ts = basisTime(ev.observedAt);
    if (!sourceMatchesVenue(ev.observedAt, leg.venue)) {
      return makeCheck(code, 'FAIL', blocking, `Leg ${leg.legKey} provenance source contradicts its venue.`, ev.observedAt.sourceId, leg.venue, ts);
    }
    switch (report.state) {
      case 'FRESH':
        if (ev.observedAt.completeness !== 'COMPLETE') {
          return makeCheck(code, 'UNKNOWN', blocking, `Leg ${leg.legKey} evidence is ${ev.observedAt.completeness}; required market truth is incomplete.`, ev.observedAt.completeness, 'COMPLETE', ts);
        }
        return makeCheck(code, 'PASS', blocking, `Leg ${leg.legKey} evidence is fresh (age ${report.ageMs} ms, basis ${report.basis}).`, report.ageMs, ev.observedAt.maxAgeMs, ts);
      case 'STALE':
        return makeCheck(code, 'FAIL', blocking, `Leg ${leg.legKey} evidence is stale (age ${report.ageMs} ms exceeds ${ev.observedAt.maxAgeMs} ms).`, report.ageMs, ev.observedAt.maxAgeMs, ts);
      case 'CLOCK_SKEWED':
        return makeCheck(code, 'FAIL', blocking, `Leg ${leg.legKey} evidence is from the future (age ${report.ageMs} ms): clock skew.`, report.ageMs, ev.observedAt.maxAgeMs, ts);
      case 'UNAVAILABLE':
        return makeCheck(code, 'UNKNOWN', blocking, `Leg ${leg.legKey} evidence is marked unavailable.`, 'UNAVAILABLE', 'FRESH', ts);
    }
  });
}

export function checkSpotPerpSkew(
  intent: PlanIntent,
  market: MarketEvidence | null,
  policy: RiskPolicy,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('SPOT_PERP_SKEW', riskClass);
  if (intent.legs.length < 2) {
    return makeCheck('SPOT_PERP_SKEW', 'PASS', blocking, 'Single-leg intent: cross-leg evidence skew is not applicable.', 'SINGLE_LEG', policy.maxSpotPerpSkewMs, null);
  }
  const times: number[] = [];
  for (const leg of intent.legs) {
    const ev = findLegEvidence(market, leg);
    const t = ev === null ? null : safeBasisTime(ev.observedAt);
    if (t === null) {
      return makeCheck('SPOT_PERP_SKEW', 'UNKNOWN', blocking, `Missing or malformed evidence for leg ${leg.legKey}; cross-leg skew cannot be established.`, null, policy.maxSpotPerpSkewMs, null);
    }
    times.push(t);
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  const skew = max - min;
  if (skew > policy.maxSpotPerpSkewMs) {
    return makeCheck('SPOT_PERP_SKEW', 'FAIL', blocking, `Leg evidence basis times differ by ${skew} ms, beyond the ${policy.maxSpotPerpSkewMs} ms policy window.`, skew, policy.maxSpotPerpSkewMs, max);
  }
  return makeCheck('SPOT_PERP_SKEW', 'PASS', blocking, `Leg evidence basis times are within ${skew} ms of each other.`, skew, policy.maxSpotPerpSkewMs, max);
}

// ---------- 10. permission posture ----------

export function checkPermissionPosture(
  intent: PlanIntent,
  account: AccountEvidence | null,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('PERMISSION_POSTURE', riskClass);
  const required = [...new Set(intent.legs.map((l) => l.requiredPermission))].sort();
  const limit = required.join(',');
  const perms = account?.permissions ?? null;
  if (perms === null) {
    return makeCheck('PERMISSION_POSTURE', 'UNKNOWN', blocking, 'No account permission evidence was supplied.', null, limit, null);
  }
  const report = safeFreshness(perms.observedAt, nowMs);
  const ts = safeBasisTime(perms.observedAt);
  if (
    typeof account?.accountId !== 'string' ||
    account.accountId !== intent.accountId ||
    typeof perms.accountId !== 'string' ||
    perms.accountId !== intent.accountId
  ) {
    return makeCheck('PERMISSION_POSTURE', 'FAIL', blocking, 'Account permission evidence is scoped to a different account.', safeText(account?.accountId, 300), intent.accountId, ts);
  }
  if (
    report === null ||
    report.state !== 'FRESH' ||
    perms.observedAt.completeness !== 'COMPLETE'
  ) {
    return makeCheck('PERMISSION_POSTURE', 'UNKNOWN', blocking, `Permission evidence is ${report === null ? 'malformed' : report.state}; posture cannot be trusted.`, null, limit, ts);
  }
  let evidenceTs = ts;
  if (intent.legs.some((leg) => leg.venue === 'BINANCE_USDM')) {
    const mode = account?.exposures ?? null;
    if (mode === null || typeof mode !== 'object') {
      return makeCheck('PERMISSION_POSTURE', 'UNKNOWN', blocking, 'USD-M account position mode is unknown.', null, 'ONE_WAY', ts);
    }
    const modeReport = safeFreshness(mode.observedAt, nowMs);
    const modeTs = safeBasisTime(mode.observedAt);
    evidenceTs = modeTs === null ? ts : ts === null ? modeTs : Math.max(ts, modeTs);
    if (typeof mode.accountId !== 'string') {
      return makeCheck('PERMISSION_POSTURE', 'UNKNOWN', blocking, 'USD-M position-mode evidence has no account binding.', null, intent.accountId, evidenceTs);
    }
    if (mode.accountId !== intent.accountId) {
      return makeCheck('PERMISSION_POSTURE', 'FAIL', blocking, 'USD-M position-mode evidence belongs to a different account.', safeText(mode.accountId, 300), intent.accountId, evidenceTs);
    }
    if (
      modeReport === null ||
      modeReport.state !== 'FRESH' ||
      mode.observedAt.completeness !== 'COMPLETE'
    ) {
      return makeCheck('PERMISSION_POSTURE', 'UNKNOWN', blocking, 'USD-M position-mode evidence is stale, incomplete, or malformed.', null, 'FRESH_COMPLETE_ONE_WAY', evidenceTs);
    }
    if (mode.positionMode === null || mode.positionMode === undefined) {
      return makeCheck('PERMISSION_POSTURE', 'UNKNOWN', blocking, 'USD-M position mode is unknown.', null, 'ONE_WAY', evidenceTs);
    }
    if (mode.positionMode !== 'ONE_WAY') {
      return makeCheck('PERMISSION_POSTURE', 'FAIL', blocking, 'This intent uses one-way signed quantities but the account is not in one-way mode.', safeText(mode.positionMode, 300), 'ONE_WAY', evidenceTs);
    }
  }
  const byPermission: Record<string, boolean | null> = {
    SPOT: perms.spot,
    MARGIN: perms.margin,
    FUTURES: perms.futures,
  };
  const denied = required.filter((p) => byPermission[p] === false);
  const unknown = required.filter((p) => byPermission[p] !== false && typeof byPermission[p] !== 'boolean');
  const observed = required.map((p) => `${p}=${byPermission[p] === null || byPermission[p] === undefined ? 'null' : safeText(byPermission[p])}`).join(',');
  if (denied.length > 0) {
    return makeCheck('PERMISSION_POSTURE', 'FAIL', blocking, `Account lacks required permission(s): ${denied.join(', ')}.`, observed, limit, evidenceTs);
  }
  if (unknown.length > 0) {
    return makeCheck('PERMISSION_POSTURE', 'UNKNOWN', blocking, `Required permission(s) unknown: ${unknown.join(', ')}.`, observed, limit, evidenceTs);
  }
  return makeCheck('PERMISSION_POSTURE', 'PASS', blocking, 'All permissions and required account modes are granted.', observed, limit, evidenceTs);
}

export function checkSpotInventory(
  intent: PlanIntent,
  market: MarketEvidence | null,
  account: AccountEvidence | null,
  nowMs: number,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('SPOT_INVENTORY', intent.riskClass);
  const spotLegs = intent.legs.filter(
    (leg) => leg.venue === 'BINANCE_SPOT' && leg.requiredPermission === 'SPOT',
  );
  if (spotLegs.length === 0) {
    return makeCheck('SPOT_INVENTORY', 'PASS', blocking, 'No cash-spot leg requires inventory funding.', 'NOT_APPLICABLE', null, null);
  }
  const rows = Array.isArray(account?.spotInventory) ? account.spotInventory : null;
  if (rows === null) {
    return makeCheck('SPOT_INVENTORY', 'UNKNOWN', blocking, 'Spot inventory evidence is unavailable.', null, 'SUFFICIENT_BALANCE', null);
  }
  let latestTs: number | null = null;
  for (const symbol of [...new Set(spotLegs.map((leg) => leg.symbol))].sort()) {
    const matches = rows.filter(
      (row) => typeof row === 'object' && row !== null && row.symbol === symbol,
    );
    if (matches.length !== 1) {
      return makeCheck('SPOT_INVENTORY', 'UNKNOWN', blocking, `Exactly one spot inventory row is required for ${symbol}.`, null, 'UNIQUE_BALANCE_ROW', null);
    }
    const row = matches[0];
    const report = safeFreshness(row.observedAt, nowMs);
    const ts = safeBasisTime(row.observedAt);
    if (
      report === null ||
      report.state !== 'FRESH' ||
      row.observedAt.completeness !== 'COMPLETE' ||
      row.accountId !== intent.accountId ||
      !isFiniteNonNegative(row.availableBaseQty) ||
      !isFiniteNonNegative(row.availableQuoteUsd)
    ) {
      return makeCheck('SPOT_INVENTORY', 'UNKNOWN', blocking, `Spot inventory for ${symbol} is stale, incomplete, or malformed.`, null, 'FRESH_COMPLETE_BALANCE', ts);
    }
    if (ts !== null) latestTs = latestTs === null ? ts : Math.max(latestTs, ts);
    const requiredBase = spotLegs
      .filter((leg) => leg.symbol === symbol && leg.side === 'SELL')
      .reduce((sum, leg) => sum + leg.intendedQty, 0);
    const buyNotionals = spotLegs
      .filter((leg) => leg.symbol === symbol && leg.side === 'BUY')
      .map((leg) => conservativeLegNotionalUsd(leg, market));
    if (buyNotionals.some((notional) => notional === null)) {
      return makeCheck('SPOT_INVENTORY', 'UNKNOWN', blocking, `Spot BUY funding for ${symbol} lacks a valid reference price.`, null, 'KNOWN_QUOTE_REQUIREMENT', ts);
    }
    const requiredQuote = (buyNotionals as number[]).reduce((sum, value) => sum + value, 0);
    if (row.availableBaseQty < requiredBase || row.availableQuoteUsd < requiredQuote) {
      return makeCheck(
        'SPOT_INVENTORY',
        'FAIL',
        blocking,
        `Spot inventory for ${symbol} cannot fund the intended cash leg(s).`,
        `base=${row.availableBaseQty},quote=${row.availableQuoteUsd}`,
        `base=${requiredBase},quote=${requiredQuote}`,
        ts,
      );
    }
  }
  return makeCheck('SPOT_INVENTORY', 'PASS', blocking, 'Fresh spot inventory funds every cash-spot leg.', 'SUFFICIENT', 'SUFFICIENT_BALANCE', latestTs);
}

// ---------- 11-12. symbol filters + per-leg notional ----------

export function checkSymbolFilters(
  intent: PlanIntent,
  market: MarketEvidence | null,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const blocking = isBlockingFamily('SYMBOL_FILTERS', riskClass);
  return intent.legs.map((leg) => {
    const code = `SYMBOL_FILTERS_${leg.legKey}`;
    const ev = findLegEvidence(market, leg);
    const filters = ev?.filters ?? null;
    if (filters === null) {
      return makeCheck(code, 'UNKNOWN', blocking, `No symbol filter evidence for leg ${leg.legKey} (${leg.symbol}).`, null, null, null);
    }
    const report = safeFreshness(filters.observedAt, nowMs);
    const ts = safeBasisTime(filters.observedAt);
    if (report === null || report.state === 'UNAVAILABLE') {
      return makeCheck(code, 'UNKNOWN', blocking, `Symbol filter evidence for leg ${leg.legKey} is malformed or unavailable.`, null, null, ts);
    }
    if (report.state !== 'FRESH' || filters.observedAt.completeness !== 'COMPLETE') {
      return makeCheck(code, 'UNKNOWN', blocking, `Symbol filter evidence for leg ${leg.legKey} is ${report.state}; filters cannot be trusted.`, null, null, ts);
    }
    if (filters.venue !== leg.venue || filters.symbol !== leg.symbol) {
      return makeCheck(code, 'FAIL', blocking, `Symbol filters for ${leg.legKey} are bound to the wrong venue or symbol.`, `${safeText(filters.venue)}/${safeText(filters.symbol)}`, `${leg.venue}/${leg.symbol}`, ts);
    }
    if (!sourceMatchesVenue(filters.observedAt, leg.venue)) {
      return makeCheck(code, 'FAIL', blocking, `Symbol-filter provenance for ${leg.legKey} contradicts its venue.`, filters.observedAt.sourceId, leg.venue, ts);
    }
    if (
      !isVenue(filters.venue) ||
      typeof filters.symbol !== 'string' ||
      !isFiniteNonNegative(filters.minPrice) ||
      (filters.maxPrice !== null && (!isFiniteNumber(filters.maxPrice) || filters.maxPrice <= 0 || filters.maxPrice < filters.minPrice)) ||
      !isFiniteNumber(filters.tickSize) || filters.tickSize <= 0 ||
      !isFiniteNumber(filters.stepSize) || filters.stepSize <= 0 ||
      !isFiniteNonNegative(filters.minQty) ||
      (filters.maxQty !== null && (!isFiniteNumber(filters.maxQty) || filters.maxQty <= 0 || filters.maxQty < filters.minQty)) ||
      !isFiniteNonNegative(filters.minNotionalUsd) ||
      (filters.maxNotionalUsd !== null &&
        (!isFiniteNumber(filters.maxNotionalUsd) || filters.maxNotionalUsd <= 0 || filters.maxNotionalUsd < filters.minNotionalUsd))
    ) {
      return makeCheck(code, 'UNKNOWN', blocking, `Symbol filter values for leg ${leg.legKey} are malformed.`, null, null, ts);
    }
    const violations: string[] = [];
    if (leg.intendedPrice < filters.minPrice) {
      violations.push(`price ${leg.intendedPrice} below minPrice ${filters.minPrice}`);
    }
    if (filters.maxPrice !== null && leg.intendedPrice > filters.maxPrice) {
      violations.push(`price ${leg.intendedPrice} above maxPrice ${filters.maxPrice}`);
    }
    const priceOrigin = leg.venue === 'BINANCE_USDM' ? filters.minPrice : 0;
    const quantityOrigin = leg.venue === 'BINANCE_USDM' ? filters.minQty : 0;
    if (!conformsToIncrement(leg.intendedPrice, filters.tickSize, priceOrigin)) {
      violations.push(`price ${leg.intendedPrice} violates tickSize ${filters.tickSize}`);
    }
    if (!conformsToIncrement(leg.intendedQty, filters.stepSize, quantityOrigin)) {
      violations.push(`qty ${leg.intendedQty} violates stepSize ${filters.stepSize}`);
    }
    if (leg.intendedQty < filters.minQty) {
      violations.push(`qty ${leg.intendedQty} below minQty ${filters.minQty}`);
    }
    if (filters.maxQty !== null && leg.intendedQty > filters.maxQty) {
      violations.push(`qty ${leg.intendedQty} above maxQty ${filters.maxQty}`);
    }
    const notional = exactProduct(leg.intendedPrice, leg.intendedQty) as ExactDecimal;
    if (exactCompare(notional, exactDecimal(filters.minNotionalUsd) as ExactDecimal) < 0) {
      violations.push(`notional ${exactDisplay(notional)} below venue minNotional ${filters.minNotionalUsd}`);
    }
    if (
      filters.maxNotionalUsd !== null &&
      exactCompare(notional, exactDecimal(filters.maxNotionalUsd) as ExactDecimal) > 0
    ) {
      violations.push(`notional ${exactDisplay(notional)} above venue maxNotional ${filters.maxNotionalUsd}`);
    }
    const observed = `price=${leg.intendedPrice},qty=${leg.intendedQty}`;
    const limit = `price=${filters.minPrice}..${filters.maxPrice ?? 'NONE'},tick=${filters.tickSize},qty=${filters.minQty}..${filters.maxQty ?? 'NONE'},step=${filters.stepSize},notional=${filters.minNotionalUsd}..${filters.maxNotionalUsd ?? 'NONE'}`;
    if (violations.length > 0) {
      return makeCheck(code, 'FAIL', blocking, `Leg ${leg.legKey} (${leg.symbol}) violates venue filters: ${violations.join('; ')}.`, observed, limit, ts);
    }
    return makeCheck(code, 'PASS', blocking, `Leg ${leg.legKey} (${leg.symbol}) conforms to venue filters.`, observed, limit, ts);
  });
}

export function checkLegNotional(
  intent: PlanIntent,
  market: MarketEvidence | null,
  policy: RiskPolicy,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const blocking = isBlockingFamily('LEG_NOTIONAL', riskClass);
  return intent.legs.map((leg) => {
    const code = `LEG_NOTIONAL_${leg.legKey}`;
    const evidence = findLegEvidence(market, leg);
    const notional =
      evidence !== null && isFiniteNumber(evidence.referencePrice) && evidence.referencePrice > 0
        ? exactProduct(Math.max(leg.intendedPrice, evidence.referencePrice), leg.intendedQty)
        : null;
    const evidenceTs = safeBasisTime(evidence?.observedAt);
    const limit = `${policy.minLegNotionalUsd}..${policy.maxLegNotionalUsd}`;
    if (notional === null) {
      return makeCheck(code, 'UNKNOWN', blocking, `Leg ${leg.legKey} has no valid venue/symbol-bound market reference price.`, null, limit, evidenceTs);
    }
    if (exactCompare(notional, exactDecimal(policy.minLegNotionalUsd) as ExactDecimal) < 0) {
      return makeCheck(code, 'FAIL', blocking, `Leg ${leg.legKey} notional ${exactDisplay(notional)} USD is below the policy minimum.`, exactDisplay(notional), limit, evidenceTs);
    }
    if (exactCompare(notional, exactDecimal(policy.maxLegNotionalUsd) as ExactDecimal) > 0) {
      return makeCheck(code, 'FAIL', blocking, `Leg ${leg.legKey} notional ${exactDisplay(notional)} USD exceeds the policy maximum.`, exactDisplay(notional), limit, evidenceTs);
    }
    return makeCheck(code, 'PASS', blocking, `Leg ${leg.legKey} notional ${exactDisplay(notional)} USD is within policy bounds.`, exactDisplay(notional), limit, evidenceTs);
  });
}

// ---------- 13-15. gross notional / hedge ratio / residual delta ----------

export function checkGrossNotional(intent: PlanIntent, market: MarketEvidence | null, policy: RiskPolicy, riskClass: ActionRiskClass): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('MAX_GROSS_NOTIONAL', riskClass);
  const evidenceTs = latestLegEvidenceTime(intent, market);
  let gross: ExactDecimal = { coefficient: 0n, scale: 0 };
  for (const leg of intent.legs) {
    const evidence = findLegEvidence(market, leg);
    if (evidence === null || !isFiniteNumber(evidence.referencePrice) || evidence.referencePrice <= 0) {
      return makeCheck('MAX_GROSS_NOTIONAL', 'UNKNOWN', blocking, 'Gross notional cannot be established without every leg reference price.', null, policy.maxGrossNotionalUsd, evidenceTs);
    }
    const notional = exactProduct(Math.max(leg.intendedPrice, evidence.referencePrice), leg.intendedQty);
    if (notional === null) {
      return makeCheck('MAX_GROSS_NOTIONAL', 'UNKNOWN', blocking, 'Gross notional aggregation is not finite.', null, policy.maxGrossNotionalUsd, evidenceTs);
    }
    gross = exactAdd(gross, notional);
  }
  if (exactCompare(gross, exactDecimal(policy.maxGrossNotionalUsd) as ExactDecimal) > 0) {
    return makeCheck('MAX_GROSS_NOTIONAL', 'FAIL', blocking, `Gross notional ${exactDisplay(gross)} USD exceeds the policy cap.`, exactDisplay(gross), policy.maxGrossNotionalUsd, evidenceTs);
  }
  return makeCheck('MAX_GROSS_NOTIONAL', 'PASS', blocking, `Gross notional ${exactDisplay(gross)} USD is within the policy cap.`, exactDisplay(gross), policy.maxGrossNotionalUsd, evidenceTs);
}

export function checkHedgeRatio(intent: PlanIntent, policy: RiskPolicy, riskClass: ActionRiskClass): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('HEDGE_RATIO_TOLERANCE', riskClass);
  const bySymbol = new Map<string, PlanLegIntent[]>();
  for (const leg of intent.legs) {
    const rows = bySymbol.get(leg.symbol) ?? [];
    rows.push(leg);
    bySymbol.set(leg.symbol, rows);
  }
  const deviations = [...bySymbol.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([symbol, legs]) => {
      let buy: ExactDecimal = { coefficient: 0n, scale: 0 };
      let sell: ExactDecimal = { coefficient: 0n, scale: 0 };
      for (const leg of legs) {
        const quantity = exactDecimal(leg.intendedQty) as ExactDecimal;
        if (leg.side === 'BUY') buy = exactAdd(buy, quantity);
        else sell = exactAdd(sell, quantity);
      }
      const difference = exactAbs(exactAdd(buy, exactNegate(sell)));
      const denominator = exactCompare(buy, sell) >= 0 ? buy : sell;
      const numerator = exactMultiply(difference, exactDecimal(100) as ExactDecimal);
      const allowedNumerator = exactMultiply(
        denominator,
        exactDecimal(policy.maxHedgeRatioDeviationPct) as ExactDecimal,
      );
      return {
        symbol,
        buy,
        sell,
        numerator,
        denominator,
        exceeds: exactCompare(numerator, allowedNumerator) > 0,
      };
    });
  const worst = deviations.reduce((a, b) =>
    exactCompare(
      exactMultiply(b.numerator, a.denominator),
      exactMultiply(a.numerator, b.denominator),
    ) > 0
      ? b
      : a,
  );
  const observed = deviations
    .map((row) => `${row.symbol}:${exactDisplay(row.numerator)}/${exactDisplay(row.denominator)}%`)
    .join(',');
  if (worst.exceeds) {
    return makeCheck(
      'HEDGE_RATIO_TOLERANCE',
      'FAIL',
      blocking,
      `Worst same-symbol hedge deviation exceeds the exact ${policy.maxHedgeRatioDeviationPct}% cap for ${worst.symbol}.`,
      observed,
      policy.maxHedgeRatioDeviationPct,
      null,
    );
  }
  return makeCheck('HEDGE_RATIO_TOLERANCE', 'PASS', blocking, 'Every symbol is hedged within the base-quantity tolerance.', observed, policy.maxHedgeRatioDeviationPct, null);
}

export function checkResidualDelta(intent: PlanIntent, market: MarketEvidence | null, policy: RiskPolicy, riskClass: ActionRiskClass): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('RESIDUAL_DELTA', riskClass);
  const evidenceTs = latestLegEvidenceTime(intent, market);
  const bySymbol = new Map<string, PlanLegIntent[]>();
  for (const leg of intent.legs) {
    const rows = bySymbol.get(leg.symbol) ?? [];
    rows.push(leg);
    bySymbol.set(leg.symbol, rows);
  }
  const residuals = [...bySymbol.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([symbol, legs]) => {
      let residual: ExactDecimal = { coefficient: 0n, scale: 0 };
      for (const leg of legs) {
        const evidence = findLegEvidence(market, leg);
        if (
          evidence === null ||
          !isFiniteNumber(evidence.referencePrice) ||
          evidence.referencePrice <= 0
        ) {
          return { symbol, value: null, exceeds: true };
        }
        const notional = exactProduct(
          Math.max(leg.intendedPrice, evidence.referencePrice),
          leg.intendedQty,
        );
        if (notional === null) return { symbol, value: null, exceeds: true };
        residual = exactAdd(residual, leg.side === 'BUY' ? notional : exactNegate(notional));
      }
      const cap = exactDecimal(policy.maxResidualDeltaUsd) as ExactDecimal;
      return {
        symbol,
        value: residual,
        exceeds: exactCompare(exactAbs(residual), cap) > 0,
      };
    });
  if (residuals.some((row) => row.value === null)) {
    return makeCheck('RESIDUAL_DELTA', 'UNKNOWN', blocking, 'Residual delta cannot be established without every finite venue-bound reference.', null, policy.maxResidualDeltaUsd, evidenceTs);
  }
  const failures = residuals.filter((row) => row.exceeds);
  const observed = residuals
    .map((row) => `${row.symbol}:${row.value === null ? 'UNKNOWN' : exactDisplay(row.value)}`)
    .join(',');
  if (failures.length > 0) {
    const worst = failures.reduce((a, b) =>
      exactCompare(exactAbs(b.value as ExactDecimal), exactAbs(a.value as ExactDecimal)) > 0 ? b : a,
    );
    return makeCheck('RESIDUAL_DELTA', 'FAIL', blocking, `Residual delta for ${worst.symbol} exceeds the per-symbol policy cap.`, observed, policy.maxResidualDeltaUsd, evidenceTs);
  }
  return makeCheck('RESIDUAL_DELTA', 'PASS', blocking, 'Every symbol residual delta is within the policy cap.', observed, policy.maxResidualDeltaUsd, evidenceTs);
}

// ---------- 16. maximum naked duration ----------

export function checkMaxNakedDuration(intent: PlanIntent, policy: RiskPolicy, riskClass: ActionRiskClass): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('MAX_NAKED_DURATION', riskClass);
  if (intent.declaredMaxNakedDurationMs === null) {
    return makeCheck(
      'MAX_NAKED_DURATION',
      'UNKNOWN',
      blocking,
      'Intent does not declare a naked-exposure cap; an unbounded single-leg window fails closed.',
      null,
      policy.maxNakedDurationMs,
      null,
    );
  }
  if (intent.declaredMaxNakedDurationMs > policy.maxNakedDurationMs) {
    return makeCheck(
      'MAX_NAKED_DURATION',
      'FAIL',
      blocking,
      `Declared naked-exposure cap ${intent.declaredMaxNakedDurationMs} ms exceeds the policy ceiling.`,
      intent.declaredMaxNakedDurationMs,
      policy.maxNakedDurationMs,
      null,
    );
  }
  return makeCheck('MAX_NAKED_DURATION', 'PASS', blocking, `Declared naked-exposure cap ${intent.declaredMaxNakedDurationMs} ms is within the policy ceiling.`, intent.declaredMaxNakedDurationMs, policy.maxNakedDurationMs, null);
}

// ---------- 17-21. edge / cost / spread / depth / slippage ----------

export function checkEdgeEvidence(
  market: MarketEvidence | null,
  intent: PlanIntent,
  policy: RiskPolicy,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const bEdge = isBlockingFamily('NET_EDGE', riskClass);
  const bCost = isBlockingFamily('COST_EVIDENCE', riskClass);
  const bSpread = isBlockingFamily('SPREAD', riskClass);
  const bDepth = isBlockingFamily('DEPTH', riskClass);
  const bSlippage = isBlockingFamily('SLIPPAGE', riskClass);

  const expectedEdgeDigest = deriveRiskIntentDigest(intent);
  const edgeBindingStatus: 'MATCH' | 'MISSING' | 'MISMATCH' =
    market === null || typeof market.edgeIntentDigest !== 'string' || market.edgeIntentDigest.length === 0
      ? 'MISSING'
      : market.edgeIntentDigest === expectedEdgeDigest
        ? 'MATCH'
        : 'MISMATCH';

  const edgeReport = market === null ? null : safeFreshness(market.edgeObservedAt, nowMs);
  const edgeTs = market === null ? null : safeBasisTime(market.edgeObservedAt);
  const edgeFresh =
    edgeReport !== null &&
    edgeReport.state === 'FRESH' &&
    market?.edgeObservedAt?.completeness === 'COMPLETE';
  const edgeStaleDetail =
    market === null
      ? 'No market evidence was supplied.'
      : edgeReport === null
        ? 'Edge/cost/slippage evidence has no valid provenance timestamp.'
        : `Edge/cost/slippage evidence is ${edgeReport.state}.`;

  let netEdge: Readonly<RiskCheck>;
  if (edgeBindingStatus !== 'MATCH') {
    netEdge = makeCheck(
      'NET_EDGE',
      edgeBindingStatus === 'MISMATCH' ? 'FAIL' : 'UNKNOWN',
      bEdge,
      edgeBindingStatus === 'MISMATCH'
        ? 'Net-edge estimate is bound to a different semantic intent.'
        : 'Net-edge estimate has no immutable intent binding.',
      market?.edgeIntentDigest ?? null,
      expectedEdgeDigest,
      edgeTs,
    );
  } else if (market === null || market.netEdgePct === null || !edgeFresh) {
    const why = market !== null && market.netEdgePct === null && edgeFresh ? 'Source supplied no net-edge figure.' : edgeStaleDetail;
    netEdge = makeCheck('NET_EDGE', 'UNKNOWN', bEdge, `${why} Net edge cannot be verified.`, market?.netEdgePct ?? null, policy.minNetEdgePct, edgeTs);
  } else if (!isFiniteNumber(market.netEdgePct)) {
    netEdge = makeCheck('NET_EDGE', 'UNKNOWN', bEdge, 'Net-edge figure is malformed.', null, policy.minNetEdgePct, edgeTs);
  } else if (market.netEdgePct < policy.minNetEdgePct) {
    netEdge = makeCheck('NET_EDGE', 'FAIL', bEdge, `Net edge ${market.netEdgePct}% is below the policy minimum.`, market.netEdgePct, policy.minNetEdgePct, edgeTs);
  } else {
    netEdge = makeCheck('NET_EDGE', 'PASS', bEdge, `Net edge ${market.netEdgePct}% meets the policy minimum.`, market.netEdgePct, policy.minNetEdgePct, edgeTs);
  }

  let cost: Readonly<RiskCheck>;
  if (edgeBindingStatus !== 'MATCH') {
    cost = makeCheck(
      'COST_EVIDENCE',
      edgeBindingStatus === 'MISMATCH' ? 'FAIL' : 'UNKNOWN',
      bCost,
      edgeBindingStatus === 'MISMATCH'
        ? 'Cost estimate is bound to a different semantic intent.'
        : 'Cost estimate has no immutable intent binding.',
      market?.edgeIntentDigest ?? null,
      expectedEdgeDigest,
      edgeTs,
    );
  } else if (market === null || market.estimatedCostPct === null || !isFiniteNonNegative(market.estimatedCostPct) || !edgeFresh) {
    cost = makeCheck('COST_EVIDENCE', 'UNKNOWN', bCost, `${edgeStaleDetail} A missing cost estimate is NOT zero cost; it fails closed.`, market?.estimatedCostPct ?? null, null, edgeTs);
  } else {
    cost = makeCheck('COST_EVIDENCE', 'PASS', bCost, `Cost estimate ${market.estimatedCostPct}% is present and fresh.`, market.estimatedCostPct, null, edgeTs);
  }

  let spread: Readonly<RiskCheck>;
  let depth: Readonly<RiskCheck>;
  {
    const spreads: number[] = [];
    const depths: number[] = [];
    let spreadProblem: string | null = null;
    let depthProblem: string | null = null;
    let legTs: number | null = null;
    for (const leg of intent.legs) {
      const ev = findLegEvidence(market, leg);
      const t = ev === null ? null : safeBasisTime(ev.observedAt);
      if (ev === null || t === null) {
        spreadProblem ??= `No venue/symbol-matched market evidence for leg ${leg.legKey}.`;
        depthProblem ??= `No venue/symbol-matched market evidence for leg ${leg.legKey}.`;
        break;
      }
      legTs = legTs === null ? t : Math.max(legTs, t);
      const freshness = safeFreshness(ev.observedAt, nowMs);
      if (freshness === null || freshness.state !== 'FRESH') {
        spreadProblem ??= `Leg ${leg.legKey} evidence is ${freshness === null ? 'malformed' : freshness.state}.`;
        depthProblem ??= `Leg ${leg.legKey} evidence is ${freshness === null ? 'malformed' : freshness.state}.`;
        continue;
      }
      if (!isFiniteNonNegative(ev.spreadPct)) {
        spreadProblem ??= `Leg ${leg.legKey} spread is missing, negative, or malformed.`;
      } else {
        spreads.push(ev.spreadPct);
      }
      if (!isFiniteNonNegative(ev.topDepthUsd)) {
        depthProblem ??= `Leg ${leg.legKey} depth is missing, negative, or malformed.`;
      } else {
        depths.push(ev.topDepthUsd);
      }
    }
    if (spreadProblem !== null) {
      spread = makeCheck('SPREAD', 'UNKNOWN', bSpread, spreadProblem, null, policy.maxSpreadPct, legTs);
    } else {
      const worstSpread = Math.max(...spreads);
      spread =
        worstSpread > policy.maxSpreadPct
          ? makeCheck('SPREAD', 'FAIL', bSpread, `Worst leg spread ${worstSpread}% exceeds the policy cap.`, worstSpread, policy.maxSpreadPct, legTs)
          : makeCheck('SPREAD', 'PASS', bSpread, `Worst leg spread ${worstSpread}% is within the policy cap.`, worstSpread, policy.maxSpreadPct, legTs);
    }
    if (depthProblem !== null) {
      depth = makeCheck('DEPTH', 'UNKNOWN', bDepth, depthProblem, null, policy.minTopDepthUsd, legTs);
    } else {
      const worstDepth = Math.min(...depths);
      depth =
        worstDepth < policy.minTopDepthUsd
          ? makeCheck('DEPTH', 'FAIL', bDepth, `Thinnest leg top-of-book depth ${worstDepth} USD is below the policy floor.`, worstDepth, policy.minTopDepthUsd, legTs)
          : makeCheck('DEPTH', 'PASS', bDepth, `Thinnest leg top-of-book depth ${worstDepth} USD meets the policy floor.`, worstDepth, policy.minTopDepthUsd, legTs);
    }
  }

  let slippage: Readonly<RiskCheck>;
  if (edgeBindingStatus !== 'MATCH') {
    slippage = makeCheck(
      'SLIPPAGE',
      edgeBindingStatus === 'MISMATCH' ? 'FAIL' : 'UNKNOWN',
      bSlippage,
      edgeBindingStatus === 'MISMATCH'
        ? 'Slippage estimate is bound to a different semantic intent.'
        : 'Slippage estimate has no immutable intent binding.',
      market?.edgeIntentDigest ?? null,
      expectedEdgeDigest,
      edgeTs,
    );
  } else if (market === null || market.estimatedSlippagePct === null || !isFiniteNonNegative(market.estimatedSlippagePct) || !edgeFresh) {
    slippage = makeCheck('SLIPPAGE', 'UNKNOWN', bSlippage, `${edgeStaleDetail} Slippage cannot be verified.`, market?.estimatedSlippagePct ?? null, policy.maxSlippagePct, edgeTs);
  } else if (market.estimatedSlippagePct > policy.maxSlippagePct) {
    slippage = makeCheck('SLIPPAGE', 'FAIL', bSlippage, `Estimated slippage ${market.estimatedSlippagePct}% exceeds the policy cap.`, market.estimatedSlippagePct, policy.maxSlippagePct, edgeTs);
  } else {
    slippage = makeCheck('SLIPPAGE', 'PASS', bSlippage, `Estimated slippage ${market.estimatedSlippagePct}% is within the policy cap.`, market.estimatedSlippagePct, policy.maxSlippagePct, edgeTs);
  }

  return [netEdge, cost, spread, depth, slippage];
}

// ---------- 22. margin headroom ----------

export function checkMarginHeadroom(
  intent: PlanIntent,
  market: MarketEvidence | null,
  account: AccountEvidence | null,
  policy: RiskPolicy,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('MARGIN_HEADROOM', riskClass);
  const marketTs = latestLegEvidenceTime(intent, market);
  const leveragedLegs = intent.legs.filter(
    (leg) => leg.venue === 'BINANCE_USDM' || leg.requiredPermission === 'MARGIN',
  );
  const zero: ExactDecimal = { coefficient: 0n, scale: 0 };
  const declaredTotal = intent.estimatedRequiredMarginUsd;
  if (declaredTotal === null) {
    return makeCheck('MARGIN_HEADROOM', 'UNKNOWN', blocking, 'Intent does not declare aggregate required margin.', null, null, marketTs);
  }
  if (leveragedLegs.some((leg) => leg.estimatedRequiredMarginUsd === null)) {
    return makeCheck('MARGIN_HEADROOM', 'UNKNOWN', blocking, 'At least one leveraged leg has unknown bucket-scoped margin.', null, null, marketTs);
  }

  let sumDeclared = zero;
  for (const leg of leveragedLegs) {
    sumDeclared = exactAdd(sumDeclared, exactDecimal(leg.estimatedRequiredMarginUsd as number) as ExactDecimal);
  }
  const aggregate = exactDecimal(declaredTotal) as ExactDecimal;
  if (exactCompare(sumDeclared, aggregate) !== 0) {
    return makeCheck('MARGIN_HEADROOM', 'FAIL', blocking, 'Aggregate declared margin does not equal the exact sum assigned to leveraged legs.', declaredTotal, exactDisplay(sumDeclared), marketTs);
  }

  interface MarginScopeWork {
    key: string;
    bucket: PositionBucket;
    scopeSymbol: string | null;
    legs: PlanLegIntent[];
    declared: ExactDecimal;
    minimum: ExactDecimal | null;
  }
  const scopes = new Map<string, MarginScopeWork>();
  for (const leg of leveragedLegs) {
    const scopeSymbol = leg.positionBucket === 'MARGIN_ISOLATED' ? leg.symbol : null;
    const key = `${leg.positionBucket}:${scopeSymbol ?? '*'}`;
    const current = scopes.get(key) ?? {
      key,
      bucket: leg.positionBucket,
      scopeSymbol,
      legs: [],
      declared: zero,
      minimum: zero,
    };
    current.legs.push(leg);
    current.declared = exactAdd(
      current.declared,
      exactDecimal(leg.estimatedRequiredMarginUsd as number) as ExactDecimal,
    );
    scopes.set(key, current);
  }

  const exposureSnapshot = account?.exposures ?? null;
  for (const scope of scopes.values()) {
    let minimum = zero;
    if (riskClass === 'RISK_INCREASING') {
      for (const leg of scope.legs) {
        const evidence = findLegEvidence(market, leg);
        if (evidence === null || !isFiniteNumber(evidence.referencePrice) || evidence.referencePrice <= 0) {
          scope.minimum = null;
          break;
        }
        const notional = exactProduct(
          Math.max(leg.intendedPrice, evidence.referencePrice),
          leg.intendedQty,
        );
        if (notional === null) {
          scope.minimum = null;
          break;
        }
        minimum = exactAdd(minimum, notional);
      }
    } else {
      const snapshotReport = safeFreshness(exposureSnapshot?.observedAt, nowMs);
      if (
        exposureSnapshot === null ||
        !Array.isArray(exposureSnapshot.positions) ||
        exposureSnapshot.accountId !== intent.accountId ||
        snapshotReport === null ||
        snapshotReport.state !== 'FRESH' ||
        exposureSnapshot.observedAt.completeness !== 'COMPLETE'
      ) {
        scope.minimum = null;
      } else {
        const symbols = [...new Set(scope.legs.map((leg) => leg.symbol))].sort();
        for (const symbol of symbols) {
          const positionMatches = exposureSnapshot.positions.filter(
            (row) =>
              typeof row === 'object' &&
              row !== null &&
              row.symbol === symbol &&
              row.positionBucket === scope.bucket,
          );
          if (positionMatches.length > 1 || (positionMatches.length === 1 && !isFiniteNumber(positionMatches[0].signedBaseQty))) {
            scope.minimum = null;
            break;
          }
          const before = exactDecimal(positionMatches[0]?.signedBaseQty ?? 0) as ExactDecimal;
          let action = zero;
          let reference = 0;
          for (const leg of scope.legs.filter((candidate) => candidate.symbol === symbol)) {
            const quantity = exactDecimal(leg.intendedQty) as ExactDecimal;
            action = exactAdd(action, leg.side === 'BUY' ? quantity : exactNegate(quantity));
            const evidence = findLegEvidence(market, leg);
            if (evidence === null || !isFiniteNumber(evidence.referencePrice) || evidence.referencePrice <= 0) {
              scope.minimum = null;
              break;
            }
            reference = Math.max(reference, leg.intendedPrice, evidence.referencePrice);
          }
          if (scope.minimum === null) break;
          const after = exactAdd(before, action);
          const growth = exactAdd(exactAbs(after), exactNegate(exactAbs(before)));
          if (growth.coefficient > 0n) {
            minimum = exactAdd(minimum, exactMultiply(growth, exactDecimal(reference) as ExactDecimal));
          }
        }
      }
    }
    if (scope.minimum !== null) scope.minimum = minimum;
  }

  let latestTs = marketTs;
  const observedParts: string[] = [];
  const neededParts: string[] = [];
  const rows = Array.isArray(account?.marginHeadrooms) ? account.marginHeadrooms : null;
  const factor = exactAdd(
    exactDecimal(100) as ExactDecimal,
    exactDecimal(policy.marginHeadroomBufferPct) as ExactDecimal,
  );
  for (const scope of [...scopes.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (scope.minimum === null) {
      return makeCheck('MARGIN_HEADROOM', 'UNKNOWN', blocking, `Minimum margin for ${scope.key} cannot be derived from complete bucket-bound evidence.`, null, scope.key, latestTs);
    }
    if (exactCompare(scope.declared, scope.minimum) < 0) {
      return makeCheck('MARGIN_HEADROOM', 'FAIL', blocking, `Declared margin for ${scope.key} is below its conservative requirement.`, exactDisplay(scope.declared), exactDisplay(scope.minimum), latestTs);
    }
    const effective = exactCompare(scope.declared, scope.minimum) >= 0 ? scope.declared : scope.minimum;
    const neededProduct = exactMultiply(effective, factor);
    const needed: ExactDecimal = {
      coefficient: neededProduct.coefficient,
      scale: neededProduct.scale + 2,
    };
    neededParts.push(`${scope.key}=${exactDisplay(needed)}`);
    if (needed.coefficient === 0n) continue;
    if (rows === null) {
      return makeCheck('MARGIN_HEADROOM', 'UNKNOWN', blocking, `No margin-headroom rows were supplied for ${scope.key}.`, null, exactDisplay(needed), latestTs);
    }
    const matches = rows.filter(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        row.positionBucket === scope.bucket &&
        row.scopeSymbol === scope.scopeSymbol,
    );
    if (matches.length !== 1) {
      return makeCheck('MARGIN_HEADROOM', 'UNKNOWN', blocking, `Exactly one margin-headroom row is required for ${scope.key}.`, null, exactDisplay(needed), latestTs);
    }
    const row = matches[0];
    const report = safeFreshness(row.observedAt, nowMs);
    const ts = safeBasisTime(row.observedAt);
    if (ts !== null) latestTs = latestTs === null ? ts : Math.max(latestTs, ts);
    if (row.accountId !== intent.accountId) {
      return makeCheck('MARGIN_HEADROOM', 'FAIL', blocking, `Margin row for ${scope.key} belongs to a different account.`, safeText(row.accountId, 300), intent.accountId, latestTs);
    }
    if (
      report === null ||
      report.state !== 'FRESH' ||
      row.observedAt.completeness !== 'COMPLETE'
    ) {
      return makeCheck('MARGIN_HEADROOM', 'UNKNOWN', blocking, `Margin row for ${scope.key} is stale, incomplete, or malformed.`, null, exactDisplay(needed), latestTs);
    }
    if (!['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(row.observedAt.authority)) {
      return makeCheck('MARGIN_HEADROOM', 'FAIL', blocking, `Margin row for ${scope.key} lacks private-account authority.`, row.observedAt.authority, 'PRIVATE', latestTs);
    }
    if (row.availableMarginUsd === null || !isFiniteNonNegative(row.availableMarginUsd)) {
      return makeCheck('MARGIN_HEADROOM', 'UNKNOWN', blocking, `Available margin for ${scope.key} is unknown.`, null, exactDisplay(needed), latestTs);
    }
    const available = exactDecimal(row.availableMarginUsd) as ExactDecimal;
    observedParts.push(`${scope.key}=${exactDisplay(available)}`);
    if (exactCompare(available, needed) < 0) {
      return makeCheck('MARGIN_HEADROOM', 'FAIL', blocking, `Available margin for ${scope.key} is below its exact buffered requirement.`, row.availableMarginUsd, exactDisplay(needed), latestTs);
    }
  }
  return makeCheck(
    'MARGIN_HEADROOM',
    'PASS',
    blocking,
    scopes.size === 0 ? 'Intent has no leveraged bucket.' : 'Every non-fungible margin bucket has exact required headroom.',
    observedParts.length === 0 ? 'NO_ADDITIONAL_MARGIN' : observedParts.join(','),
    neededParts.length === 0 ? '0' : neededParts.join(','),
    latestTs,
  );
}

// ---------- 23. liquidation distance ----------

export function checkLiquidationDistance(
  intent: PlanIntent,
  market: MarketEvidence | null,
  account: AccountEvidence | null,
  policy: RiskPolicy,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('LIQUIDATION_DISTANCE', riskClass);
  const perpLegs = intent.legs.filter((leg) => leg.venue === 'BINANCE_USDM');
  if (perpLegs.length === 0) {
    return makeCheck('LIQUIDATION_DISTANCE', 'PASS', blocking, 'Intent has no USD-M perp leg: liquidation distance is not applicable.', 'NO_PERP_LEG', policy.minLiquidationDistancePct, null);
  }
  const rows = Array.isArray(account?.liquidations) ? account.liquidations : null;
  if (rows === null) {
    return makeCheck('LIQUIDATION_DISTANCE', 'UNKNOWN', blocking, 'No projected liquidation evidence was supplied for the perp exposure.', null, policy.minLiquidationDistancePct, null);
  }
  const distances: { legKey: string; distancePct: number; ts: number | null }[] = [];
  for (const leg of perpLegs) {
    let projectedSide: 'BUY' | 'SELL' | 'FLAT' = leg.side;
    const intendedQuantity = exactDecimal(leg.intendedQty) as ExactDecimal;
    let expectedProjectedBaseQty = leg.side === 'BUY' ? intendedQuantity : exactNegate(intendedQuantity);
    if (riskClass === 'RISK_REDUCING') {
      const positions = Array.isArray(account?.exposures?.positions)
        ? account.exposures.positions
        : [];
      const matches = positions.filter(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          row.venue === leg.venue &&
          row.symbol === leg.symbol &&
          row.positionBucket === leg.positionBucket,
      );
      if (matches.length > 1 || (matches.length === 1 && !isFiniteNumber(matches[0].signedBaseQty))) {
        return makeCheck('LIQUIDATION_DISTANCE', 'UNKNOWN', blocking, `Projected USD-M quantity for ${leg.legKey} cannot be derived from unique bucket-bound exposure.`, null, policy.minLiquidationDistancePct, null);
      }
      const before = exactDecimal(matches[0]?.signedBaseQty ?? 0) as ExactDecimal;
      let action: ExactDecimal = { coefficient: 0n, scale: 0 };
      for (const candidate of intent.legs.filter(
        (row) =>
          row.venue === leg.venue &&
          row.symbol === leg.symbol &&
          row.positionBucket === leg.positionBucket,
      )) {
        const quantity = exactDecimal(candidate.intendedQty) as ExactDecimal;
        action = exactAdd(action, candidate.side === 'BUY' ? quantity : exactNegate(quantity));
      }
      expectedProjectedBaseQty = exactAdd(before, action);
      projectedSide = expectedProjectedBaseQty.coefficient === 0n ? 'FLAT' : expectedProjectedBaseQty.coefficient > 0n ? 'BUY' : 'SELL';
      if (projectedSide === 'FLAT') continue;
    }
    const matches = rows.filter(
      (row) => typeof row === 'object' && row !== null && row.legKey === leg.legKey,
    );
    if (matches.length !== 1) {
      return makeCheck('LIQUIDATION_DISTANCE', 'UNKNOWN', blocking, `Exactly one liquidation projection is required for perp leg ${leg.legKey}.`, null, policy.minLiquidationDistancePct, null);
    }
    const liq = matches[0];
    const report = safeFreshness(liq.observedAt, nowMs);
    const ts = safeBasisTime(liq.observedAt);
    if (
      liq.accountId !== intent.accountId ||
      liq.venue !== leg.venue ||
      liq.symbol !== leg.symbol ||
      liq.intentDigest !== deriveRiskIntentDigest(intent) ||
      !isFiniteNumber(liq.projectedSignedBaseQty) ||
      exactCompare(
        exactDecimal(liq.projectedSignedBaseQty) as ExactDecimal,
        expectedProjectedBaseQty,
      ) !== 0
    ) {
      return makeCheck('LIQUIDATION_DISTANCE', 'FAIL', blocking, `Liquidation projection for ${leg.legKey} is not bound to this account, instrument, intent, and projected quantity.`, safeText(liq.intentDigest, 300), deriveRiskIntentDigest(intent), ts);
    }
    if (
      report === null ||
      report.state !== 'FRESH' ||
      liq.observedAt.completeness !== 'COMPLETE'
    ) {
      return makeCheck('LIQUIDATION_DISTANCE', 'UNKNOWN', blocking, `Liquidation evidence for ${leg.legKey} is ${report === null ? 'malformed' : report.state}.`, null, policy.minLiquidationDistancePct, ts);
    }
    if (
      !isFiniteNumber(liq.markPrice) ||
      liq.markPrice <= 0 ||
      liq.liquidationPrice === null ||
      !isFiniteNumber(liq.liquidationPrice) ||
      liq.liquidationPrice <= 0
    ) {
      return makeCheck('LIQUIDATION_DISTANCE', 'UNKNOWN', blocking, `Liquidation values for ${leg.legKey} are missing or malformed; zero is not treated as infinite safety.`, null, policy.minLiquidationDistancePct, ts);
    }
    const marketRow = findLegEvidence(market, leg);
    if (
      marketRow === null ||
      !isFiniteNumber(marketRow.referencePrice) ||
      marketRow.referencePrice <= 0
    ) {
      return makeCheck('LIQUIDATION_DISTANCE', 'UNKNOWN', blocking, `Liquidation projection for ${leg.legKey} has no bound market reference.`, null, policy.maxLiquidationReferenceDriftPct, ts);
    }
    const markDriftPct =
      (Math.abs(liq.markPrice - marketRow.referencePrice) / marketRow.referencePrice) * 100;
    if (markDriftPct > policy.maxLiquidationReferenceDriftPct) {
      return makeCheck(
        'LIQUIDATION_DISTANCE',
        'FAIL',
        blocking,
        `Liquidation mark for ${leg.legKey} diverges ${displayNumber(markDriftPct)}% from its fresh market reference.`,
        markDriftPct,
        policy.maxLiquidationReferenceDriftPct,
        ts,
      );
    }
    const directionValid =
      (projectedSide === 'BUY' && liq.liquidationPrice < liq.markPrice) ||
      (projectedSide === 'SELL' && liq.liquidationPrice > liq.markPrice);
    if (!directionValid) {
      return makeCheck(
        'LIQUIDATION_DISTANCE',
        'FAIL',
        blocking,
        `Liquidation price direction contradicts projected ${projectedSide === 'BUY' ? 'long' : 'short'} exposure for ${leg.legKey}.`,
        `${liq.markPrice}->${liq.liquidationPrice}`,
        projectedSide === 'BUY' ? 'LIQUIDATION_BELOW_MARK' : 'LIQUIDATION_ABOVE_MARK',
        ts,
      );
    }
    distances.push({
      legKey: leg.legKey,
      distancePct: (Math.abs(liq.markPrice - liq.liquidationPrice) / liq.markPrice) * 100,
      ts,
    });
  }
  if (distances.length === 0) {
    return makeCheck('LIQUIDATION_DISTANCE', 'PASS', blocking, 'Risk-reducing action leaves no projected USD-M exposure.', 'POST_ACTION_FLAT', policy.minLiquidationDistancePct, null);
  }
  const worst = distances.reduce((a, b) => (b.distancePct < a.distancePct ? b : a));
  if (worst.distancePct < policy.minLiquidationDistancePct) {
    return makeCheck(
      'LIQUIDATION_DISTANCE',
      'FAIL',
      blocking,
      `Projected liquidation for ${worst.legKey} is only ${displayNumber(worst.distancePct)}% from mark.`,
      worst.distancePct,
      policy.minLiquidationDistancePct,
      worst.ts,
    );
  }
  return makeCheck('LIQUIDATION_DISTANCE', 'PASS', blocking, `Every projected liquidation distance meets policy (worst ${worst.legKey} = ${displayNumber(worst.distancePct)}%).`, worst.distancePct, policy.minLiquidationDistancePct, worst.ts);
}

// ---------- 24-27. borrow ----------

export function checkBorrow(
  intent: PlanIntent,
  market: MarketEvidence | null,
  account: AccountEvidence | null,
  borrow: BorrowEvidence | null,
  policy: RiskPolicy,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const bAvail = isBlockingFamily('BORROW_AVAILABILITY', riskClass);
  const bAmount = isBlockingFamily('BORROW_AMOUNT', riskClass);
  const bRate = isBlockingFamily('BORROW_RATE', riskClass);
  const bFresh = isBlockingFamily('BORROW_FRESHNESS', riskClass);
  const required = intent.requiredBorrowUsd;
  const marginSells = intent.legs.filter(
    (leg) => leg.requiredPermission === 'MARGIN' && leg.side === 'SELL',
  );
  const zero: ExactDecimal = { coefficient: 0n, scale: 0 };
  let derivedBorrowRequired: ExactDecimal | null = zero;
  const sellScopes = [...new Map(
    marginSells.map((leg) => [`${leg.positionBucket}:${leg.symbol}`, {
      symbol: leg.symbol,
      positionBucket: leg.positionBucket,
      venue: leg.venue,
    }] as const),
  ).values()];
  for (const scope of sellScopes) {
    const scopeLegs = intent.legs.filter(
      (leg) =>
        leg.requiredPermission === 'MARGIN' &&
        leg.symbol === scope.symbol &&
        leg.positionBucket === scope.positionBucket,
    );
    let action = zero;
    let reference = 0;
    for (const leg of scopeLegs) {
      const marketRow = findLegEvidence(market, leg);
      if (marketRow === null || !isFiniteNumber(marketRow.referencePrice) || marketRow.referencePrice <= 0) {
        derivedBorrowRequired = null;
        break;
      }
      const quantity = exactDecimal(leg.intendedQty) as ExactDecimal;
      action = exactAdd(action, leg.side === 'BUY' ? quantity : exactNegate(quantity));
      reference = Math.max(reference, leg.intendedPrice, marketRow.referencePrice);
    }
    if (derivedBorrowRequired === null) break;
    let before = zero;
    if (riskClass === 'RISK_REDUCING') {
      const positions = Array.isArray(account?.exposures?.positions)
        ? account.exposures.positions
        : null;
      if (positions === null) {
        derivedBorrowRequired = null;
        break;
      }
      const matches = positions.filter(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          row.venue === scope.venue &&
          row.symbol === scope.symbol &&
          row.positionBucket === scope.positionBucket,
      );
      if (matches.length > 1 || (matches.length === 1 && !isFiniteNumber(matches[0].signedBaseQty))) {
        derivedBorrowRequired = null;
        break;
      }
      before = exactDecimal(matches[0]?.signedBaseQty ?? 0) as ExactDecimal;
    }
    const after = exactAdd(before, action);
    const shortBefore = before.coefficient < 0n ? exactAbs(before) : zero;
    const shortAfter = after.coefficient < 0n ? exactAbs(after) : zero;
    const additionalShort = exactAdd(shortAfter, exactNegate(shortBefore));
    if (additionalShort.coefficient > 0n) {
      derivedBorrowRequired = exactAdd(
        derivedBorrowRequired,
        exactMultiply(additionalShort, exactDecimal(reference) as ExactDecimal),
      );
    }
  }
  const impliedBorrowRequired =
    marginSells.length > 0 &&
    (derivedBorrowRequired === null || derivedBorrowRequired.coefficient > 0n);

  if (required === 0) {
    if (impliedBorrowRequired) {
      const detail =
        derivedBorrowRequired === null
          ? 'A risk-increasing MARGIN SELL has no usable reference price; borrow requirement is unknown.'
          : 'A risk-increasing MARGIN SELL cannot declare borrow below its conservative fresh-reference notional.';
      return [
        makeCheck('BORROW_AVAILABILITY', 'UNKNOWN', bAvail, detail, null, 'AVAILABLE', null),
        makeCheck('BORROW_AMOUNT', derivedBorrowRequired === null ? 'UNKNOWN' : 'FAIL', bAmount, detail, 0, derivedBorrowRequired === null ? null : exactDisplay(derivedBorrowRequired), null),
        makeCheck('BORROW_RATE', 'UNKNOWN', bRate, detail, null, policy.maxBorrowHourlyRatePct, null),
        makeCheck('BORROW_FRESHNESS', 'UNKNOWN', bFresh, detail, null, 'FRESH', null),
      ];
    }
    const detail = 'Intent requires no borrow (known zero); borrow gates are satisfied.';
    return [
      makeCheck('BORROW_AVAILABILITY', 'PASS', bAvail, detail, 'NOT_REQUIRED', null, null),
      makeCheck('BORROW_AMOUNT', 'PASS', bAmount, detail, 0, null, null),
      makeCheck('BORROW_RATE', 'PASS', bRate, detail, 'NOT_REQUIRED', policy.maxBorrowHourlyRatePct, null),
      makeCheck('BORROW_FRESHNESS', 'PASS', bFresh, detail, 'NOT_REQUIRED', null, null),
    ];
  }

  const amountUnknownDetail =
    required === null
      ? 'Intent does not declare its borrow requirement (null is unknown, not zero).'
      : null;

  if (borrow === null || typeof borrow !== 'object') {
    const detail = 'No borrow evidence was supplied.';
    return [
      makeCheck('BORROW_AVAILABILITY', 'UNKNOWN', bAvail, detail, null, 'AVAILABLE', null),
      makeCheck('BORROW_AMOUNT', 'UNKNOWN', bAmount, amountUnknownDetail ?? detail, null, required, null),
      makeCheck('BORROW_RATE', 'UNKNOWN', bRate, detail, null, policy.maxBorrowHourlyRatePct, null),
      makeCheck('BORROW_FRESHNESS', 'UNKNOWN', bFresh, detail, null, 'FRESH', null),
    ];
  }

  const borrowScopes = [...new Map(
    intent.legs
      .filter((leg) => leg.requiredPermission === 'MARGIN' && leg.side === 'SELL')
      .map((leg) => [`${leg.positionBucket}:${leg.symbol}`, {
        symbol: leg.symbol,
        positionBucket: leg.positionBucket,
      }] as const),
  ).values()];
  const expectedBorrow = borrowScopes[0] ?? null;
  if (
    borrowScopes.length !== 1 ||
    typeof borrow.accountId !== 'string' ||
    borrow.accountId !== intent.accountId ||
    typeof borrow.symbol !== 'string' ||
    borrow.symbol !== expectedBorrow?.symbol ||
    borrow.positionBucket !== expectedBorrow?.positionBucket
  ) {
    const detail =
      borrowScopes.length !== 1
        ? 'One borrow snapshot cannot cover zero or multiple asset/bucket scopes.'
        : borrow.accountId !== intent.accountId
          ? `Borrow evidence belongs to account ${safeText(borrow.accountId)}, not ${intent.accountId}.`
        : `Borrow evidence is for ${safeText(borrow.positionBucket)}/${safeText(borrow.symbol)}, not ${expectedBorrow?.positionBucket}/${expectedBorrow?.symbol}.`;
    return [
      makeCheck('BORROW_AVAILABILITY', 'FAIL', bAvail, detail, `${safeText(borrow.positionBucket)}/${safeText(borrow.symbol)}`, borrowScopes.map((scope) => `${scope.positionBucket}/${scope.symbol}`).join(','), null),
      makeCheck('BORROW_AMOUNT', 'UNKNOWN', bAmount, detail, null, required, null),
      makeCheck('BORROW_RATE', 'UNKNOWN', bRate, detail, null, policy.maxBorrowHourlyRatePct, null),
      makeCheck('BORROW_FRESHNESS', 'UNKNOWN', bFresh, detail, null, 'FRESH', null),
    ];
  }

  const report = safeFreshness(borrow.observedAt, nowMs);
  const ts = safeBasisTime(borrow.observedAt);

  let availability: Readonly<RiskCheck>;
  switch (borrow.state) {
    case 'AVAILABLE':
      availability = makeCheck('BORROW_AVAILABILITY', 'PASS', bAvail, 'Borrow source reports AVAILABLE.', borrow.state, 'AVAILABLE', ts);
      break;
    case 'UNKNOWN':
    case 'STALE':
      availability = makeCheck('BORROW_AVAILABILITY', 'UNKNOWN', bAvail, `Borrow source reports ${borrow.state}; availability cannot be established.`, borrow.state, 'AVAILABLE', ts);
      break;
    case 'UNAVAILABLE':
    case 'PERMISSION_MISSING':
    case 'ACCOUNT_MODE_MISMATCH':
    case 'RATE_LIMITED':
    case 'SOURCE_ERROR':
      availability = makeCheck('BORROW_AVAILABILITY', 'FAIL', bAvail, `Borrow source reports ${borrow.state}.`, borrow.state, 'AVAILABLE', ts);
      break;
    default:
      availability = makeCheck('BORROW_AVAILABILITY', 'UNKNOWN', bAvail, `Borrow source reports unrecognized state '${safeText(borrow.state)}'.`, safeText(borrow.state, 300), 'AVAILABLE', ts);
  }

  let amount: Readonly<RiskCheck>;
  if (amountUnknownDetail !== null) {
    amount = makeCheck('BORROW_AMOUNT', 'UNKNOWN', bAmount, amountUnknownDetail, null, borrow.maxBorrowableUsd, ts);
  } else if (impliedBorrowRequired && derivedBorrowRequired === null) {
    amount = makeCheck('BORROW_AMOUNT', 'UNKNOWN', bAmount, 'Borrow requirement cannot be derived without fresh reference prices.', required, null, ts);
  } else if (
    impliedBorrowRequired &&
    derivedBorrowRequired !== null &&
    exactCompare(
      exactDecimal(required as number) as ExactDecimal,
      derivedBorrowRequired,
    ) < 0
  ) {
    amount = makeCheck('BORROW_AMOUNT', 'FAIL', bAmount, 'Declared borrow is below the conservative MARGIN SELL notional.', required, exactDisplay(derivedBorrowRequired), ts);
  } else if (borrow.maxBorrowableUsd === null || !isFiniteNonNegative(borrow.maxBorrowableUsd)) {
    amount = makeCheck('BORROW_AMOUNT', 'UNKNOWN', bAmount, 'Borrowable amount is unknown.', null, required, ts);
  } else if (
    exactCompare(
      exactDecimal(required as number) as ExactDecimal,
      exactDecimal(borrow.maxBorrowableUsd) as ExactDecimal,
    ) > 0
  ) {
    amount = makeCheck('BORROW_AMOUNT', 'FAIL', bAmount, `Required borrow ${required} USD exceeds borrowable ${borrow.maxBorrowableUsd} USD.`, required, borrow.maxBorrowableUsd, ts);
  } else {
    amount = makeCheck('BORROW_AMOUNT', 'PASS', bAmount, `Required borrow ${required} USD is within borrowable ${borrow.maxBorrowableUsd} USD.`, required, borrow.maxBorrowableUsd, ts);
  }

  let rate: Readonly<RiskCheck>;
  if (borrow.hourlyRatePct === null || !isFiniteNonNegative(borrow.hourlyRatePct)) {
    rate = makeCheck('BORROW_RATE', 'UNKNOWN', bRate, 'Borrow hourly rate is unknown.', null, policy.maxBorrowHourlyRatePct, ts);
  } else if (
    exactCompare(
      exactDecimal(borrow.hourlyRatePct) as ExactDecimal,
      exactDecimal(policy.maxBorrowHourlyRatePct) as ExactDecimal,
    ) > 0
  ) {
    rate = makeCheck('BORROW_RATE', 'FAIL', bRate, `Borrow hourly rate ${borrow.hourlyRatePct}% exceeds the policy cap.`, borrow.hourlyRatePct, policy.maxBorrowHourlyRatePct, ts);
  } else {
    rate = makeCheck('BORROW_RATE', 'PASS', bRate, `Borrow hourly rate ${borrow.hourlyRatePct}% is within the policy cap.`, borrow.hourlyRatePct, policy.maxBorrowHourlyRatePct, ts);
  }

  let freshness: Readonly<RiskCheck>;
  if (report === null) {
    freshness = makeCheck('BORROW_FRESHNESS', 'UNKNOWN', bFresh, 'Borrow evidence timestamp is malformed.', null, 'FRESH', ts);
  } else {
    switch (report.state) {
      case 'FRESH':
        freshness =
          borrow.observedAt.completeness === 'COMPLETE'
            ? makeCheck('BORROW_FRESHNESS', 'PASS', bFresh, `Borrow evidence is fresh (age ${report.ageMs} ms).`, report.ageMs, borrow.observedAt.maxAgeMs, ts)
            : makeCheck('BORROW_FRESHNESS', 'UNKNOWN', bFresh, `Borrow evidence is ${borrow.observedAt.completeness}; availability cannot be treated as complete.`, borrow.observedAt.completeness, 'COMPLETE', ts);
        break;
      case 'STALE':
        freshness = makeCheck('BORROW_FRESHNESS', 'FAIL', bFresh, `Borrow evidence is stale (age ${report.ageMs} ms exceeds ${borrow.observedAt.maxAgeMs} ms).`, report.ageMs, borrow.observedAt.maxAgeMs, ts);
        break;
      case 'CLOCK_SKEWED':
        freshness = makeCheck('BORROW_FRESHNESS', 'FAIL', bFresh, `Borrow evidence is from the future (age ${report.ageMs} ms): clock skew.`, report.ageMs, borrow.observedAt.maxAgeMs, ts);
        break;
      case 'UNAVAILABLE':
        freshness = makeCheck('BORROW_FRESHNESS', 'UNKNOWN', bFresh, 'Borrow evidence is marked unavailable.', 'UNAVAILABLE', 'FRESH', ts);
        break;
    }
  }

  return [availability, amount, rate, freshness];
}

// ---------- 28-29. daily loss / daily notional ----------

export function checkDailyLimits(
  intent: PlanIntent,
  market: MarketEvidence | null,
  account: AccountEvidence | null,
  policy: RiskPolicy,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck>[] {
  const bLoss = isBlockingFamily('DAILY_LOSS_LIMIT', riskClass);
  const bNotional = isBlockingFamily('DAILY_NOTIONAL_LIMIT', riskClass);
  const report = account === null ? null : safeFreshness(account.dailyStatsObservedAt, nowMs);
  const ts = account === null ? null : safeBasisTime(account.dailyStatsObservedAt);
  const utcDayMs = 86_400_000;
  const expectedPeriodStart = Math.floor(nowMs / utcDayMs) * utcDayMs;
  const expectedPeriodEnd = expectedPeriodStart + utcDayMs;
  const periodValid =
    isValidUtcMillis(account?.dailyPeriodStartMs) &&
    isValidUtcMillis(account?.dailyPeriodEndMs) &&
    account?.dailyPeriodStartMs === expectedPeriodStart &&
    account?.dailyPeriodEndMs === expectedPeriodEnd &&
    ts !== null &&
    ts >= expectedPeriodStart &&
    ts <= nowMs;
  const fresh =
    report !== null &&
    report.state === 'FRESH' &&
    account?.dailyStatsObservedAt?.completeness === 'COMPLETE' &&
    account?.accountId === intent.accountId &&
    periodValid;
  const staleDetail =
    account === null
      ? 'No account evidence was supplied.'
      : report === null
        ? 'Daily statistics have no valid timestamp.'
        : !periodValid
          ? 'Daily statistics are not bound to the canonical current UTC day.'
          : `Daily statistics are ${report.state}.`;

  let loss: Readonly<RiskCheck>;
  const dailyLoss = account?.dailyRealizedLossUsd ?? null;
  if (dailyLoss === null || !isFiniteNumber(dailyLoss) || !fresh) {
    loss = makeCheck('DAILY_LOSS_LIMIT', 'UNKNOWN', bLoss, `${staleDetail} Realized daily loss cannot be verified.`, isFiniteNumber(dailyLoss) ? dailyLoss : null, policy.maxDailyLossUsd, ts);
  } else if (dailyLoss >= policy.maxDailyLossUsd) {
    loss = makeCheck('DAILY_LOSS_LIMIT', 'FAIL', bLoss, `Realized daily loss ${dailyLoss} USD has reached the policy cap.`, dailyLoss, policy.maxDailyLossUsd, ts);
  } else {
    loss = makeCheck('DAILY_LOSS_LIMIT', 'PASS', bLoss, `Realized daily loss ${dailyLoss} USD is below the policy cap.`, dailyLoss, policy.maxDailyLossUsd, ts);
  }

  let notional: Readonly<RiskCheck>;
  const dailyNotional = account?.dailyTradedNotionalUsd ?? null;
  let gross: ExactDecimal | null = { coefficient: 0n, scale: 0 };
  for (const leg of intent.legs) {
    const evidence = findLegEvidence(market, leg);
    if (evidence === null || !isFiniteNumber(evidence.referencePrice) || evidence.referencePrice <= 0) {
      gross = null;
      break;
    }
    const notional = exactProduct(
      Math.max(leg.intendedPrice, evidence.referencePrice),
      leg.intendedQty,
    );
    if (notional === null) {
      gross = null;
      break;
    }
    gross = exactAdd(gross, notional);
  }
  if (dailyNotional === null || !isFiniteNonNegative(dailyNotional) || !fresh || gross === null) {
    notional = makeCheck('DAILY_NOTIONAL_LIMIT', 'UNKNOWN', bNotional, `${staleDetail} Daily traded notional cannot be verified.`, isFiniteNumber(dailyNotional) ? dailyNotional : null, policy.maxDailyNotionalUsd, ts);
  } else {
    const projected = exactAdd(exactDecimal(dailyNotional) as ExactDecimal, gross);
    const cap = exactDecimal(policy.maxDailyNotionalUsd) as ExactDecimal;
    if (exactCompare(projected, cap) > 0) {
      notional = makeCheck('DAILY_NOTIONAL_LIMIT', 'FAIL', bNotional, `Projected daily notional ${exactDisplay(projected)} USD (current ${dailyNotional} + intent ${exactDisplay(gross)}) exceeds the policy cap.`, exactDisplay(projected), policy.maxDailyNotionalUsd, ts);
    } else {
      notional = makeCheck('DAILY_NOTIONAL_LIMIT', 'PASS', bNotional, `Projected daily notional ${exactDisplay(projected)} USD is within the policy cap.`, exactDisplay(projected), policy.maxDailyNotionalUsd, ts);
    }
  }
  return [loss, notional];
}

// ---------- 30. duplicate active plan ----------

export function checkDuplicatePlan(
  intent: PlanIntent,
  existingPlans: ExistingPlansEvidence | null,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('DUPLICATE_ACTIVE_PLAN', riskClass);
  if (existingPlans === null || typeof existingPlans !== 'object' || !Array.isArray(existingPlans.plans)) {
    return makeCheck('DUPLICATE_ACTIVE_PLAN', 'UNKNOWN', blocking, 'The set of existing plans is unknown; duplication cannot be ruled out.', null, 'NO_ACTIVE_OVERLAP', null);
  }
  const report = safeFreshness(existingPlans.observedAt, nowMs);
  const ts = safeBasisTime(existingPlans.observedAt);
  if (existingPlans.accountId !== intent.accountId) {
    return makeCheck('DUPLICATE_ACTIVE_PLAN', 'FAIL', blocking, 'Plan registry belongs to a different account.', safeText(existingPlans.accountId, 300), intent.accountId, ts);
  }
  if (
    report === null ||
    report.state !== 'FRESH' ||
    existingPlans.observedAt.completeness !== 'COMPLETE'
  ) {
    return makeCheck(
      'DUPLICATE_ACTIVE_PLAN',
      'UNKNOWN',
      blocking,
      `Plan-registry evidence is ${report === null ? 'malformed' : report.state} / ${safeText(existingPlans.observedAt?.completeness)}.`,
      report?.state ?? null,
      'FRESH_COMPLETE',
      ts,
    );
  }
  const intentSymbols = new Set(intent.legs.map((l) => l.symbol));
  const duplicates: string[] = [];
  const seenPlanIds = new Set<string>();
  for (const plan of existingPlans.plans) {
    if (
      typeof plan !== 'object' ||
      plan === null ||
      typeof plan.planId !== 'string' ||
      plan.planId.trim().length === 0 ||
      plan.planId.length > 128 ||
      !Array.isArray(plan.symbols) ||
      plan.symbols.length === 0 ||
      plan.symbols.some((symbol: unknown) => typeof symbol !== 'string' || symbol.trim().length === 0) ||
      !isPlanLifecycle(plan.lifecycle)
    ) {
      return makeCheck(
        'DUPLICATE_ACTIVE_PLAN',
        'UNKNOWN',
        blocking,
        'Plan-registry evidence contains a malformed plan summary; duplication cannot be ruled out.',
        null,
        'NO_ACTIVE_OVERLAP',
        ts,
      );
    }
    if (seenPlanIds.has(plan.planId)) {
      return makeCheck('DUPLICATE_ACTIVE_PLAN', 'UNKNOWN', blocking, `Plan registry repeats plan ID ${safeText(plan.planId)}.`, plan.planId, 'UNIQUE_PLAN_IDS', ts);
    }
    seenPlanIds.add(plan.planId);
    if (isTerminalPlanLifecycle(plan.lifecycle)) continue;
    if (plan.planId === intent.planId) {
      duplicates.push(plan.planId);
      continue;
    }
    const overlaps = plan.symbols.some((symbol: string) => intentSymbols.has(symbol));
    if (overlaps) duplicates.push(plan.planId);
  }
  duplicates.sort();
  if (duplicates.length > 0) {
    return makeCheck(
      'DUPLICATE_ACTIVE_PLAN',
      'FAIL',
      blocking,
      `Active plan(s) already cover the intent's symbols: ${duplicates.join(', ')}.`,
      duplicates.join(','),
      'NO_ACTIVE_OVERLAP',
      ts,
    );
  }
  return makeCheck('DUPLICATE_ACTIVE_PLAN', 'PASS', blocking, 'No active plan overlaps the intent symbols.', 'NONE', 'NO_ACTIVE_OVERLAP', ts);
}

// ---------- 31. open-order limits ----------

export function checkOpenOrderLimit(
  intent: PlanIntent,
  account: AccountEvidence | null,
  policy: RiskPolicy,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('OPEN_ORDER_LIMIT', riskClass);
  const orders = account?.openOrders ?? null;
  if (orders === null) {
    return makeCheck('OPEN_ORDER_LIMIT', 'UNKNOWN', blocking, 'Open-order counts are unknown.', null, policy.maxTotalOpenOrders, null);
  }
  const report = safeFreshness(orders.observedAt, nowMs);
  const ts = safeBasisTime(orders.observedAt);
  if (report === null || report.state !== 'FRESH') {
    return makeCheck('OPEN_ORDER_LIMIT', 'UNKNOWN', blocking, `Open-order evidence is ${report === null ? 'malformed' : report.state}.`, null, policy.maxTotalOpenOrders, ts);
  }
  if (orders.observedAt.completeness !== 'COMPLETE') {
    return makeCheck('OPEN_ORDER_LIMIT', 'UNKNOWN', blocking, `Open-order snapshot is ${orders.observedAt.completeness}; a missing symbol cannot be assumed zero.`, null, policy.maxTotalOpenOrders, ts);
  }
  if (
    !Number.isSafeInteger(orders.total) ||
    orders.total < 0 ||
    !isPlainRecord(orders.perSymbol)
  ) {
    return makeCheck('OPEN_ORDER_LIMIT', 'UNKNOWN', blocking, 'Open-order counts are malformed.', null, policy.maxTotalOpenOrders, ts);
  }
  const allCounts = Object.entries(orders.perSymbol);
  if (
    allCounts.some(([, count]) => !Number.isSafeInteger(count) || (count as number) < 0) ||
    allCounts.reduce((sum, [, count]) => sum + (count as number), 0) !== orders.total
  ) {
    return makeCheck(
      'OPEN_ORDER_LIMIT',
      'UNKNOWN',
      blocking,
      'Open-order per-symbol counts are malformed or do not reconcile to the total.',
      null,
      orders.total,
      ts,
    );
  }
  const preexistingSymbolBreach = allCounts
    .filter(([, count]) => (count as number) > policy.maxOpenOrdersPerSymbol)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))[0];
  if (preexistingSymbolBreach) {
    return makeCheck(
      'OPEN_ORDER_LIMIT',
      'FAIL',
      blocking,
      `Existing open orders for ${preexistingSymbolBreach[0]} already exceed the per-symbol cap.`,
      preexistingSymbolBreach[1] as number,
      policy.maxOpenOrdersPerSymbol,
      ts,
    );
  }
  const projectedTotal = orders.total + intent.legs.length;
  if (projectedTotal > policy.maxTotalOpenOrders) {
    return makeCheck('OPEN_ORDER_LIMIT', 'FAIL', blocking, `Projected total open orders ${projectedTotal} (current ${orders.total} + ${intent.legs.length} legs) exceeds the account cap.`, projectedTotal, policy.maxTotalOpenOrders, ts);
  }
  const legsPerSymbol = new Map<string, number>();
  for (const leg of intent.legs) {
    legsPerSymbol.set(leg.symbol, (legsPerSymbol.get(leg.symbol) ?? 0) + 1);
  }
  for (const [symbol, added] of [...legsPerSymbol.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const current = orders.perSymbol[symbol];
    const known = current === undefined ? 0 : current;
    const projected = known + added;
    if (projected > policy.maxOpenOrdersPerSymbol) {
      return makeCheck('OPEN_ORDER_LIMIT', 'FAIL', blocking, `Projected open orders for ${symbol} = ${projected} (current ${known} + ${added} legs) exceeds the per-symbol cap.`, projected, policy.maxOpenOrdersPerSymbol, ts);
    }
  }
  return makeCheck('OPEN_ORDER_LIMIT', 'PASS', blocking, `Projected total open orders ${projectedTotal} and all per-symbol counts are within caps.`, projectedTotal, policy.maxTotalOpenOrders, ts);
}

// ---------- 32. cooldown ----------

export function checkCooldown(
  intent: PlanIntent,
  cooldown: CooldownEvidence | null,
  policy: RiskPolicy,
  nowMs: number,
  riskClass: ActionRiskClass,
): Readonly<RiskCheck> {
  const blocking = isBlockingFamily('COOLDOWN', riskClass);
  if (cooldown === null || typeof cooldown !== 'object') {
    return makeCheck('COOLDOWN', 'UNKNOWN', blocking, 'Cooldown state is unknown; a quiet period cannot be confirmed.', null, policy.cooldownMs, null);
  }
  const report = safeFreshness(cooldown.observedAt, nowMs);
  const ts = safeBasisTime(cooldown.observedAt);
  const expectedSymbols = [...new Set(intent.legs.map((leg) => leg.symbol))].sort();
  const symbolsWellFormed =
    Array.isArray(cooldown.symbols) &&
    cooldown.symbols.length > 0 &&
    cooldown.symbols.every((symbol) => typeof symbol === 'string' && symbol.trim().length > 0) &&
    new Set(cooldown.symbols).size === cooldown.symbols.length;
  if (!symbolsWellFormed) {
    return makeCheck('COOLDOWN', 'UNKNOWN', blocking, 'Cooldown symbol scope is malformed or duplicated.', null, expectedSymbols.join(','), ts);
  }
  const observedSymbols = [...cooldown.symbols].sort();
  if (
    cooldown.accountId !== intent.accountId ||
    observedSymbols.length !== expectedSymbols.length ||
    observedSymbols.some((symbol, index) => symbol !== expectedSymbols[index])
  ) {
    return makeCheck('COOLDOWN', 'FAIL', blocking, 'Cooldown evidence is scoped to a different account or symbol set.', observedSymbols.join(','), expectedSymbols.join(','), ts);
  }
  if (
    report === null ||
    report.state !== 'FRESH' ||
    cooldown.observedAt.completeness !== 'COMPLETE'
  ) {
    return makeCheck(
      'COOLDOWN',
      report?.state === 'STALE' || report?.state === 'CLOCK_SKEWED' ? 'FAIL' : 'UNKNOWN',
      blocking,
      `Cooldown evidence is ${report === null ? 'malformed' : report.state} / ${safeText(cooldown.observedAt?.completeness)}.`,
      report?.state ?? null,
      'FRESH_COMPLETE',
      ts,
    );
  }
  if (cooldown.lastEntryAtMs === null) {
    // KNOWN "no prior entry": distinct from unknown cooldown state.
    return makeCheck('COOLDOWN', 'PASS', blocking, 'No prior relevant entry exists (known); cooldown does not apply.', 'NO_PRIOR_ENTRY', policy.cooldownMs, ts);
  }
  if (!isValidUtcMillis(cooldown.lastEntryAtMs)) {
    return makeCheck('COOLDOWN', 'UNKNOWN', blocking, 'Last-entry time is malformed.', null, policy.cooldownMs, ts);
  }
  if ((ts !== null && cooldown.lastEntryAtMs > ts) || cooldown.lastEntryAtMs > nowMs) {
    return makeCheck('COOLDOWN', 'FAIL', blocking, 'Last-entry time is later than the cooldown snapshot/evaluation clock.', cooldown.lastEntryAtMs, nowMs, ts);
  }
  const elapsed = nowMs - cooldown.lastEntryAtMs;
  if (elapsed < policy.cooldownMs) {
    return makeCheck('COOLDOWN', 'FAIL', blocking, `Only ${elapsed} ms since the last relevant entry; policy requires ${policy.cooldownMs} ms.`, elapsed, policy.cooldownMs, ts);
  }
  return makeCheck('COOLDOWN', 'PASS', blocking, `${elapsed} ms since the last relevant entry satisfies the cooldown.`, elapsed, policy.cooldownMs, ts);
}
