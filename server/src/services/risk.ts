import type { Ledger } from '../ledger.js';
import type { AppConfig, OrderIntent, RiskCheck, RiskDecision } from '../types.js';

function utcDayStart(ts = Date.now()): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface RiskContext {
  estNotionalUsd: number | null;
  openOrdersCount: number;
  realizedTodayUsd: number;
  pendingOpenOrdersNotionalUsd?: number | null;
  dailyLossPolicyUsd?: number | null;
  dailyLossPolicyComplete?: boolean;
  dailyLossPolicyReasons?: string[];
}

interface DailyNotionalUsage {
  usedUsd: number;
  complete: boolean;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Deterministic pre-trade gate. Every live send MUST pass through evaluate()
 * with forLiveSend=true — there is no other code path to placeOrder.
 */
export class RiskService {
  constructor(
    private readonly cfg: AppConfig,
    private readonly ledger: Ledger
  ) {}

  dailyNotionalUsedUsd(): number {
    return this.dailyNotionalUsage().usedUsd;
  }

  lastOrderTs(): number | null {
    const requestTs = this.ledger.lastEvent('order_request')?.ts ?? null;
    const responseTs = this.ledger.lastEvent('order_response')?.ts ?? null;
    if (requestTs === null) return responseTs;
    if (responseTs === null) return requestTs;
    return Math.max(requestTs, responseTs);
  }

  rejectionsTodayCount(): number {
    let n = 0;
    for (const ev of this.ledger.eventsSince(utcDayStart(), 'risk_decision')) {
      if ((ev.data as { allowed?: boolean } | null)?.allowed === false) n++;
    }
    return n;
  }

