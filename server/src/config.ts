import type { AppConfig } from './types.js';
import type { Ledger } from './ledger.js';

export const DEFAULTS: AppConfig = {
  // Estimated round-trip cost of a 4-leg basis trade (open+close spot and perp, taker).
  feesPct: 0.3,
  // Required edge on top of fees before a basis reading counts as an opportunity.
  minNetBasisPct: 0.25,
  // Consecutive 2s scanner ticks a reading must persist before a signal opens/closes.
  persistTicks: 5,
  // Ignore pairs with less 24h spot quote volume than this (USDT).
  minQuoteVolume24h: 3_000_000,
  // Global halt. Stays true until an executor exists (Phase 4+).
  killSwitch: true,
};

const CONFIG_KEY = 'app';

export function loadConfig(ledger: Ledger): AppConfig {
  const raw = ledger.getConfigValue(CONFIG_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(ledger: Ledger, cfg: AppConfig): void {
  ledger.setConfigValue(CONFIG_KEY, JSON.stringify(cfg));
}
