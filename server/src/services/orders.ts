import { BinanceApiError, type BinanceClient, type OpenOrder } from '../binance/client.js';
import type { SymbolFilters } from '../binance/rest.js';
import type { Ledger } from '../ledger.js';
import type { OrderIntent, RiskDecision } from '../types.js';
import type { AccountService } from './account.js';
import type { RiskService } from './risk.js';

export interface PreviewResult {
  ok: boolean;
  errors: string[];
  symbol: string;
  side: string;
  type: string;
  lastPrice: number | null;
  effectivePrice: number | null;
  quantity: number | null;
  quoteQty: number | null;
  estNotionalUsd: number | null;
  filters: { stepSize: number; minQty: number; tickSize: number; minNotional: number } | null;
  risk: RiskDecision;
}

export interface SendResult {
  sent: boolean;
  risk?: RiskDecision;
  error?: string;
  order?: { orderId: number; status: string; executedQty: string; cummulativeQuoteQty: string };
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const rounded = Math.floor(value / step + 1e-9) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number(rounded.toFixed(decimals));
}

/**
 * The ONLY module that talks to Binance trading endpoints. Every send passes
 * the risk gate; every step is ledgered. No withdrawal/transfer code exists.
 */
export class OrderService {
  openOrdersCache: OpenOrder[] = [];
  lastOrdersSyncTs: number | null = null;

  constructor(
    private readonly client: BinanceClient | null,
    private readonly filters: Map<string, SymbolFilters>,
    private readonly priceOf: (symbol: string) => number | null,
    private readonly risk: RiskService,
    private readonly ledger: Ledger,
    private readonly account: AccountService
  ) {}

  private resolve(intent: OrderIntent): {
    errors: string[];
    f: SymbolFilters | null;
    lastPrice: number | null;
    effectivePrice: number | null;
    quantity: number | null;
    estNotionalUsd: number | null;
  } {
    const errors: string[] = [];
    const f = this.filters.get(intent.symbol) ?? null;
    if (!f) errors.push(`unknown or non-tradable spot symbol: ${intent.symbol}`);
    const lastPrice = this.priceOf(intent.symbol);
    const effectivePrice = intent.type === 'LIMIT' ? (intent.price ?? null) : lastPrice;

    if (intent.type === 'LIMIT' && (intent.price === undefined || intent.price <= 0)) {
      errors.push('LIMIT order needs a price');
    }

    let quantity: number | null = null;
    let estNotionalUsd: number | null = null;

    if (intent.quoteQty !== undefined && intent.quoteQty > 0) {
      if (intent.type !== 'MARKET') errors.push('quote amount is only supported for MARKET orders');
      estNotionalUsd = intent.quoteQty;
      quantity = effectivePrice ? intent.quoteQty / effectivePrice : null;
    } else if (intent.quantity !== undefined && intent.quantity > 0) {
      quantity = f ? roundToStep(intent.quantity, f.stepSize) : intent.quantity;
      if (f && quantity < f.minQty) errors.push(`quantity ${quantity} below minQty ${f.minQty}`);
      estNotionalUsd = effectivePrice !== null ? quantity * effectivePrice : null;
    } else {
      errors.push('provide a quantity or a quote amount');
    }

    if (f && estNotionalUsd !== null && estNotionalUsd < f.minNotional) {
      errors.push(`notional $${estNotionalUsd.toFixed(2)} below Binance minNotional $${f.minNotional}`);
    }
    if (effectivePrice === null) errors.push('no price available for this symbol yet');

    return { errors, f, lastPrice, effectivePrice, quantity, estNotionalUsd };
  }

  private buildParams(intent: OrderIntent, quantity: number | null, f: SymbolFilters) {
    const params: Record<string, string | number | undefined> = {
      symbol: intent.symbol,
      side: intent.side,
      type: intent.type,
    };
    if (intent.type === 'LIMIT') {
      params.timeInForce = 'GTC';
      params.price = roundToStep(intent.price!, f.tickSize);
      params.quantity = quantity ?? undefined;
    } else if (intent.quoteQty !== undefined && intent.quoteQty > 0) {
      params.quoteOrderQty = intent.quoteQty;
    } else {
      params.quantity = quantity ?? undefined;
    }
    return params;
  }

