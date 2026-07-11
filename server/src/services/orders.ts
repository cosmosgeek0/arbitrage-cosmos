import { randomUUID } from 'node:crypto';
import { BinanceApiError, type BinanceClient, type OpenOrder } from '../binance/client.js';
import { boundedBinanceIdentifier } from '../binance/identifiers.js';
import type { SymbolFilters } from '../binance/rest.js';
import type { Ledger, UnresolvedOrderRequest } from '../ledger.js';
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
  outcome?: 'accepted' | 'not_sent' | 'unknown';
  reconciliationRequired?: boolean;
  risk?: RiskDecision;
  error?: string;
  order?: { orderId: number; status: string; executedQty: string; cummulativeQuoteQty: string };
}

export type OrderRecoveryAction = 'hold' | 'confirm_not_sent' | 'confirm_accepted';

export interface OrderRecoveryResolutionInput {
  reservationId: string;
  clientOrderId: string;
  action: OrderRecoveryAction;
  confirm: string;
  reason: string;
  operator: string;
  orderId?: number;
  status?: string;
  executedQty?: number;
  executedQuoteUsd?: number;
}

export interface OrderRecoveryResolutionResult {
  ok: boolean;
  state?: 'held_by_operator' | 'resolved_by_operator';
  reconciliationRequired?: boolean;
  warning?: string;
  error?: string;
}

const MAX_ACCOUNT_SYNC_AGE_MS = 60_000;
const ACCEPTED_ORDER_STATUSES = new Set(['NEW', 'PENDING_NEW', 'PARTIALLY_FILLED', 'FILLED']);
const TERMINAL_REJECTION_STATUSES = new Set(['REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'CANCELED']);
const OPEN_ORDER_TYPES = new Set([
  'LIMIT',
  'MARKET',
  'STOP_LOSS',
  'STOP_LOSS_LIMIT',
  'TAKE_PROFIT',
  'TAKE_PROFIT_LIMIT',
  'LIMIT_MAKER',
]);
const ORDER_RECONCILIATION_CURSOR_KEY = 'orders.reconciliation.cursor';
const ORDER_RECOVERY_BATCH_SIZE = 20;

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parsedNonNegative(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedAuditText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\0]/g, ' ').trim();
  return text.length >= minimum && text.length <= maximum ? text : null;
}

function filtersValid(filters: SymbolFilters): boolean {
  return (
    finitePositive(filters.stepSize) &&
    finitePositive(filters.minQty) &&
    finitePositive(filters.tickSize) &&
    finitePositive(filters.minNotional)
  );
}

