export type SymbolStatus = 'idle' | 'watching' | 'signal';

export interface SymbolRow {
  symbol: string;
  base: string;
  spot: number | null;
  perpMark: number | null;
  basisPct: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  change24hPct: number | null;
  quoteVolume24h: number | null;
  status: SymbolStatus;
}

export interface SparkRow extends SymbolRow {
  spark: number[];
}

export interface Stats {
  pairs: number;
  liquidPairs: number;
  feeds: Record<string, 'connecting' | 'open' | 'closed'>;
  activeSignals: number;
  watching: number;
  avgAbsBasis: number;
  grossThresholdPct: number;
  killSwitch: boolean;
  topBasis: SparkRow[];
  topMovers: SparkRow[];
}

export interface Snapshot {
  updatedAt: number;
  stats: Stats;
  rows: SymbolRow[];
}

export interface ActiveSignal {
  id: number;
  symbol: string;
  side: 'SHORT_PERP_LONG_SPOT' | 'LONG_PERP_SHORT_SPOT';
  openedTs: number;
  basisOpen: number;
  basisNow: number;
  basisPeak: number;
  fundingOpen: number | null;
  spotOpen: number | null;
  perpOpen: number | null;
}

export interface SignalRecord {
  id: number;
  symbol: string;
  side: string;
  openedTs: number;
  closedTs: number | null;
  basisOpen: number;
  basisPeak: number;
  basisClose: number | null;
  fundingOpen: number | null;
}

export interface SignalsResp {
  active: ActiveSignal[];
  recent: SignalRecord[];
}

export interface LedgerEvent {
  id: number;
  ts: number;
  kind: string;
  symbol: string | null;
  data: unknown;
}

export interface AppConfig {
  feesPct: number;
  minNetBasisPct: number;
  persistTicks: number;
  minQuoteVolume24h: number;
  killSwitch: boolean;
}

export interface KlinePoint {
  t: number;
  v: number;
}
