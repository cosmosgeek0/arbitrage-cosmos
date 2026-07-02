import type { AppConfig } from './types.js';
import type { Ledger } from './ledger.js';

export const DEFAULTS: AppConfig = {
  // Estimated round-trip cost of a 4-leg basis trade (open+close spot and perp, taker).
  feesPct: 0.3,
  // Required edge on top of fees before a basis reading counts as a proposal.
  minNetBasisPct: 0.25,
  // Consecutive 2s scanner ticks a reading must persist before a proposal opens/closes.
  persistTicks: 5,
  // Ignore pairs with less 24h spot quote volume than this (USDT).
  minQuoteVolume24h: 3_000_000,

  // Control. Kill switch starts ON (halted); live trading starts OFF.
  killSwitch: true,
  liveTradingEnabled: false,

  // Risk limits sized for a ~$10 account. Raise them deliberately, in the UI.
  maxOrderNotionalUsd: 12,
  maxDailyNotionalUsd: 40,
  maxDailyLossUsd: 3,
  maxOpenOrders: 3,
  cooldownSec: 60,
  allowedSymbols: [], // empty allowlist = risk engine rejects every symbol
  blockedSymbols: [],
  staleOrderMaxMin: 60,
  watchlist: ['BTCUSDT', 'ETHUSDT'],
};

const CONFIG_KEY = 'app';

export function loadConfig(ledger: Ledger): AppConfig {
  const raw = ledger.getConfigValue(CONFIG_KEY);
  if (!raw) return structuredClone(DEFAULTS);
  try {
    return { ...structuredClone(DEFAULTS), ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(ledger: Ledger, cfg: AppConfig): void {
  ledger.setConfigValue(CONFIG_KEY, JSON.stringify(cfg));
}
