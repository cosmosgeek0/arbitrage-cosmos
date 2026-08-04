export interface BasisCostBreakdown {
  feesPct: number;
  slippagePct: number;
  fundingDragPct: number;
  borrowCostPct: number;
  totalPct: number;
}

export interface BasisRow {
  symbol: string;
  base: string;
  state: 'IDLE' | 'WATCHING' | 'FOCUS' | 'PROPOSED' | 'REJECTED' | 'ACTIVE' | 'COOLDOWN';
  direction: 'long_spot_short_perp' | 'short_spot_long_perp';
  spotBid: number | null;
  spotAsk: number | null;
  perpBid: number | null;
  perpAsk: number | null;
  markPrice: number | null;
  spotSpreadBps: number | null;
  perpSpreadBps: number | null;
  quoteVolume24h: number | null;
  executableGapPct: number | null;
  alternateGapPct: number | null;
  gapAgeMs: number | null;
  persistTicks: number;
  gapSlopePctPerMin: number | null;
  gapStabilityCv: number | null;
  fundingRate: number | null;
  nextFundingTs: number | null;
  fundingCarryPct: number | null;
  fundingFlipRisk: number | null;
  expectedHoldMs: number;
  costs: BasisCostBreakdown;
  netEdgePct: number | null;
  depthScore: number | null;
  slippagePct: number;
  ladderBacked: boolean;
  bookPressure: number | null;
  dataQuality: {
    score: number;
    spotStalenessMs: number | null;
    perpStalenessMs: number | null;
    legSkewMs: number | null;
    markDivergenceBps: number | null;
    suspectReasons: string[];
  };
  borrow: {
    status: 'not_needed' | 'unknown' | 'available' | 'unavailable';
    ok: boolean;
    rejectCode: string | null;
    human: string;
    costPctOverHold: number;
  };
  decisionKind: 'ignore' | 'watch' | 'focus' | 'proposal' | 'reject';
  rejectCode: string | null;
  reason: string;
  correlationId: string | null;
  decisionTs: number | null;
  priority: { score: number } | null;
  proposal: {
    id: string;
    status: 'open' | 'updated';
    netEdgePct: number | null;
    confidence: number | null;
    invalidation: string | null;
    stagedSizes: { stage: number; fraction: number; notionalUsd: number }[];
  } | null;
}

export interface BasisSnapshot {
  updatedAt: number;
  status: {
    running: boolean;
    bookState: 'fresh' | 'stale';
    markState: 'fresh' | 'stale';
    universeSize: number;
    watching: number;
    focused: number;
    openProposals: number;
    rejected: number;
    borrowBlocked: number;
    verifiedBorrow: number;
    dataQualityPassing: number;
    lastBookTs: number | null;
    lastMarkTs: number | null;
    lastTickTs: number | null;
    ticks: number;
    lastError: string | null;
    bookSource: string;
    markSource: string;
    borrowSource: string;
  };
  thresholds: {
    watchGapPct: number;
    focusGapPct: number;
    minNetBasisPct: number;
    minQuoteVolume24hUsd?: number;
    feesPct: number;
    persistTicks: number;
    maxSpreadBps: number;
    minDepthScore: number;
    minDataQuality: number;
    intendedNotionalUsd: number;
  };
  rows: BasisRow[];
}

export const BASIS_RUNTIME_FRESH_MS = 10_000;
export const BASIS_MAX_FUTURE_SKEW_MS = 5_000;

type UnknownRecord = Record<string, unknown>;

const ROW_STATES = ['IDLE', 'WATCHING', 'FOCUS', 'PROPOSED', 'REJECTED', 'ACTIVE', 'COOLDOWN'] as const;
const DIRECTIONS = ['long_spot_short_perp', 'short_spot_long_perp'] as const;
const DECISIONS = ['ignore', 'watch', 'focus', 'proposal', 'reject'] as const;
const BORROW_STATES = ['not_needed', 'unknown', 'available', 'unavailable'] as const;
const ACTIVE_PROPOSAL_STATES = ['open', 'updated'] as const;