  preview(intent: OrderIntent): PreviewResult {
    const r = this.resolve(intent);
    const risk = this.risk.evaluate(
      intent,
      {
        estNotionalUsd: r.estNotionalUsd,
        openOrdersCount: this.openOrdersCache.length,
        realizedTodayUsd: this.account.realizedTodayUsd(),
      },
      { forLiveSend: false }
    );
    this.ledger.logEvent('order_intent', intent.symbol, {
      stage: 'preview',
      intent,
      estNotionalUsd: r.estNotionalUsd,
      errors: r.errors,
    });
    this.ledger.logEvent('risk_decision', intent.symbol, {
      stage: 'preview',
      allowed: risk.allowed,
      reasons: risk.reasons,
    });
    return {
      ok: r.errors.length === 0,
      errors: r.errors,
      symbol: intent.symbol,
      side: intent.side,
      type: intent.type,
      lastPrice: r.lastPrice,
      effectivePrice: r.effectivePrice,
      quantity: r.quantity,
      quoteQty: intent.quoteQty ?? null,
      estNotionalUsd: r.estNotionalUsd,
      filters: r.f
        ? { stepSize: r.f.stepSize, minQty: r.f.minQty, tickSize: r.f.tickSize, minNotional: r.f.minNotional }
        : null,
      risk,
    };
  }

  /** Signed validation against Binance without hitting the matching engine. */
  async testOrder(intent: OrderIntent): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) return { ok: false, error: 'Binance keys not configured' };
    const r = this.resolve(intent);
    if (r.errors.length > 0 || !r.f) return { ok: false, error: r.errors.join('; ') };
    try {
      await this.client.testOrder(this.buildParams(intent, r.quantity, r.f));
      this.ledger.logEvent('manual_action', intent.symbol, { action: 'test_order', intent, result: 'valid' });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.ledger.logEvent('manual_action', intent.symbol, { action: 'test_order', intent, result: 'rejected', error: msg });
      return { ok: false, error: msg };
    }
  }

  /** The live path. confirmSymbol is the typed confirmation from the modal. */
  async send(intent: OrderIntent, confirmSymbol: string): Promise<SendResult> {
    if (!this.client) return { sent: false, error: 'Binance keys not configured' };
    if (confirmSymbol !== intent.symbol) {
      this.ledger.logEvent('manual_action', intent.symbol, {
        action: 'live_send',
        result: 'rejected',
        error: 'typed confirmation did not match symbol',
      });
      return { sent: false, error: 'Typed confirmation does not match the symbol.' };
    }

    const r = this.resolve(intent);
    if (r.errors.length > 0 || !r.f) return { sent: false, error: r.errors.join('; ') };

    await this.syncOpenOrders().catch(() => undefined);
    const risk = this.risk.evaluate(
      intent,
      {
        estNotionalUsd: r.estNotionalUsd,
        openOrdersCount: this.openOrdersCache.length,
        realizedTodayUsd: this.account.realizedTodayUsd(),
      },
      { forLiveSend: true }
    );
    this.ledger.logEvent('risk_decision', intent.symbol, {
      stage: 'live_send',
      allowed: risk.allowed,
      reasons: risk.reasons,
      estNotionalUsd: r.estNotionalUsd,
    });
    if (!risk.allowed) return { sent: false, risk };

    const params = this.buildParams(intent, r.quantity, r.f);
    this.ledger.logEvent('order_request', intent.symbol, { params, source: intent.source });
    try {
      const res = await this.client.placeOrder(params);
      const executedQuote = Number(res.cummulativeQuoteQty) || 0;
      this.ledger.logEvent('order_response', intent.symbol, {
        orderId: res.orderId,
        status: res.status,
        executedQty: res.executedQty,
        executedQuoteUsd: executedQuote,
        estNotionalUsd: r.estNotionalUsd,
      });
      for (const fill of res.fills ?? []) {
        this.account.recordFill({
          symbol: intent.symbol,
          tradeId: fill.tradeId,
          orderId: res.orderId,
          side: intent.side,
          price: Number(fill.price),
          qty: Number(fill.qty),
          quoteQty: Number(fill.price) * Number(fill.qty),
          commission: Number(fill.commission),
          commissionAsset: fill.commissionAsset,
          ts: Date.now(),
          source: 'order_response',
        });
      }
      void this.account.sync();
      void this.syncOpenOrders().catch(() => undefined);
      return {
        sent: true,
        risk,
        order: {
          orderId: res.orderId,
          status: res.status,
          executedQty: res.executedQty,
          cummulativeQuoteQty: res.cummulativeQuoteQty,
        },
      };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.ledger.logEvent('error_event', intent.symbol, { source: 'order.send', message: msg });
      return { sent: false, risk, error: msg };
    }
  }

  async cancel(symbol: string, orderId: number): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) return { ok: false, error: 'Binance keys not configured' };
    this.ledger.logEvent('manual_action', symbol, { action: 'cancel_order', orderId });
    try {
      await this.client.cancelOrder(symbol, orderId);
      this.ledger.logEvent('order_response', symbol, { orderId, status: 'CANCELED', executedQuoteUsd: 0 });
      void this.syncOpenOrders().catch(() => undefined);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.ledger.logEvent('error_event', symbol, { source: 'order.cancel', message: msg });
      return { ok: false, error: msg };
    }
  }

  async syncOpenOrders(): Promise<void> {
    if (!this.client) return;
    this.openOrdersCache = await this.client.openOrders();
    this.lastOrdersSyncTs = Date.now();
  }
}
