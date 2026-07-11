import type { AppConfig, ControlMode, CustomRule, ExecutionControlModes } from './types.js';
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
  fundsLocked: true,
  automationPaused: true,
  controlModes: {
    funds: 'blocked',
    borrowing: 'blocked',
    automation: 'paused',
    liveOrders: 'paused',
  },

  // Risk limits sized for a ~$10 account. Raise them deliberately, in the UI.
  maxOrderNotionalUsd: 12,
  maxDailyNotionalUsd: 40,
  maxDailyLossUsd: 3,
  maxOpenOrders: 3,
  cooldownSec: 60,
  allowedSymbols: [], // empty allowlist = risk engine rejects every symbol
  blockedSymbols: [],
  staleOrderMaxMin: 60,
  borrowGuard: {
    enabled: true,
    newBorrowPaused: true,
    repayOnly: true,
    maxLtvPct: 80,
    maxAprPct: 12,
    maxBorrowNotionalUsd: 12,
    requireLiveCatalog: true,
    allowedCollateralCoins: ['USDT', 'USDC', 'FDUSD'],
    blockedLoanCoins: [],
  },
  watchlist: ['BTCUSDT', 'ETHUSDT'],
  profile: { name: '', avatar: null },
  customRules: [],
};

const CONFIG_KEY = 'app';
const SYMBOL_RE = /^[A-Z0-9]{4,20}$/;
const COIN_RE = /^[A-Z0-9]{1,20}$/;
const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const CONTROL_MODES = new Set<ControlMode>(['blocked', 'paused', 'allowed']);
const RULE_SCOPES = new Set<CustomRule['scope']>(['orders', 'symbols', 'strategy', 'hours', 'general']);
const RULE_EFFECTS = new Set<CustomRule['effect']>(['allow', 'block', 'limit']);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function strictBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function finiteNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (integer && !Number.isSafeInteger(value)) return fallback;
  return value >= minimum && value <= maximum ? value : fallback;
}

function mode(value: unknown, fallback: ControlMode): ControlMode {
  return typeof value === 'string' && CONTROL_MODES.has(value as ControlMode)
    ? value as ControlMode
    : fallback;
}

function stringList(
  value: unknown,
  fallback: readonly string[],
  expression: RegExp,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== 'string')) {
    return [...fallback];
  }
  const normalized = value.map((item) => item.trim().toUpperCase());
  if (normalized.some((item) => !expression.test(item))) return [...fallback];
  return [...new Set(normalized)];
}

function customRules(value: unknown): CustomRule[] {
  if (!Array.isArray(value) || value.length > 50) return [];
  const normalized: CustomRule[] = [];
  for (const candidate of value) {
    const item = record(candidate);
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 40) : '';
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
    const note = typeof item.note === 'string' ? item.note.slice(0, 240) : '';
    const scope = RULE_SCOPES.has(item.scope as CustomRule['scope']) ? item.scope as CustomRule['scope'] : null;
    const effect = RULE_EFFECTS.has(item.effect as CustomRule['effect']) ? item.effect as CustomRule['effect'] : null;
    const createdAt = finiteNumber(item.createdAt, 0, 1, Number.MAX_SAFE_INTEGER, true);
    if (!id || !name || !scope || !effect || !createdAt || typeof item.strict !== 'boolean') continue;
    normalized.push({ id, name, scope, effect, note, strict: item.strict, createdAt });
  }
  return normalized;
}

/**
 * Converts persisted or caller-provided data into the complete, bounded
 * configuration consumed by safety-sensitive services. Unknown, mistyped,
 * non-finite, and out-of-range values fall back to the deliberately halted
 * defaults instead of being coerced into permissive settings.
 */