function roundToStep(value: number, step: number): number {
  if (!finitePositive(value) || !finitePositive(step)) return Number.NaN;
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
  private orderMutationTail: Promise<void> = Promise.resolve();
  private openOrdersSyncInFlight: Promise<void> | null = null;
  private reconciliationInFlight = new Set<string>();
  private reconciliationCursorId = 0;

  constructor(
    private readonly client: BinanceClient | null,
    private readonly filters: Map<string, SymbolFilters>,
    private readonly priceOf: (symbol: string) => number | null,
    private readonly risk: RiskService,
    private readonly ledger: Ledger,
    private readonly account: AccountService
  ) {
    const storedCursor = Number(this.ledger.getConfigValue(ORDER_RECONCILIATION_CURSOR_KEY));
    if (Number.isSafeInteger(storedCursor) && storedCursor > 0) this.reconciliationCursorId = storedCursor;
  }

  private resolve(intent: OrderIntent, requireFreshMarketPrice = false): {
    errors: string[];
    f: SymbolFilters | null;
    lastPrice: number | null;
    effectivePrice: number | null;
    quantity: number | null;
    estNotionalUsd: number | null;
  } {
    const errors: string[] = [];
    const symbolValid = typeof intent.symbol === 'string' && /^[A-Z0-9]{4,20}$/.test(intent.symbol);
    if (!symbolValid) errors.push('invalid spot symbol');
    if (intent.side !== 'BUY' && intent.side !== 'SELL') errors.push('side must be BUY or SELL');
    if (intent.type !== 'MARKET' && intent.type !== 'LIMIT') errors.push('type must be MARKET or LIMIT');
    if (intent.source !== 'manual' && intent.source !== 'proposal') errors.push('source must be manual or proposal');
    if (intent.timeInForce !== undefined && !['GTC', 'IOC', 'FOK'].includes(intent.timeInForce)) {
      errors.push('invalid time in force');
    }

    let f = symbolValid ? (this.filters.get(intent.symbol) ?? null) : null;
    if (!f) errors.push(`unknown or non-tradable spot symbol: ${intent.symbol}`);
    else if (!filtersValid(f)) {
      errors.push(`invalid exchange filters for ${intent.symbol}`);
      f = null;
    }

    const rawLastPrice = symbolValid ? this.priceOf(intent.symbol) : null;
    const lastPrice = finitePositive(rawLastPrice) ? rawLastPrice : null;
    if (rawLastPrice !== null && lastPrice === null) errors.push('market price is not a finite positive number');
    let effectivePrice = intent.type === 'LIMIT' ? (finitePositive(intent.price) ? intent.price : null) : lastPrice;

    if (intent.type === 'LIMIT' && !finitePositive(intent.price)) {
      errors.push('LIMIT order needs a price');
    }
    if (intent.type === 'LIMIT' && finitePositive(intent.price) && f) {
      const normalizedPrice = roundToStep(intent.price, f.tickSize);
      const tolerance = Math.max(1e-12, f.tickSize * 1e-9);
      if (!finitePositive(normalizedPrice) || Math.abs(normalizedPrice - intent.price) > tolerance) {
        errors.push(`price ${intent.price} is not aligned to tickSize ${f.tickSize}`);
      } else {
        effectivePrice = normalizedPrice;
      }
    }

    const hasQuantity = intent.quantity !== undefined;
    const hasQuoteQty = intent.quoteQty !== undefined;
    if (hasQuantity && hasQuoteQty) errors.push('provide quantity or quote amount, not both');
    if (hasQuantity && !finitePositive(intent.quantity)) errors.push('quantity must be finite and positive');
    if (hasQuoteQty && !finitePositive(intent.quoteQty)) errors.push('quote amount must be finite and positive');

    let quantity: number | null = null;
    let estNotionalUsd: number | null = null;

    if (hasQuoteQty && finitePositive(intent.quoteQty)) {
      if (intent.type !== 'MARKET') errors.push('quote amount is only supported for MARKET orders');
      estNotionalUsd = intent.quoteQty;
      quantity = effectivePrice !== null ? intent.quoteQty / effectivePrice : null;
    } else if (hasQuantity && finitePositive(intent.quantity)) {
      quantity = f ? roundToStep(intent.quantity, f.stepSize) : intent.quantity;
      if (!finitePositive(quantity)) errors.push('quantity rounds to an invalid value');
      if (f && quantity < f.minQty) errors.push(`quantity ${quantity} below minQty ${f.minQty}`);
      estNotionalUsd = effectivePrice !== null ? quantity * effectivePrice : null;
      if (intent.type === 'MARKET' && requireFreshMarketPrice) {
        // Binance may execute above the observed ticker. With a base quantity,
        // the final quote spend is unbounded relative to the hard USD risk cap.
        errors.push('live MARKET orders require a quote amount; base quantity is disabled for bounded notional safety');
      }
    } else {
      errors.push('provide a quantity or a quote amount');
    }

    if (estNotionalUsd !== null && !finitePositive(estNotionalUsd)) {
      errors.push('estimated notional is invalid');
      estNotionalUsd = null;
    }
    if (f && estNotionalUsd !== null && estNotionalUsd < f.minNotional) {
      errors.push(`notional $${estNotionalUsd.toFixed(2)} below Binance minNotional $${f.minNotional}`);
    }
    if (intent.type === 'LIMIT' && effectivePrice === null) errors.push('no valid limit price available');
    if (intent.type === 'MARKET' && hasQuantity && effectivePrice === null) {
      errors.push('no price available for this MARKET base-quantity order');
    }

    return { errors, f, lastPrice, effectivePrice, quantity, estNotionalUsd };
  }

  private buildParams(intent: OrderIntent, quantity: number | null, f: SymbolFilters) {
    const params: Record<string, string | number | undefined> = {
      symbol: intent.symbol,
      side: intent.side,
      type: intent.type,
      newOrderRespType: 'FULL',
    };
    if (intent.type === 'LIMIT') {
      params.timeInForce = intent.timeInForce ?? 'GTC';
      params.price = finitePositive(intent.price) ? roundToStep(intent.price, f.tickSize) : undefined;
      params.quantity = finitePositive(quantity) ? quantity : undefined;
    } else if (finitePositive(intent.quoteQty)) {
      params.quoteOrderQty = intent.quoteQty;
    } else {
      params.quantity = finitePositive(quantity) ? quantity : undefined;
    }
    return params;
  }

  private riskContext(estNotionalUsd: number | null) {
    const loss = this.account.dailyLossPolicy();
    return {
      estNotionalUsd,
      openOrdersCount: this.openOrdersCache.length,
      pendingOpenOrdersNotionalUsd: this.pendingOpenOrdersNotionalUsd(),
      realizedTodayUsd: this.account.realizedTodayUsd(),
      dailyLossPolicyUsd: loss.valueUsd,
      dailyLossPolicyComplete: loss.complete,
      dailyLossPolicyReasons: loss.reasons,
    };
  }

  private pendingOpenOrdersNotionalUsd(): number | null {
    let sum = 0;
    for (const order of this.openOrdersCache) {
      // The service's filter universe is USDT-only. A non-USDT order cannot be
      // valued as dollars from its raw limit price, so fail closed.
      if (!this.filters.has(order.symbol)) return null;
      const original = parsedNonNegative(order.origQty);
      const executed = parsedNonNegative(order.executedQty);
      if (original === null || executed === null || executed > original) return null;
      const remaining = original - executed;
      if (remaining === 0) continue;
      const limitPrice = parsedNonNegative(order.price);
      const price = limitPrice !== null && limitPrice > 0 ? limitPrice : null;
      if (price === null) return null;
      const notional = remaining * price;
      if (!finiteNonNegative(notional)) return null;
      sum += notional;
      if (!Number.isFinite(sum)) return null;
    }
    return sum;
  }

  preview(intent: OrderIntent): PreviewResult {
    const r = this.resolve(intent);
    const risk = this.risk.evaluate(
      intent,
      this.riskContext(r.estNotionalUsd),
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
    const run = this.orderMutationTail
      .then(() => this.sendLocked(intent, confirmSymbol))
      .catch((error) => {
        this.safeLog('error_event', typeof intent?.symbol === 'string' ? intent.symbol : null, {
          source: 'order.admission',
          message: errorMessage(error),
        });
        return { sent: false, outcome: 'not_sent' as const, error: 'Live send was blocked by an internal admission failure.' };
      });
    this.orderMutationTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async sendLocked(intent: OrderIntent, confirmSymbol: string): Promise<SendResult> {
    if (!this.client) return { sent: false, outcome: 'not_sent', error: 'Binance keys not configured' };
    if (confirmSymbol !== intent.symbol) {
      this.ledger.logEvent('manual_action', intent.symbol, {
        action: 'live_send',
        result: 'rejected',
        error: 'typed confirmation did not match symbol',
      });
      return { sent: false, outcome: 'not_sent', error: 'Typed confirmation does not match the symbol.' };
    }

    const r = this.resolve(intent, true);
    if (r.errors.length > 0 || !r.f) return { sent: false, outcome: 'not_sent', error: r.errors.join('; ') };
    this.account.registerFillSymbols([intent.symbol]);

    const postureError = await this.liveAccountPostureError();
    if (postureError) {
      this.safeLog('risk_decision', intent.symbol, {
        stage: 'live_send',
        allowed: false,
        reasons: [`account_posture: ${postureError}`],
      });
      return { sent: false, outcome: 'not_sent', error: `Live send blocked: ${postureError}` };
    }

    const fillCoverage = await this.account.reconcileFills([intent.symbol]);
    if (!fillCoverage.scopeComplete) {
      this.safeLog('risk_decision', intent.symbol, {
        stage: 'live_send',
        allowed: false,
        reasons: [`fill_reconciliation: ${fillCoverage.error ?? 'incomplete'}`],
      });
      return {
        sent: false,
        outcome: 'not_sent',
        error: 'Live send blocked because authoritative fill reconciliation is incomplete.',
      };
    }

    try {
      await this.syncOpenOrders(true);
    } catch (error) {
      const message = errorMessage(error);
      this.safeLog('error_event', intent.symbol, { source: 'order.open_orders_sync', message });
      this.safeLog('risk_decision', intent.symbol, {
        stage: 'live_send',
        allowed: false,
        reasons: ['open_orders_state: authoritative open-order sync failed'],
      });
      return {
        sent: false,
        outcome: 'not_sent',
        error: 'Live send blocked because authoritative open-order state is unavailable.',
      };
    }

    let risk: RiskDecision;
    try {
      risk = this.risk.evaluate(intent, this.riskContext(r.estNotionalUsd), { forLiveSend: true });
      // The decision is part of admission: if the audit record cannot be
      // committed, no exchange request is allowed.
      this.ledger.logEvent('risk_decision', intent.symbol, {
        stage: 'live_send',
        allowed: risk.allowed,
        reasons: risk.reasons,
        estNotionalUsd: r.estNotionalUsd,
      });
    } catch (error) {
      this.safeLog('error_event', intent.symbol, { source: 'order.risk', message: errorMessage(error) });
      return { sent: false, outcome: 'not_sent', error: 'Live send blocked because the risk state could not be committed.' };
    }
    if (!risk.allowed) return { sent: false, outcome: 'not_sent', risk };

    const params = this.buildParams(intent, r.quantity, r.f);
    const reservationId = randomUUID();
    // A deterministic client id makes a timeout/connection-drop outcome
    // reconcilable against Binance order state without resubmitting the order.
    params.newClientOrderId = `c${reservationId.replaceAll('-', '')}`;
    try {
      this.ledger.logEvent('order_request', intent.symbol, {
        reservationId,
        reservedNotionalUsd: r.estNotionalUsd,
        params,
        source: intent.source,
      });
    } catch (error) {
      this.safeLog('error_event', intent.symbol, { source: 'order.reserve', message: errorMessage(error) });
      return { sent: false, outcome: 'not_sent', risk, error: 'Live send blocked because its notional reservation could not be committed.' };
    }

    try {
      const res = await this.client.placeOrder(params);
      const orderId = Number(res?.orderId);
      const expectedClientOrderId = String(params.newClientOrderId);
      const responseClientOrderId = typeof res?.clientOrderId === 'string' ? res.clientOrderId : '';
      const transactTime = Number(res?.transactTime);
      const status = typeof res?.status === 'string' ? res.status : '';
      const executedQty = parsedNonNegative(res?.executedQty);
      const executedQuote = parsedNonNegative(res?.cummulativeQuoteQty);
      const now = Date.now();
      if (
        res?.symbol !== intent.symbol ||
        responseClientOrderId !== expectedClientOrderId ||
        !Number.isInteger(orderId) ||
        orderId <= 0 ||
        !Number.isSafeInteger(transactTime) ||
        transactTime < now - 5 * 60_000 ||
        transactTime > now + 5 * 60_000 ||
        executedQty === null ||
        executedQuote === null
      ) {
        return this.unknownOutcome(intent.symbol, reservationId, expectedClientOrderId, risk, 'Binance returned a malformed or mismatched order acknowledgement.');
      }
      const terminalWithExecution =
        TERMINAL_REJECTION_STATUSES.has(status) && (executedQty > 0 || executedQuote > 0);
      if (TERMINAL_REJECTION_STATUSES.has(status) && !terminalWithExecution) {
        this.ledger.logEvent('order_response', intent.symbol, {
          reservationId,
          reservationReleased: true,
          outcome: 'not_sent',
          orderId,
          clientOrderId: responseClientOrderId,
          transactTime,
          status,
          executedQty: res.executedQty,
          executedQuoteUsd: executedQuote,
          estNotionalUsd: r.estNotionalUsd,
        });
        return { sent: false, outcome: 'not_sent', risk, error: `Binance did not accept the order (${status}).` };
      }
      if (!ACCEPTED_ORDER_STATUSES.has(status) && !terminalWithExecution) {
        return this.unknownOutcome(intent.symbol, reservationId, expectedClientOrderId, risk, `Binance returned an unrecognized order status (${status || 'missing'}).`);
      }

      this.ledger.logEvent('order_response', intent.symbol, {
        reservationId,
        reservationReleased: terminalWithExecution ? false : undefined,
        outcome: terminalWithExecution ? 'accepted_partial_terminal' : 'accepted',
        orderId,
        clientOrderId: responseClientOrderId,
        transactTime,
        status,
        executedQty: res.executedQty,
        executedQuoteUsd: executedQuote,
        estNotionalUsd: r.estNotionalUsd,
      });
      // A terminal acknowledgement with execution is a real fill, never a
      // clean rejection. Reconcile because the inline fill list may be partial.
      let reconciliationRequired = terminalWithExecution;
      let inlineExecutedQty = 0;
      let inlineExecutedQuote = 0;
      for (const fill of res.fills ?? []) {
        const price = parsedNonNegative(fill.price);
        const qty = parsedNonNegative(fill.qty);
        const commission = parsedNonNegative(fill.commission);
        const quoteQty = price !== null && qty !== null ? price * qty : Number.NaN;
        if (
          !Number.isInteger(fill.tradeId) ||
          fill.tradeId < 0 ||
          price === null ||
          price <= 0 ||
          qty === null ||
          qty <= 0 ||
          !finitePositive(quoteQty) ||
          commission === null ||
          typeof fill.commissionAsset !== 'string' ||
          !boundedBinanceIdentifier(fill.commissionAsset, 20, 80)
        ) {
          reconciliationRequired = true;
          this.safeLog('error_event', intent.symbol, {
            source: 'order.fill',
            message: 'Binance returned an invalid fill; account reconciliation is required',
            orderId,
          });
          continue;
        }
        inlineExecutedQty += qty;
        inlineExecutedQuote += quoteQty;
        this.account.recordFill({
          symbol: intent.symbol,
          tradeId: fill.tradeId,
          orderId,
          side: intent.side,
          price,
          qty,
          quoteQty,
          commission,
          commissionAsset: fill.commissionAsset,
          ts: transactTime,
          source: 'order_response',
        });
      }
      const quantityTolerance = Math.max(1e-12, executedQty * 1e-8);
      const quoteTolerance = Math.max(1e-8, executedQuote * 1e-8);
      if (
        Math.abs(inlineExecutedQty - executedQty) > quantityTolerance ||
        Math.abs(inlineExecutedQuote - executedQuote) > quoteTolerance
      ) {
        reconciliationRequired = true;
        this.safeLog('error_event', intent.symbol, {
          source: 'order.fill_completeness',
          message: 'Inline fills did not match the acknowledged execution totals; REST reconciliation is required',
          orderId,
        });
      }
      try {
        await this.syncOpenOrders(true);
      } catch (error) {
        reconciliationRequired = true;
        this.safeLog('error_event', intent.symbol, {
          source: 'order.post_send_open_orders_sync',
          message: errorMessage(error),
          orderId,
        });
      }
      this.refreshAccountInBackground(intent.symbol, orderId);
      if (reconciliationRequired) {
        void this.reconcileUnknownOrder(intent.symbol, reservationId, expectedClientOrderId);
      }
      return {
        sent: true,
        outcome: 'accepted',
        reconciliationRequired,
        risk,
        order: {
          orderId,
          status,
          executedQty: res.executedQty,
          cummulativeQuoteQty: res.cummulativeQuoteQty,
        },
      };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : errorMessage(err);
      if (this.isDefinitiveRejection(err)) {
        try {
          // `order_request` is already durable. A definitive exchange reject
          // may release that reservation only when the correlated response is
          // also durable; best-effort logging would misreport an unresolved
          // financial mutation as a clean non-send.
          this.ledger.logEvent('order_response', intent.symbol, {
            reservationId,
            reservationReleased: true,
            outcome: 'not_sent_rejected',
            status: 'REJECTED',
            executedQuoteUsd: 0,
            estNotionalUsd: r.estNotionalUsd,
            error: msg,
          });
        } catch (auditError) {
          this.safeLog('error_event', intent.symbol, {
            source: 'order.rejection_audit',
            message: errorMessage(auditError),
            reservationId,
          });
          return this.unknownOutcome(
            intent.symbol,
            reservationId,
            String(params.newClientOrderId),
            risk,
            `Binance rejected the order, but the correlated rejection audit could not be committed: ${msg}`,
          );
        }
        return { sent: false, outcome: 'not_sent', risk, error: msg };
      }
      return this.unknownOutcome(intent.symbol, reservationId, String(params.newClientOrderId), risk, msg);
    }
  }

  private isDefinitiveRejection(error: unknown): boolean {
    if (!(error instanceof BinanceApiError)) return false;
    if (error.httpStatus < 400 || error.httpStatus >= 500 || [408, 425, 429].includes(error.httpStatus)) return false;
    // Binance explicitly documents these as states where execution status is
    // unknown and must be reconciled through order/user-stream state.
    if (error.binanceCode === -1006 || error.binanceCode === -1007) return false;
    return true;
  }

  private async liveAccountPostureError(): Promise<string | null> {
    const age = this.account.lastSyncTs === null ? Number.POSITIVE_INFINITY : Date.now() - this.account.lastSyncTs;
    if (
      !this.account.connected ||
      !Number.isFinite(age) ||
      age < -1_000 ||
      age > MAX_ACCOUNT_SYNC_AGE_MS ||
      this.account.keyRestrictions === null
    ) {
      try {
        await this.account.sync();
      } catch (error) {
        this.safeLog('error_event', null, { source: 'order.account_posture', message: errorMessage(error) });
      }
    }

    if (!this.account.connected) return 'the signed account connection is unavailable';
    const refreshedAge = this.account.lastSyncTs === null ? Number.POSITIVE_INFINITY : Date.now() - this.account.lastSyncTs;
    if (!Number.isFinite(refreshedAge) || refreshedAge < -1_000 || refreshedAge > MAX_ACCOUNT_SYNC_AGE_MS) {
      return 'the signed account state is stale';
    }
    const restrictions = this.account.keyRestrictions;
    if (!restrictions) return 'API-key permissions are unknown';
    if (!restrictions.enableReading) return 'the API key does not have reading permission';
    if (!restrictions.enableSpotAndMarginTrading) return 'the API key is not enabled for spot trading';
    if (restrictions.enableWithdrawals) return 'the API key has withdrawals enabled';
    if (restrictions.enableInternalTransfer || restrictions.permitsUniversalTransfer) {
      return 'the API key permits asset transfers';
    }
    return null;
  }

  private unknownOutcome(
    symbol: string,
    reservationId: string,
    clientOrderId: string,
    risk: RiskDecision,
    detail: string
  ): SendResult {
    this.safeLog('order_outcome_unknown', symbol, {
      reservationId,
      reconciliationRequired: true,
      detail,
      clientOrderId,
    });
    this.refreshAccountInBackground(symbol, null);
    void this.reconcileUnknownOrder(symbol, reservationId, clientOrderId);
    return {
      sent: false,
      outcome: 'unknown',
      reconciliationRequired: true,
      risk,
      error: 'Order outcome is unknown. Reconciliation is required before another live order is attempted.',
    };
  }

  private async reconcileUnknownOrder(
    symbol: string,
    reservationId: string,
    clientOrderId: string,
    retry = true,
  ): Promise<void> {
    if (!this.client) return;
    if (this.reconciliationInFlight.has(clientOrderId)) return;
    this.reconciliationInFlight.add(clientOrderId);
    const delays = retry ? [0, 750, 2_500] : [0];
    let lastError = 'order lookup did not complete';
    const attemptId = randomUUID();
    try {
      try {
        this.ledger.logEvent('order_recovery', symbol, {
          reservationId,
          clientOrderId,
          attemptId,
          state: 'reconciling',
          source: retry ? 'post_send_query' : 'scheduled_query',
        });
      } catch (error) {
        this.safeLog('error_event', symbol, {
          source: 'order.recovery_audit',
          message: errorMessage(error),
          reservationId,
          clientOrderId,
        });
        return;
      }
      for (const delay of delays) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const response = await this.client.queryOrder(symbol, clientOrderId);
          const orderId = Number(response?.orderId);
          const executedQty = parsedNonNegative(response?.executedQty);
          const executedQuote = parsedNonNegative(response?.cummulativeQuoteQty);
          const status = typeof response?.status === 'string' ? response.status : '';
          if (
            response?.symbol !== symbol ||
            response?.clientOrderId !== clientOrderId ||
            !Number.isInteger(orderId) ||
            orderId <= 0 ||
            executedQty === null ||
            executedQuote === null ||
            (!ACCEPTED_ORDER_STATUSES.has(status) && !TERMINAL_REJECTION_STATUSES.has(status))
          ) {
            throw new Error('Binance returned a malformed order reconciliation response');
          }
          const noExecution = executedQty === 0 && executedQuote === 0;
          const reservationReleased = TERMINAL_REJECTION_STATUSES.has(status) && noExecution;
          this.ledger.logEventsAtomically([
            {
              kind: 'order_recovery',
              symbol,
              data: {
                reservationId,
                clientOrderId,
                attemptId,
                state: 'resolved_exchange',
                source: 'query_order',
                status,
                orderId,
              },
            },
            {
              kind: 'order_response',
              symbol,
              data: {
                reservationId,
                reservationReleased,
                outcome: reservationReleased ? 'not_sent_reconciled' : 'accepted_reconciled',
                orderId,
                clientOrderId,
                status,
                executedQty,
                executedQuoteUsd: executedQuote,
                reconciliationSource: 'query_order',
              },
            },
          ]);
          try {
            const coverage = await this.account.reconcileFills([symbol]);
            if (!coverage.scopeComplete) {
              this.safeLog('error_event', symbol, {
                source: 'order.reconcile_fills',
                message: coverage.error ?? 'fill reconciliation remained incomplete',
                orderId,
              });
            }
          } catch (error) {
            this.safeLog('error_event', symbol, {
              source: 'order.reconcile_fills',
              message: errorMessage(error),
              orderId,
            });
          }
          try {
            await this.syncOpenOrders(true);
          } catch (error) {
            this.safeLog('error_event', symbol, {
              source: 'order.reconcile_open_orders',
              message: errorMessage(error),
              orderId,
            });
          }
          return;
        } catch (error) {
          lastError = errorMessage(error);
        }
      }
      try {
        this.ledger.logEvent('order_recovery', symbol, {
          reservationId,
          clientOrderId,
          attemptId,
          state: 'operator_review_required',
          source: retry ? 'post_send_query' : 'scheduled_query',
          detail: lastError,
        });
      } catch (error) {
        this.safeLog('error_event', symbol, {
          source: 'order.recovery_audit',
          message: errorMessage(error),
          reservationId,
          clientOrderId,
        });
      }
      this.safeLog('error_event', symbol, {
        source: 'order.reconcile_unknown',
        message: lastError,
        clientOrderId,
      });
    } finally {
      this.reconciliationInFlight.delete(clientOrderId);
    }
  }

  async reconcilePendingOrders(): Promise<void> {
    if (!this.client) return;
    const pendingBatch = this.ledger.unresolvedOrderRequests(
      ORDER_RECOVERY_BATCH_SIZE,
      this.reconciliationCursorId,
    );
    for (const pending of pendingBatch) {
      if (pending.recoveryState !== 'held_by_operator') {
        await this.reconcileUnknownOrder(pending.symbol, pending.reservationId, pending.clientOrderId, false);
      }
      this.reconciliationCursorId = pending.requestId;
      try {
        this.ledger.setConfigValue(ORDER_RECONCILIATION_CURSOR_KEY, String(this.reconciliationCursorId));
      } catch (error) {
        this.safeLog('error_event', pending.symbol, {
          source: 'order.reconciliation_cursor',
          message: errorMessage(error),
          requestId: pending.requestId,
        });
      }
    }
  }

  pendingOrderRecoveries(limit = 100, afterRequestId = 0): UnresolvedOrderRequest[] {
    return this.ledger.unresolvedOrderRequests(limit, afterRequestId, false);
  }

  async resolveOrderRecovery(input: OrderRecoveryResolutionInput): Promise<OrderRecoveryResolutionResult> {
    const run = this.orderMutationTail.then(() => this.resolveOrderRecoveryLocked(input));
    this.orderMutationTail = run.then(() => undefined, () => undefined);
    try {
      return await run;
    } catch (error) {
      this.safeLog('error_event', null, {
        source: 'order.operator_recovery',
        message: errorMessage(error),
      });
      return { ok: false, error: 'Order recovery could not be committed; the request remains fail-closed.' };
    }
  }

  private async resolveOrderRecoveryLocked(
    input: OrderRecoveryResolutionInput,
  ): Promise<OrderRecoveryResolutionResult> {
    const reservationId = typeof input?.reservationId === 'string' ? input.reservationId : '';
    const clientOrderId = typeof input?.clientOrderId === 'string' ? input.clientOrderId : '';
    if (!/^[0-9a-f-]{16,64}$/i.test(reservationId) || !/^[A-Za-z0-9_-]{1,36}$/.test(clientOrderId)) {
      return { ok: false, error: 'A valid reservation and client-order identifier are required.' };
    }
    if (!['hold', 'confirm_not_sent', 'confirm_accepted'].includes(input.action)) {
      return { ok: false, error: 'Invalid order-recovery action.' };
    }
    const reason = boundedAuditText(input.reason, 12, 500);
    const operator = boundedAuditText(input.operator, 1, 160);
    if (!reason || !operator) {
      return { ok: false, error: 'A verified operator and a 12–500 character evidence note are required.' };
    }
    const expectedConfirmation = input.action === 'hold'
      ? `HOLD ${reservationId}`
      : input.action === 'confirm_not_sent'
        ? `CONFIRM NOT SENT ${reservationId}`
        : `CONFIRM ACCEPTED ${reservationId}`;
    if (input.confirm !== expectedConfirmation) {
      return { ok: false, error: `Exact confirmation required: ${expectedConfirmation}` };
    }
    if (this.reconciliationInFlight.has(clientOrderId)) {
      return { ok: false, error: 'Automatic reconciliation is in progress; retry after it completes.' };
    }

    this.reconciliationInFlight.add(clientOrderId);
    try {
      const pending = this.ledger.unresolvedOrderRequest(reservationId, clientOrderId);
      if (!pending) return { ok: false, error: 'The correlated order request is not pending or has already been resolved.' };

      if (input.action === 'hold') {
        this.ledger.logEvent('order_recovery', pending.symbol, {
          reservationId,
          clientOrderId,
          state: 'held_by_operator',
          operator,
          detail: reason,
        });
        return { ok: true, state: 'held_by_operator' };
      }

      const responseData: Record<string, unknown> = {
        reservationId,
        clientOrderId,
        estNotionalUsd: pending.reservedNotionalUsd,
        reconciliationSource: 'operator_verified_binance',
        operator,
        evidence: reason,
      };
      if (input.action === 'confirm_not_sent') {
        Object.assign(responseData, {
          reservationReleased: true,
          outcome: 'not_sent_operator_verified',
          status: 'OPERATOR_CONFIRMED_NOT_SENT',
          executedQuoteUsd: 0,
        });
      } else {
        const orderId = input.orderId;
        const status = typeof input.status === 'string' ? input.status : '';
        const executedQty = input.executedQty;
        const executedQuoteUsd = input.executedQuoteUsd;
        const statusKnown = ACCEPTED_ORDER_STATUSES.has(status) || TERMINAL_REJECTION_STATUSES.has(status);
        const executionKnown = finiteNonNegative(executedQty) && finiteNonNegative(executedQuoteUsd);
        const executionRequired = status === 'PARTIALLY_FILLED'
          || status === 'FILLED'
          || TERMINAL_REJECTION_STATUSES.has(status);
        if (
          !Number.isSafeInteger(orderId)
          || (orderId ?? 0) <= 0
          || !statusKnown
          || !executionKnown
          || (executionRequired && (!finitePositive(executedQty) || !finitePositive(executedQuoteUsd)))
        ) {
          return {
            ok: false,
            error: 'Accepted recovery requires a valid order ID, known status, and internally consistent execution totals.',
          };
        }
        Object.assign(responseData, {
          reservationReleased: false,
          outcome: 'accepted_operator_verified',
          orderId,
          status,
          executedQty,
          executedQuoteUsd,
          reconciliationRequired: true,
        });
      }

      this.ledger.logEventsAtomically([
        {
          kind: 'manual_action',
          symbol: pending.symbol,
          data: {
            action: 'resolve_order_recovery',
            resolution: input.action,
            reservationId,
            clientOrderId,
            operator,
            evidence: reason,
          },
        },
        {
          kind: 'order_recovery',
          symbol: pending.symbol,
          data: {
            reservationId,
            clientOrderId,
            state: 'resolved_by_operator',
            resolution: input.action,
            operator,
            detail: reason,
          },
        },
        { kind: 'order_response', symbol: pending.symbol, data: responseData },
      ]);

      if (input.action === 'confirm_accepted') {
        const refreshIssues: string[] = [];
        try {
          const coverage = await this.account.reconcileFills([pending.symbol]);
          if (!coverage.complete) {
            refreshIssues.push(`fill reconciliation: ${coverage.error ?? 'incomplete'}`);
          }
        } catch (error) {
          refreshIssues.push(`fill reconciliation: ${errorMessage(error)}`);
        }
        if (!this.client) {
          refreshIssues.push('open-order reconciliation: signed order client unavailable');
        } else {
          try {
            await this.syncOpenOrders(true);
            const acceptedStatus = String(responseData.status ?? '');
            const acceptedOrderId = Number(responseData.orderId);
            if (
              ['NEW', 'PENDING_NEW', 'PARTIALLY_FILLED'].includes(acceptedStatus)
              && !this.openOrdersCache.some((order) => order.symbol === pending.symbol && order.orderId === acceptedOrderId)
            ) {
              refreshIssues.push('open-order reconciliation: operator status conflicts with current open-order state');
            }
          } catch (error) {
            refreshIssues.push(`open-order reconciliation: ${errorMessage(error)}`);
          }
        }
        if (refreshIssues.length > 0) {
          const warning = `Operator resolution is durable, but authoritative refresh remains incomplete (${refreshIssues.join('; ')}).`;
          this.safeLog('error_event', pending.symbol, {
            source: 'order.operator_recovery_refresh',
            message: warning,
            reservationId,
            clientOrderId,
          });
          return {
            ok: true,
            state: 'resolved_by_operator',
            reconciliationRequired: true,
            warning,
          };
        }
      }
      return { ok: true, state: 'resolved_by_operator' };
    } finally {
      this.reconciliationInFlight.delete(clientOrderId);
    }
  }

  private refreshAccountInBackground(symbol: string, orderId: number | null): void {
    void this.account.sync().catch((error) => {
      this.safeLog('error_event', symbol, {
        source: 'order.account_refresh',
        message: errorMessage(error),
        orderId,
      });
    });
  }

  private safeLog(kind: string, symbol: string | null, data: unknown): void {
    try {
      this.ledger.logEvent(kind, symbol, data);
    } catch {
      // Best-effort diagnostic paths must not turn a contained background
      // failure into an unhandled rejection. Admission-path audit writes use
      // direct logEvent calls and fail closed instead.
    }
  }

  async cancel(symbol: string, orderId: number): Promise<{
    ok: boolean;
    outcome?: 'canceled' | 'not_canceled' | 'unknown';
    reconciliationRequired?: boolean;
    error?: string;
  }> {
    const run = this.orderMutationTail
      .then(() => this.cancelLocked(symbol, orderId))
      .catch((error) => {
        this.safeLog('error_event', /^[A-Z0-9]{4,20}$/.test(symbol) ? symbol : null, {
          source: 'order.cancel_internal',
          message: errorMessage(error),
          orderId,
        });
        return {
          ok: false,
          outcome: 'unknown' as const,
          reconciliationRequired: true,
          error: 'Cancel outcome is unknown. Reconcile open orders before acting again.',
        };
      });
    this.orderMutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async cancelLocked(symbol: string, orderId: number): Promise<{
    ok: boolean;
    outcome?: 'canceled' | 'not_canceled' | 'unknown';
    reconciliationRequired?: boolean;
    error?: string;
  }> {
    if (!this.client) return { ok: false, outcome: 'not_canceled', error: 'Binance keys not configured' };
    if (!/^[A-Z0-9]{4,20}$/.test(symbol) || !Number.isInteger(orderId) || orderId <= 0) {
      return { ok: false, outcome: 'not_canceled', error: 'Invalid cancel request' };
    }
    this.account.registerFillSymbols([symbol]);
    try {
      this.ledger.logEvent('manual_action', symbol, { action: 'cancel_order', orderId });
    } catch (error) {
      this.safeLog('error_event', symbol, { source: 'order.cancel_admission', message: errorMessage(error), orderId });
      return { ok: false, outcome: 'not_canceled', error: 'Cancel blocked because its audit record could not be committed.' };
    }
    try {
      await this.client.cancelOrder(symbol, orderId);
      this.safeLog('order_response', symbol, { orderId, status: 'CANCELED', executedQuoteUsd: 0 });
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.safeLog('error_event', symbol, { source: 'order.cancel', message: msg });
      if (this.isDefinitiveRejection(err)) return { ok: false, outcome: 'not_canceled', error: msg };
      this.safeLog('cancel_outcome_unknown', symbol, { orderId, reconciliationRequired: true, detail: msg });
      void this.syncOpenOrders().catch((error) => {
        this.safeLog('error_event', symbol, { source: 'order.cancel_reconcile', message: errorMessage(error), orderId });
      });
      return {
        ok: false,
        outcome: 'unknown',
        reconciliationRequired: true,
        error: 'Cancel outcome is unknown. Reconcile open orders before acting again.',
      };
    }
    try {
      await this.syncOpenOrders(true);
      const absent = !this.openOrdersCache.some((order) => order.symbol === symbol && order.orderId === orderId);
      return absent
        ? { ok: true, outcome: 'canceled' }
        : {
            ok: false,
            outcome: 'unknown',
            reconciliationRequired: true,
            error: 'Cancel acknowledgement conflicts with authoritative open-order state.',
          };
    } catch (error) {
      this.safeLog('error_event', symbol, { source: 'order.cancel_refresh', message: errorMessage(error), orderId });
      return {
        ok: false,
        outcome: 'unknown',
        reconciliationRequired: true,
        error: 'Cancel was acknowledged but authoritative reconciliation failed.',
      };
    }
  }

  async cancelAll(symbol: string): Promise<{
    ok: boolean;
    outcome?: 'canceled' | 'not_canceled' | 'unknown';
    reconciliationRequired?: boolean;
    error?: string;
  }> {
    const run = this.orderMutationTail
      .then(() => this.cancelAllLocked(symbol))
      .catch((error) => {
        this.safeLog('error_event', /^[A-Z0-9]{4,20}$/.test(symbol) ? symbol : null, {
          source: 'order.cancel_all_internal',
          message: errorMessage(error),
        });
        return {
          ok: false,
          outcome: 'unknown' as const,
          reconciliationRequired: true,
          error: 'Cancel-all outcome is unknown. Reconcile open orders before acting again.',
        };
      });
    this.orderMutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async cancelAllLocked(symbol: string): Promise<{
    ok: boolean;
    outcome?: 'canceled' | 'not_canceled' | 'unknown';
    reconciliationRequired?: boolean;
    error?: string;
  }> {
    if (!this.client) return { ok: false, outcome: 'not_canceled', error: 'Binance keys not configured' };
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
      return { ok: false, outcome: 'not_canceled', error: 'Invalid cancel-all request' };
    }
    this.account.registerFillSymbols([symbol]);
    try {
      this.ledger.logEvent('manual_action', symbol, { action: 'cancel_all_orders' });
    } catch (error) {
      this.safeLog('error_event', symbol, { source: 'order.cancel_all_admission', message: errorMessage(error) });
      return { ok: false, outcome: 'not_canceled', error: 'Cancel-all blocked because its audit record could not be committed.' };
    }
    try {
      await this.client.cancelAllOrders(symbol);
      this.safeLog('order_response', symbol, { status: 'ALL_CANCELED', executedQuoteUsd: 0 });
    } catch (error) {
      const message = error instanceof BinanceApiError
        ? `Binance ${error.binanceCode}: ${error.message}`
        : errorMessage(error);
      this.safeLog('error_event', symbol, { source: 'order.cancel_all', message });
      if (this.isDefinitiveRejection(error)) return { ok: false, outcome: 'not_canceled', error: message };
      this.safeLog('cancel_outcome_unknown', symbol, {
        allOrders: true,
        reconciliationRequired: true,
        detail: message,
      });
      void this.syncOpenOrders().catch((syncError) => {
        this.safeLog('error_event', symbol, { source: 'order.cancel_all_reconcile', message: errorMessage(syncError) });
      });
      return {
        ok: false,
        outcome: 'unknown',
        reconciliationRequired: true,
        error: 'Cancel-all outcome is unknown. Reconcile open orders before acting again.',
      };
    }
    try {
      await this.syncOpenOrders(true);
      const absent = !this.openOrdersCache.some((order) => order.symbol === symbol);
      return absent
        ? { ok: true, outcome: 'canceled' }
        : {
            ok: false,
            outcome: 'unknown',
            reconciliationRequired: true,
            error: 'Cancel-all acknowledgement conflicts with authoritative open-order state.',
          };
    } catch (error) {
      this.safeLog('error_event', symbol, { source: 'order.cancel_all_refresh', message: errorMessage(error) });
      return {
        ok: false,
        outcome: 'unknown',
        reconciliationRequired: true,
        error: 'Cancel-all was acknowledged but authoritative reconciliation failed.',
      };
    }
  }

  async syncOpenOrders(forceFresh = false): Promise<void> {
    if (!this.client) return;
    if (forceFresh && this.openOrdersSyncInFlight) {
      await this.openOrdersSyncInFlight.catch(() => undefined);
    }
    if (this.openOrdersSyncInFlight) return this.openOrdersSyncInFlight;
    const run = this.syncOpenOrdersOnce();
    this.openOrdersSyncInFlight = run;
    try {
      await run;
    } finally {
      if (this.openOrdersSyncInFlight === run) this.openOrdersSyncInFlight = null;
    }
  }

  private async syncOpenOrdersOnce(): Promise<void> {
    if (!this.client) return;
    const orders = await this.client.openOrders();
    if (!Array.isArray(orders)) throw new Error('Binance open-order payload is invalid');
    for (const order of orders) {
      const valid =
        order !== null &&
        typeof order === 'object' &&
        /^[A-Z0-9]{4,20}$/.test(order.symbol) &&
        Number.isInteger(order.orderId) &&
        order.orderId > 0 &&
        (order.side === 'BUY' || order.side === 'SELL') &&
        OPEN_ORDER_TYPES.has(order.type) &&
        ['NEW', 'PENDING_NEW', 'PARTIALLY_FILLED'].includes(order.status) &&
        parsedNonNegative(order.price) !== null &&
        parsedNonNegative(order.origQty) !== null &&
        parsedNonNegative(order.executedQty) !== null &&
        Number.isInteger(order.time) &&
        order.time > 0;
      if (!valid) throw new Error('Binance open-order payload contains an invalid order');
      const original = parsedNonNegative(order.origQty)!;
      const executed = parsedNonNegative(order.executedQty)!;
      if (executed > original) throw new Error('Binance open-order payload has executed quantity above original quantity');
    }
    this.openOrdersCache = orders;
    this.lastOrdersSyncTs = Date.now();
  }
}
