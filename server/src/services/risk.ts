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
    let sum = 0;
    for (const ev of this.ledger.eventsSince(utcDayStart(), 'order_response')) {
      const d = ev.data as { executedQuoteUsd?: number; estNotionalUsd?: number } | null;
      sum += d?.executedQuoteUsd ?? d?.estNotionalUsd ?? 0;
    }
    return sum;
  }

  lastOrderTs(): number | null {
    return this.ledger.lastEvent('order_response')?.ts ?? null;
  }

  evaluate(intent: OrderIntent, ctx: RiskContext, opts: { forLiveSend: boolean }): RiskDecision {
    const checks: RiskCheck[] = [];
    const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

    add(
      'kill_switch_off',
      !this.cfg.killSwitch,
      this.cfg.killSwitch ? 'kill switch is ON — everything halted' : 'kill switch is off'
    );

    if (opts.forLiveSend) {
      add(
        'live_trading_enabled',
        this.cfg.liveTradingEnabled,
        this.cfg.liveTradingEnabled ? 'live trading is armed' : 'live trading is disabled (arm it on the Risk page)'
      );
    }

    add(
      'symbol_allowed',
      this.cfg.allowedSymbols.includes(intent.symbol),
      this.cfg.allowedSymbols.length === 0
        ? 'allowlist is EMPTY — add symbols on the Risk page'
        : this.cfg.allowedSymbols.includes(intent.symbol)
          ? `${intent.symbol} is on the allowlist`
          : `${intent.symbol} is not on the allowlist [${this.cfg.allowedSymbols.join(', ')}]`
    );

    add(
      'symbol_not_blocked',
      !this.cfg.blockedSymbols.includes(intent.symbol),
      this.cfg.blockedSymbols.includes(intent.symbol) ? `${intent.symbol} is blocklisted` : 'not blocklisted'
    );

    if (ctx.estNotionalUsd === null) {
      add('notional_known', false, 'cannot estimate order notional (no price available)');
    } else {
      add(
        'max_order_notional',
        ctx.estNotionalUsd <= this.cfg.maxOrderNotionalUsd,
        `est $${ctx.estNotionalUsd.toFixed(2)} vs limit $${this.cfg.maxOrderNotionalUsd}`
      );
      const used = this.dailyNotionalUsedUsd();
      add(
        'max_daily_notional',
        used + ctx.estNotionalUsd <= this.cfg.maxDailyNotionalUsd,
        `used $${used.toFixed(2)} + est $${ctx.estNotionalUsd.toFixed(2)} vs daily limit $${this.cfg.maxDailyNotionalUsd}`
      );
    }

    add(
      'max_open_orders',
      ctx.openOrdersCount < this.cfg.maxOpenOrders,
      `${ctx.openOrdersCount} open vs limit ${this.cfg.maxOpenOrders}`
    );

    const last = this.lastOrderTs();
    const cooldownOk = last === null || Date.now() - last >= this.cfg.cooldownSec * 1000;
    add(
      'cooldown',
      cooldownOk,
      cooldownOk
        ? 'cooldown clear'
        : `wait ${Math.ceil((this.cfg.cooldownSec * 1000 - (Date.now() - last!)) / 1000)}s (cooldown ${this.cfg.cooldownSec}s)`
    );

    add(
      'daily_loss_limit',
      ctx.realizedTodayUsd > -this.cfg.maxDailyLossUsd,
      `realized today $${ctx.realizedTodayUsd.toFixed(2)} vs max loss -$${this.cfg.maxDailyLossUsd}`
    );

    const failed = checks.filter((c) => !c.pass);
    return {
      allowed: failed.length === 0,
      checks,
      reasons: failed.map((c) => `${c.name}: ${c.detail}`),
    };
  }
}
