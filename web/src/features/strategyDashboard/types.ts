export type StrategyDashboardEvidenceState =
  | 'CURRENT'
  | 'STALE'
  | 'PARTIAL'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'MISSING'
  | 'UNKNOWN';

export type StrategyDashboardEvidenceSource =
  | 'PRODUCTION_OBSERVED'
  | 'RECORDED_REPLAY'
  | 'SYNTHETIC_ONLY';

export interface StrategyDashboardEvidence {
  readonly state: StrategyDashboardEvidenceState;
  readonly source: StrategyDashboardEvidenceSource;
  readonly observedAtMs: number | null;
  readonly maxAgeMs: number | null;
  readonly reasonCodes: readonly string[];
}

/** Exact JSON shape mirrored from GET /api/pnl. Values are account aggregate. */
export interface AccountPnlMirror {
  readonly realizedByDay: readonly {
    readonly day: string;
    readonly usd: number;
  }[];
  readonly realizedBySymbol: readonly {
    readonly symbol: string;
    readonly usd: number;
  }[];
  readonly feesByAsset: readonly {
    readonly asset: string;
    readonly amount: number;
  }[];
  readonly equitySnapshots: readonly {
    readonly ts: number;
    readonly totalUsdt: number;
  }[];
  readonly integrity: {
    readonly state: 'UNKNOWN' | 'COMPLETE' | 'PARTIAL';
    readonly complete: boolean;
    readonly reasons: readonly string[];
    readonly days: readonly {
      readonly day: string;
      readonly complete: boolean;
      readonly reasons: readonly string[];
      readonly feeUsd: number;
      readonly netUsd: number;
    }[];
  };
}

export interface AccountPnlInput
  extends StrategyDashboardEvidence {
  readonly mirror: Readonly<AccountPnlMirror> | null;
}

export interface AccountPnlPoint {
  readonly day: string;
  /** Raw /api/pnl daily value shared exactly by graph and table. */
  readonly realizedUsd: number;
}

export interface AccountPnlView {
  readonly evidenceState: StrategyDashboardEvidenceState;
  readonly evidenceLabel: string;
  readonly integrityState: AccountPnlMirror['integrity']['state'] | 'UNAVAILABLE';
  readonly tone: 'ok' | 'warn' | 'bad' | 'idle';
  readonly publishable: boolean;
  readonly totalRealizedUsd: number | null;
  readonly points: readonly Readonly<AccountPnlPoint>[];
  readonly reasonCodes: readonly string[];
}
