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

export interface AppConfig {
  feesPct: number;
  minNetBasisPct: number;
  persistTicks: number;
  minQuoteVolume24h: number;
  killSwitch: boolean;
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