  evaluate(intent: OrderIntent, ctx: RiskContext, opts: { forLiveSend: boolean }): RiskDecision {
    const checks: RiskCheck[] = [];
    const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

    const configValid =
      typeof this.cfg.killSwitch === 'boolean' &&
      typeof this.cfg.fundsLocked === 'boolean' &&
      typeof this.cfg.automationPaused === 'boolean' &&
      typeof this.cfg.liveTradingEnabled === 'boolean' &&
      finiteNonNegative(this.cfg.maxOrderNotionalUsd) &&
      finiteNonNegative(this.cfg.maxDailyNotionalUsd) &&
      finiteNonNegative(this.cfg.maxDailyLossUsd) &&
      Number.isInteger(this.cfg.maxOpenOrders) &&
      this.cfg.maxOpenOrders >= 0 &&
      finiteNonNegative(this.cfg.cooldownSec) &&
      Array.isArray(this.cfg.allowedSymbols) &&
      this.cfg.allowedSymbols.every((symbol) => typeof symbol === 'string' && /^[A-Z0-9]{4,20}$/.test(symbol)) &&
      Array.isArray(this.cfg.blockedSymbols) &&
      this.cfg.blockedSymbols.every((symbol) => typeof symbol === 'string' && /^[A-Z0-9]{4,20}$/.test(symbol));
    add('risk_config_valid', configValid, configValid ? 'risk configuration is valid' : 'risk configuration is invalid');

    const intentValid =
      /^[A-Z0-9]{4,20}$/.test(intent.symbol) &&
      (intent.side === 'BUY' || intent.side === 'SELL') &&
      (intent.type === 'MARKET' || intent.type === 'LIMIT') &&
      (intent.source === 'manual' || intent.source === 'proposal');
    add('order_intent_valid', intentValid, intentValid ? 'order intent is valid' : 'order intent is invalid');

    add(
      'kill_switch_off',
      this.cfg.killSwitch === false,
      this.cfg.killSwitch === false ? 'kill switch is off' : 'kill switch is ON or invalid — everything halted'
    );

    add(
      'funds_access_unlocked',
      this.cfg.fundsLocked === false,
      this.cfg.fundsLocked === false ? 'funds access is allowed' : 'funds access is OFF or invalid — money actions are blocked'
    );

    if (intent.source === 'proposal') {
      add(
        'automation_running',
        this.cfg.automationPaused === false,
        this.cfg.automationPaused === false ? 'bot automation is running' : 'bot automation is paused or invalid'
      );
    }

    if (opts.forLiveSend) {
      add(
        'live_trading_enabled',
        this.cfg.liveTradingEnabled === true,
        this.cfg.liveTradingEnabled === true ? 'live trading is armed' : 'live trading is disabled or invalid (arm it on the Risk page)'
      );
    }

    add(
      'symbol_allowed',
      Array.isArray(this.cfg.allowedSymbols) && this.cfg.allowedSymbols.includes(intent.symbol),
      !Array.isArray(this.cfg.allowedSymbols) || this.cfg.allowedSymbols.length === 0
        ? 'allowlist is EMPTY — add symbols on the Risk page'
        : this.cfg.allowedSymbols.includes(intent.symbol)
          ? `${intent.symbol} is on the allowlist`
          : `${intent.symbol} is not on the allowlist [${this.cfg.allowedSymbols.join(', ')}]`
    );

    add(
      'symbol_not_blocked',
      Array.isArray(this.cfg.blockedSymbols) && !this.cfg.blockedSymbols.includes(intent.symbol),
      Array.isArray(this.cfg.blockedSymbols) && this.cfg.blockedSymbols.includes(intent.symbol)
        ? `${intent.symbol} is blocklisted`
        : Array.isArray(this.cfg.blockedSymbols)
          ? 'not blocklisted'
          : 'blocklist is invalid'
    );

    if (!finitePositive(ctx.estNotionalUsd)) {
      add('notional_known', false, 'cannot establish a finite positive order notional');
    } else {
      const maxOrderValid = finiteNonNegative(this.cfg.maxOrderNotionalUsd);
      add(
        'max_order_notional',
        maxOrderValid && ctx.estNotionalUsd <= this.cfg.maxOrderNotionalUsd,
        maxOrderValid
          ? `est $${ctx.estNotionalUsd.toFixed(2)} vs limit $${this.cfg.maxOrderNotionalUsd}`
          : 'max order notional configuration is invalid'
      );
      const usage = this.dailyNotionalUsage();
      const pending = ctx.pendingOpenOrdersNotionalUsd ?? 0;
      const pendingKnown = finiteNonNegative(pending);
      add(
        'daily_notional_state_known',
        usage.complete && pendingKnown,
        usage.complete && pendingKnown
          ? `ledger $${usage.usedUsd.toFixed(2)} + pending $${pending.toFixed(2)}`
          : 'daily notional ledger or pending-order exposure is incomplete'
      );
      const maxDailyValid = finiteNonNegative(this.cfg.maxDailyNotionalUsd);
      add(
        'max_daily_notional',
        usage.complete && pendingKnown && maxDailyValid && usage.usedUsd + pending + ctx.estNotionalUsd <= this.cfg.maxDailyNotionalUsd,
        usage.complete && pendingKnown && maxDailyValid
          ? `used $${usage.usedUsd.toFixed(2)} + pending $${pending.toFixed(2)} + est $${ctx.estNotionalUsd.toFixed(2)} vs daily limit $${this.cfg.maxDailyNotionalUsd}`
          : 'daily notional state or configuration is invalid'
      );
    }

    const openOrdersValid = Number.isInteger(ctx.openOrdersCount) && ctx.openOrdersCount >= 0;
    add(
      'max_open_orders',
      openOrdersValid && Number.isInteger(this.cfg.maxOpenOrders) && this.cfg.maxOpenOrders >= 0 && ctx.openOrdersCount < this.cfg.maxOpenOrders,
      openOrdersValid && Number.isInteger(this.cfg.maxOpenOrders) && this.cfg.maxOpenOrders >= 0
        ? `${ctx.openOrdersCount} open vs limit ${this.cfg.maxOpenOrders}`
        : 'open-order count or limit is invalid'
    );

    const last = this.lastOrderTs();
    const cooldownValid = finiteNonNegative(this.cfg.cooldownSec);
    const cooldownOk = cooldownValid && (last === null || Date.now() - last >= this.cfg.cooldownSec * 1000);
    add(
      'cooldown',
      cooldownOk,
      cooldownOk
        ? 'cooldown clear'
        : !cooldownValid
          ? 'cooldown configuration is invalid'
          : `wait ${Math.ceil((this.cfg.cooldownSec * 1000 - (Date.now() - last!)) / 1000)}s (cooldown ${this.cfg.cooldownSec}s)`
    );

    const policyValue = ctx.dailyLossPolicyUsd ?? ctx.realizedTodayUsd;
    const policyComplete =
      (ctx.dailyLossPolicyComplete ?? true) &&
      typeof policyValue === 'number' &&
      Number.isFinite(policyValue);
    add(
      'daily_loss_basis_known',
      policyComplete,
      policyComplete
        ? 'realized PnL and fees are completely valued'
        : `daily-loss basis is incomplete${ctx.dailyLossPolicyReasons?.length ? `: ${ctx.dailyLossPolicyReasons.join('; ')}` : ''}`
    );
    const maxLossValid = finiteNonNegative(this.cfg.maxDailyLossUsd);
    add(
      'daily_loss_limit',
      policyComplete && maxLossValid && policyValue > -this.cfg.maxDailyLossUsd,
      policyComplete && maxLossValid
        ? `fee-adjusted policy PnL $${policyValue.toFixed(2)} vs max loss -$${this.cfg.maxDailyLossUsd}`
        : 'daily-loss state or configuration is invalid'
    );

    const failed = checks.filter((c) => !c.pass);
    return {
      allowed: failed.length === 0,
      checks,
      reasons: failed.map((c) => `${c.name}: ${c.detail}`),
    };
  }