export function normalizeConfig(value: unknown): AppConfig {
  const source = record(value);
  const sourceGuard = record(source.borrowGuard);
  const sourceModes = record(source.controlModes);
  const base = structuredClone(DEFAULTS);

  const requestedFundsLocked = strictBoolean(source.fundsLocked, base.fundsLocked);
  const requestedAutomationPaused = strictBoolean(source.automationPaused, base.automationPaused);
  const requestedLiveTrading = strictBoolean(source.liveTradingEnabled, base.liveTradingEnabled);

  const borrowGuard: AppConfig['borrowGuard'] = {
    enabled: strictBoolean(sourceGuard.enabled, base.borrowGuard.enabled),
    newBorrowPaused: strictBoolean(sourceGuard.newBorrowPaused, base.borrowGuard.newBorrowPaused),
    repayOnly: strictBoolean(sourceGuard.repayOnly, base.borrowGuard.repayOnly),
    maxLtvPct: finiteNumber(sourceGuard.maxLtvPct, base.borrowGuard.maxLtvPct, 0, 95),
    maxAprPct: finiteNumber(sourceGuard.maxAprPct, base.borrowGuard.maxAprPct, 0, 1_000),
    maxBorrowNotionalUsd: finiteNumber(
      sourceGuard.maxBorrowNotionalUsd,
      base.borrowGuard.maxBorrowNotionalUsd,
      0.01,
      10_000_000,
    ),
    // Borrow admission always requires a fresh, signed Binance catalog. Keep
    // the persisted field for backwards-compatible state payloads, but never
    // permit configuration to weaken this invariant.
    requireLiveCatalog: true,
    allowedCollateralCoins: stringList(
      sourceGuard.allowedCollateralCoins,
      base.borrowGuard.allowedCollateralCoins,
      COIN_RE,
      40,
    ),
    blockedLoanCoins: stringList(sourceGuard.blockedLoanCoins, base.borrowGuard.blockedLoanCoins, COIN_RE, 40),
  };
  // Repay-only can never coexist with admission of new debt.
  if (borrowGuard.repayOnly) borrowGuard.newBorrowPaused = true;

  const derivedModes: ExecutionControlModes = {
    funds: requestedFundsLocked ? 'blocked' : 'allowed',
    borrowing: borrowGuard.repayOnly ? 'blocked' : borrowGuard.newBorrowPaused ? 'paused' : 'allowed',
    automation: requestedAutomationPaused ? 'paused' : 'allowed',
    liveOrders: requestedLiveTrading ? 'allowed' : 'paused',
  };
  const controlModes: ExecutionControlModes = {
    funds: mode(sourceModes.funds, derivedModes.funds),
    borrowing: mode(sourceModes.borrowing, derivedModes.borrowing),
    automation: mode(sourceModes.automation, derivedModes.automation),
    liveOrders: mode(sourceModes.liveOrders, derivedModes.liveOrders),
  };

  // A more permissive display/control mode may never override a closed legacy
  // safety bit or a stricter borrow guard persisted alongside it.
  // The legacy boolean represents both paused and blocked. Preserve a valid
  // explicit paused mode, but never let an inconsistent legacy lock become
  // fully allowed.
  if (requestedFundsLocked && controlModes.funds === 'allowed') controlModes.funds = 'blocked';
  if (requestedAutomationPaused && controlModes.automation === 'allowed') controlModes.automation = 'paused';
  if (!requestedLiveTrading && controlModes.liveOrders === 'allowed') controlModes.liveOrders = 'paused';
  if (borrowGuard.repayOnly) controlModes.borrowing = 'blocked';
  else if (borrowGuard.newBorrowPaused && controlModes.borrowing === 'allowed') controlModes.borrowing = 'paused';

  const sourceProfile = record(source.profile);
  const avatar = sourceProfile.avatar === null
    ? null
    : typeof sourceProfile.avatar === 'string' && sourceProfile.avatar.length <= 160_000 && DATA_IMAGE_RE.test(sourceProfile.avatar)
      ? sourceProfile.avatar
      : base.profile.avatar;

  return {
    feesPct: finiteNumber(source.feesPct, base.feesPct, 0, 10),
    minNetBasisPct: finiteNumber(source.minNetBasisPct, base.minNetBasisPct, 0, 100),
    persistTicks: finiteNumber(source.persistTicks, base.persistTicks, 1, 10_000, true),
    minQuoteVolume24h: finiteNumber(source.minQuoteVolume24h, base.minQuoteVolume24h, 0, 1_000_000_000_000_000),
    killSwitch: strictBoolean(source.killSwitch, base.killSwitch),
    liveTradingEnabled: requestedLiveTrading && controlModes.liveOrders === 'allowed',
    fundsLocked: requestedFundsLocked || controlModes.funds !== 'allowed',
    automationPaused: requestedAutomationPaused || controlModes.automation !== 'allowed',
    controlModes,
    maxOrderNotionalUsd: finiteNumber(source.maxOrderNotionalUsd, base.maxOrderNotionalUsd, 0, 1_000_000_000),
    maxDailyNotionalUsd: finiteNumber(source.maxDailyNotionalUsd, base.maxDailyNotionalUsd, 0, 1_000_000_000_000),
    maxDailyLossUsd: finiteNumber(source.maxDailyLossUsd, base.maxDailyLossUsd, 0, 1_000_000_000),
    maxOpenOrders: finiteNumber(source.maxOpenOrders, base.maxOpenOrders, 0, 10_000, true),
    cooldownSec: finiteNumber(source.cooldownSec, base.cooldownSec, 0, 86_400, true),
    allowedSymbols: stringList(source.allowedSymbols, base.allowedSymbols, SYMBOL_RE, 500),
    blockedSymbols: stringList(source.blockedSymbols, base.blockedSymbols, SYMBOL_RE, 500),
    staleOrderMaxMin: finiteNumber(source.staleOrderMaxMin, base.staleOrderMaxMin, 0, 43_200, true),
    borrowGuard,
    watchlist: stringList(source.watchlist, base.watchlist, SYMBOL_RE, 500),
    profile: {
      name: typeof sourceProfile.name === 'string' ? sourceProfile.name.replace(/[\r\n\0]/g, ' ').trim().slice(0, 40) : base.profile.name,
      avatar,
    },
    customRules: customRules(source.customRules),
  };
}

export function loadConfig(ledger: Ledger): AppConfig {
  const raw = ledger.getConfigValue(CONFIG_KEY);
  if (!raw) return structuredClone(DEFAULTS);
  try {
    return normalizeConfig(JSON.parse(raw) as unknown);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(ledger: Ledger, cfg: AppConfig): void {
  const normalized = normalizeConfig(cfg);
  ledger.setConfigValueAndLogEvent(
    CONFIG_KEY,
    JSON.stringify(normalized),
    'config_persisted',
    null,
    { key: CONFIG_KEY },
  );
  // Existing callers apply the same object to their live configuration after
  // this function returns. Mutating it only after the durable commit keeps the
  // persisted and in-memory states identical.
  Object.assign(cfg, normalized);
}
