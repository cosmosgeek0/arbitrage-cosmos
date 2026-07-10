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
    status: string;
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