function plainRecord(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as UnknownRecord : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonnegativeNumber(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && !Object.is(value, -0);
}

function nullableNumber(value: unknown, validate = finiteNumber): value is number | null {
  return value === null || validate(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function nullableTimestamp(value: unknown): value is number | null {
  return value === null || nonnegativeInteger(value);
}

function boundedText(value: unknown, maximum = 2_048, allowEmpty = true): value is string {
  return typeof value === 'string'
    && value.length <= maximum
    && (allowEmpty || value.trim().length > 0);
}

function nullableText(value: unknown, maximum = 2_048): value is string | null {
  return value === null || boundedText(value, maximum);
}

function oneOf(value: unknown, choices: readonly string[]): value is string {
  return typeof value === 'string' && choices.includes(value);
}

function unitInterval(value: unknown): value is number {
  return nonnegativeNumber(value) && value <= 1;
}

function validCosts(value: unknown): value is BasisCostBreakdown {
  const costs = plainRecord(value);
  return costs !== null
    && nonnegativeNumber(costs.feesPct)
    && nonnegativeNumber(costs.slippagePct)
    && nonnegativeNumber(costs.fundingDragPct)
    && nonnegativeNumber(costs.borrowCostPct)
    && nonnegativeNumber(costs.totalPct);
}

function validBasisRow(value: unknown): value is BasisRow {
  const row = plainRecord(value);
  const dataQuality = plainRecord(row?.dataQuality);
  const borrow = plainRecord(row?.borrow);
  const priority = row?.priority === null ? null : plainRecord(row?.priority);
  const proposal = row?.proposal === null ? null : plainRecord(row?.proposal);
  if (
    row === null
    || dataQuality === null
    || borrow === null
    || (row.priority !== null && priority === null)
    || (row.proposal !== null && proposal === null)
  ) return false;

  if (
    !boundedText(row.symbol, 32, false)
    || !/^[A-Z0-9]{1,32}$/.test(row.symbol)
    || !boundedText(row.base, 24, false)
    || !/^[A-Z0-9]{1,24}$/.test(row.base)
    || !oneOf(row.state, ROW_STATES)
    || !oneOf(row.direction, DIRECTIONS)
    || !nullableNumber(row.spotBid, nonnegativeNumber)
    || !nullableNumber(row.spotAsk, nonnegativeNumber)
    || !nullableNumber(row.perpBid, nonnegativeNumber)
    || !nullableNumber(row.perpAsk, nonnegativeNumber)
    || !nullableNumber(row.markPrice, nonnegativeNumber)
    || !nullableNumber(row.spotSpreadBps, nonnegativeNumber)
    || !nullableNumber(row.perpSpreadBps, nonnegativeNumber)
    || !nullableNumber(row.quoteVolume24h, nonnegativeNumber)
    || !nullableNumber(row.executableGapPct)
    || !nullableNumber(row.alternateGapPct)
    || !nullableNumber(row.gapAgeMs, nonnegativeNumber)
    || !nonnegativeInteger(row.persistTicks)
    || !nullableNumber(row.gapSlopePctPerMin)
    || !nullableNumber(row.gapStabilityCv, nonnegativeNumber)
    || !nullableNumber(row.fundingRate)
    || !nullableTimestamp(row.nextFundingTs)
    || !nullableNumber(row.fundingCarryPct)
    || !(row.fundingFlipRisk === null || unitInterval(row.fundingFlipRisk))
    || !nonnegativeInteger(row.expectedHoldMs)
    || !validCosts(row.costs)
    || !nullableNumber(row.netEdgePct)
    || !(row.depthScore === null || unitInterval(row.depthScore))
    || !nonnegativeNumber(row.slippagePct)
    || typeof row.ladderBacked !== 'boolean'
    || !nullableNumber(row.bookPressure)
    || !oneOf(row.decisionKind, DECISIONS)
    || !nullableText(row.rejectCode, 160)
    || !boundedText(row.reason, 2_048, false)
    || !nullableText(row.correlationId, 256)
    || !nullableTimestamp(row.decisionTs)
  ) return false;

  if (
    !unitInterval(dataQuality.score)
    || !nullableNumber(dataQuality.spotStalenessMs, nonnegativeNumber)
    || !nullableNumber(dataQuality.perpStalenessMs, nonnegativeNumber)
    || !nullableNumber(dataQuality.legSkewMs, nonnegativeNumber)
    || !nullableNumber(dataQuality.markDivergenceBps, nonnegativeNumber)
    || !Array.isArray(dataQuality.suspectReasons)
    || dataQuality.suspectReasons.length > 64
    || !dataQuality.suspectReasons.every((reason) => boundedText(reason, 256, false))
  ) return false;

  if (
    !oneOf(borrow.status, BORROW_STATES)
    || typeof borrow.ok !== 'boolean'
    || !nullableText(borrow.rejectCode, 160)
    || !boundedText(borrow.human, 2_048, false)
    || !nonnegativeNumber(borrow.costPctOverHold)
    || (priority !== null && !finiteNumber(priority.score))
  ) return false;

  if (proposal !== null) {
    if (
      !boundedText(proposal.id, 256, false)
      || !oneOf(proposal.status, ACTIVE_PROPOSAL_STATES)
      || !nullableNumber(proposal.netEdgePct)
      || !(proposal.confidence === null || unitInterval(proposal.confidence))
      || !nullableText(proposal.invalidation)
      || !Array.isArray(proposal.stagedSizes)
      || proposal.stagedSizes.length > 64
    ) return false;

    const stages = new Set<number>();
    for (const candidate of proposal.stagedSizes) {
      const size = plainRecord(candidate);
      if (
        size === null
        || !nonnegativeInteger(size.stage)
        || !unitInterval(size.fraction)
        || !nonnegativeNumber(size.notionalUsd)
        || stages.has(size.stage)
      ) return false;
      stages.add(size.stage);
    }
  }

  if (row.state === 'PROPOSED') {
    if (
      proposal === null
      || row.decisionKind !== 'proposal'
      || row.decisionTs === null
      || !finiteNumber(row.netEdgePct)
      || !finiteNumber(proposal.netEdgePct)
      || row.netEdgePct !== proposal.netEdgePct
    ) return false;
  }

  return true;
}

function decodeBasisRuntimeSnapshotValue(value: unknown): BasisSnapshot | null {
  const snapshot = plainRecord(value);
  const status = plainRecord(snapshot?.status);
  const thresholds = plainRecord(snapshot?.thresholds);
  if (
    snapshot === null
    || status === null
    || thresholds === null
    || !nonnegativeInteger(snapshot.updatedAt)
    || !Array.isArray(snapshot.rows)
    || snapshot.rows.length > 4_096
    || !snapshot.rows.every(validBasisRow)
  ) return null;

  if (
    typeof status.running !== 'boolean'
    || !oneOf(status.bookState, ['fresh', 'stale'])
    || !oneOf(status.markState, ['fresh', 'stale'])
    || !nullableTimestamp(status.lastBookTs)
    || !nullableTimestamp(status.lastMarkTs)
    || !nullableTimestamp(status.lastTickTs)
    || !nullableText(status.lastError)
    || !boundedText(status.bookSource, 256, false)
    || !boundedText(status.markSource, 256, false)
    || !boundedText(status.borrowSource, 256, false)
  ) return null;

  const countKeys = [
    'universeSize',
    'watching',
    'focused',
    'openProposals',
    'rejected',
    'borrowBlocked',
    'verifiedBorrow',
    'dataQualityPassing',
    'ticks',
  ] as const;
  if (!countKeys.every((key) => nonnegativeInteger(status[key]))) return null;

  const thresholdKeys = [
    'watchGapPct',
    'focusGapPct',
    'minNetBasisPct',
    'feesPct',
    'maxSpreadBps',
    'minDepthScore',
    'minDataQuality',
    'intendedNotionalUsd',
  ] as const;
  if (
    !thresholdKeys.every((key) => nonnegativeNumber(thresholds[key]))
    || !nonnegativeInteger(thresholds.persistTicks)
    || !(thresholds.minQuoteVolume24hUsd === undefined || nonnegativeNumber(thresholds.minQuoteVolume24hUsd))
  ) return null;

  const rows = snapshot.rows as BasisRow[];
  const universeSize = status.universeSize as number;
  const boundedCounts = countKeys.filter((key) => key !== 'universeSize' && key !== 'ticks');
  const proposalIds = rows.flatMap((row) => row.proposal === null ? [] : [row.proposal.id]);
  if (
    rows.length !== universeSize
    || boundedCounts.some((key) => (status[key] as number) > universeSize)
    || (status.openProposals as number) !== rows.filter((row) => row.state === 'PROPOSED').length
    || new Set(rows.map((row) => row.symbol)).size !== rows.length
    || new Set(proposalIds).size !== proposalIds.length
  ) return null;

  return snapshot as unknown as BasisSnapshot;
}

/** Returns a detached snapshot or null; malformed and hostile inputs never escape an exception. */
export function decodeBasisRuntimeSnapshot(value: unknown): BasisSnapshot | null {
  try {
    return decodeBasisRuntimeSnapshotValue(structuredClone(value));
  } catch {
    return null;
  }
}

/** Runtime facts are current for ten seconds, with at most five seconds of clock lead. */
export function basisRuntimeSnapshotCurrent(snapshot: BasisSnapshot, nowMs = Date.now()): boolean {
  try {
    const { status } = snapshot;
    if (
      !finiteNumber(nowMs)
      || !status.running
      || status.bookState !== 'fresh'
      || status.markState !== 'fresh'
      || status.lastError !== null
    ) return false;

    const timestamps = [snapshot.updatedAt, status.lastBookTs, status.lastMarkTs, status.lastTickTs];
    return timestamps.every((timestamp) => (
      timestamp !== null
      && timestamp > 0
      && timestamp <= nowMs + BASIS_MAX_FUTURE_SKEW_MS
      && nowMs - timestamp < BASIS_RUNTIME_FRESH_MS
    )) && [status.lastBookTs, status.lastMarkTs, status.lastTickTs].every(
      (timestamp) => (timestamp as number) <= snapshot.updatedAt + BASIS_MAX_FUTURE_SKEW_MS,
    );
  } catch {
    return false;
  }
}