  private dailyNotionalUsage(): DailyNotionalUsage {
    const dayStart = utcDayStart();
    const priorUnresolved = this.ledger.unresolvedOrderRequestsBefore(dayStart);
    const reservations = new Map<string, number>();
    const unknownReservations = new Set<string>();
    const unresolvedRequests = new Set<string>();
    let legacyUsed = 0;
    let complete = true;

    const events = [
      ...this.ledger.eventsSince(dayStart, 'order_request'),
      ...this.ledger.eventsSince(dayStart, 'order_response'),
      ...this.ledger.eventsSince(dayStart, 'order_outcome_unknown'),
    ].sort((left, right) => left.id - right.id);

    for (const event of events) {
      if (event.kind === 'order_request') {
        const data = event.data as { reservationId?: unknown; reservedNotionalUsd?: unknown } | null;
        if (!data || data.reservationId === undefined) {
          // Legacy requests have no correlation id, so the service cannot
          // prove whether they reached the exchange.
          complete = false;
          continue;
        }
        if (typeof data.reservationId !== 'string' || data.reservationId.length === 0 || !finitePositive(data.reservedNotionalUsd)) {
          complete = false;
          continue;
        }
        reservations.set(data.reservationId, data.reservedNotionalUsd);
        unresolvedRequests.add(data.reservationId);
        continue;
      }

      if (event.kind === 'order_outcome_unknown') {
        const data = event.data as { reservationId?: unknown } | null;
        if (typeof data?.reservationId !== 'string' || data.reservationId.length === 0) complete = false;
        else unknownReservations.add(data.reservationId);
        continue;
      }

      const data = event.data as {
        reservationId?: unknown;
        executedQuoteUsd?: unknown;
        estNotionalUsd?: unknown;
        reservationReleased?: unknown;
      } | null;
      if (!data) continue;
      const monetaryFields = [data.executedQuoteUsd, data.estNotionalUsd].filter((value) => value !== undefined);
      if (monetaryFields.some((value) => !finiteNonNegative(value))) {
        complete = false;
        continue;
      }
      const amount = monetaryFields.length > 0 ? Math.max(...(monetaryFields as number[])) : 0;
      if (data.reservationId === undefined) {
        legacyUsed += amount;
        continue;
      }
      if (typeof data.reservationId !== 'string' || data.reservationId.length === 0) {
        complete = false;
        continue;
      }
      unknownReservations.delete(data.reservationId);
      unresolvedRequests.delete(data.reservationId);
      if (data.reservationReleased === true) reservations.delete(data.reservationId);
      else reservations.set(data.reservationId, Math.max(reservations.get(data.reservationId) ?? 0, amount));
    }

    const reserved = [...reservations.values()].reduce((sum, value) => sum + value, 0);
    const usedUsd = legacyUsed + reserved;
    return {
      usedUsd,
      complete:
        complete &&
        priorUnresolved === 0 &&
        unknownReservations.size === 0 &&
        unresolvedRequests.size === 0 &&
        Number.isFinite(usedUsd),
    };
  }
}
