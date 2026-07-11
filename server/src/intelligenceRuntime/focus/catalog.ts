import {
  stableId,
  validateInstrumentIdentity,
  type EvidenceKind,
  type ProductFamily,
} from '../../intelligenceFoundation/contracts/index.js';
import type { AttentionAllocation } from '../../intelligenceFoundation/attention/index.js';
import { RUNTIME_ENDPOINTS } from '../contracts/index.js';
import type {
  FocusDeliveredEvidence,
  FocusInstrumentCapability,
  FocusReasonCode,
  FocusResourceTransport,
  FocusRoute,
} from './types.js';

type SupportedProductFamily = Extract<ProductFamily, 'SPOT' | 'USD_M_PERPETUAL'>;

export interface FocusDemand {
  id: string;
  attentionInstrumentId: string;
  symbol: string;
  productFamily: SupportedProductFamily | null;
  evidenceKind: EvidenceKind;
  tier: AttentionAllocation['tier'];
  priority: number | null;
  protected: boolean;
  enteredAtMs: number;
  lastSignalAtMs: number | null;
  transport: FocusResourceTransport;
  route: FocusRoute | null;
  streamOrPath: string | null;
  resourceKey: string | null;
  sourceId: string | null;
  initialReason: FocusReasonCode;
}

function validSymbol(value: string, name: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(symbol)) throw new TypeError(`invalid ${name}`);
  return symbol;
}

function demandId(input: {
  attentionInstrumentId: string;
  productFamily: SupportedProductFamily | null;
  evidenceKind: EvidenceKind;
}): string {
  return stableId('focus-requirement', input);
}

function physicalResourceKey(route: FocusRoute, stream: string): string {
  return stableId('focus-stream', { route, stream });
}

function base(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  productFamily: SupportedProductFamily | null,
  evidenceKind: EvidenceKind,
): Omit<FocusDemand, 'transport' | 'route' | 'streamOrPath' | 'resourceKey' | 'sourceId' | 'initialReason'> {
  return {
    id: demandId({ attentionInstrumentId: allocation.instrumentId, productFamily, evidenceKind }),
    attentionInstrumentId: allocation.instrumentId,
    symbol: validSymbol(capability.symbol || allocation.symbol, 'focus symbol'),
    productFamily,
    evidenceKind,
    tier: allocation.tier,
    priority: allocation.priority,
    protected: allocation.protected,
    enteredAtMs: allocation.enteredAtMs,
    lastSignalAtMs: allocation.lastSignalAtMs,
  };
}

function unavailable(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  evidenceKind: EvidenceKind,
  reason: FocusReasonCode,
  productFamily: SupportedProductFamily | null = null,
): FocusDemand {
  return {
    ...base(allocation, capability, productFamily, evidenceKind),
    transport: 'UNAVAILABLE',
    route: null,
    streamOrPath: null,
    resourceKey: null,
    sourceId: null,
    initialReason: reason,
  };
}

function freshDelivery(
  deliveries: readonly FocusDeliveredEvidence[],
  allocation: AttentionAllocation,
  productFamily: SupportedProductFamily,
  evidenceKind: EvidenceKind,
): FocusDeliveredEvidence | null {
  const matches = deliveries
    .filter((entry) => (
      entry.attentionInstrumentId === allocation.instrumentId &&
      entry.productFamily === productFamily &&
      entry.evidenceKind === evidenceKind &&
      entry.state === 'FRESH'
    ))
    .sort((left, right) => right.observedAtMs - left.observedAtMs || left.sourceId.localeCompare(right.sourceId));
  return matches[0] ?? null;
}

function websocket(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  productFamily: SupportedProductFamily,
  evidenceKind: EvidenceKind,
  route: FocusRoute,
  stream: string,
  sourceId: string,
): FocusDemand {
  return {
    ...base(allocation, capability, productFamily, evidenceKind),
    transport: 'WEBSOCKET',
    route,
    streamOrPath: stream,
    resourceKey: physicalResourceKey(route, stream),
    sourceId,
    initialReason: 'WEBSOCKET_ALLOCATED',
  };
}

function rest(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  productFamily: SupportedProductFamily,
  evidenceKind: EvidenceKind,
  path: string,
  sourceId: string,
): FocusDemand {
  return {
    ...base(allocation, capability, productFamily, evidenceKind),
    transport: 'REST',
    route: null,
    streamOrPath: path,
    resourceKey: null,
    sourceId,
    initialReason: 'PUBLIC_REST_ENRICHMENT_REQUIRED',
  };
}

function reused(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  productFamily: SupportedProductFamily,
  evidenceKind: EvidenceKind,
  delivery: FocusDeliveredEvidence,
): FocusDemand {
  return {
    ...base(allocation, capability, productFamily, evidenceKind),
    transport: 'REUSED_BROAD',
    route: null,
    streamOrPath: null,
    resourceKey: null,
    sourceId: delivery.sourceId,
    initialReason: 'REUSED_BROAD_SOURCE',
  };
}

function validLeg(
  capability: FocusInstrumentCapability,
  family: SupportedProductFamily,
): FocusInstrumentCapability['spot'] {
  const candidate = family === 'SPOT' ? capability.spot : capability.usdMPerpetual;
  if (candidate === null) return null;
  const validated = validateInstrumentIdentity(candidate);
  if (!validated.ok || validated.value.productFamily !== family || validated.value.venue !== 'BINANCE') {
    throw new TypeError(`invalid ${family} focus capability leg`);
  }
  if (validSymbol(validated.value.symbol, 'instrument symbol') !== validSymbol(capability.symbol, 'capability symbol')) {
    throw new TypeError(`mismatched ${family} focus capability symbol`);
  }
  return validated.value;
}

function marketStream(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  deliveries: readonly FocusDeliveredEvidence[],
  family: SupportedProductFamily,
  evidenceKind: Extract<EvidenceKind, 'TRADE' | 'BOOK_TICKER' | 'DEPTH_DELTA'>,
): FocusDemand | null {
  const leg = validLeg(capability, family);
  if (leg === null) return null;
  const delivered = freshDelivery(deliveries, allocation, family, evidenceKind);
  if (delivered !== null) return reused(allocation, capability, family, evidenceKind, delivered);
  const symbol = leg.symbol.toLowerCase();
  if (family === 'SPOT') {
    const suffix = evidenceKind === 'TRADE' ? '@aggTrade' : evidenceKind === 'BOOK_TICKER' ? '@bookTicker' : '@depth@100ms';
    return websocket(
      allocation, capability, family, evidenceKind, 'SPOT_MARKET', `${symbol}${suffix}`, RUNTIME_ENDPOINTS.SPOT_WEBSOCKET.id,
    );
  }
  const suffix = evidenceKind === 'TRADE' ? '@aggTrade' : evidenceKind === 'BOOK_TICKER' ? '@bookTicker' : '@depth@100ms';
  const route: FocusRoute = evidenceKind === 'TRADE' ? 'USD_M_MARKET' : 'USD_M_PUBLIC';
  const sourceId = evidenceKind === 'TRADE'
    ? RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.id
    : RUNTIME_ENDPOINTS.USD_M_PUBLIC_WEBSOCKET.id;
  return websocket(allocation, capability, family, evidenceKind, route, `${symbol}${suffix}`, sourceId);
}

function legDemands(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  deliveries: readonly FocusDeliveredEvidence[],
  evidenceKind: Extract<EvidenceKind, 'TRADE' | 'BOOK_TICKER' | 'DEPTH_DELTA'>,
): FocusDemand[] {
  const demands = (['SPOT', 'USD_M_PERPETUAL'] as const)
    .map((family) => marketStream(allocation, capability, deliveries, family, evidenceKind))
    .filter((entry): entry is FocusDemand => entry !== null);
  return demands.length > 0
    ? demands
    : [unavailable(allocation, capability, evidenceKind, 'NO_ELIGIBLE_PRODUCT_LEG')];
}

function depthSnapshots(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
): FocusDemand[] {
  const output: FocusDemand[] = [];
  if (validLeg(capability, 'SPOT') !== null) {
    output.push(rest(
      allocation, capability, 'SPOT', 'DEPTH_SNAPSHOT', '/api/v3/depth', RUNTIME_ENDPOINTS.SPOT_PUBLIC_REST.id,
    ));
  }
  if (validLeg(capability, 'USD_M_PERPETUAL') !== null) {
    output.push(rest(
      allocation, capability, 'USD_M_PERPETUAL', 'DEPTH_SNAPSHOT', '/fapi/v1/depth', RUNTIME_ENDPOINTS.USD_M_PUBLIC_REST.id,
    ));
  }
  return output.length > 0
    ? output
    : [unavailable(allocation, capability, 'DEPTH_SNAPSHOT', 'NO_ELIGIBLE_PRODUCT_LEG')];
}

function usdMOnly(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  deliveries: readonly FocusDeliveredEvidence[],
  evidenceKind: Extract<EvidenceKind, 'MARK_PRICE' | 'FUNDING' | 'OPEN_INTEREST' | 'LIQUIDATION' | 'CONTEXT'>,
): FocusDemand {
  const leg = validLeg(capability, 'USD_M_PERPETUAL');
  if (leg === null) return unavailable(allocation, capability, evidenceKind, 'NO_ELIGIBLE_PRODUCT_LEG');
  const delivered = freshDelivery(deliveries, allocation, 'USD_M_PERPETUAL', evidenceKind);
  if (delivered !== null) return reused(allocation, capability, 'USD_M_PERPETUAL', evidenceKind, delivered);
  if (evidenceKind === 'OPEN_INTEREST') {
    return rest(
      allocation, capability, 'USD_M_PERPETUAL', evidenceKind, '/fapi/v1/openInterest', RUNTIME_ENDPOINTS.USD_M_PUBLIC_REST.id,
    );
  }
  if (evidenceKind === 'CONTEXT') {
    return rest(
      allocation, capability, 'USD_M_PERPETUAL', evidenceKind, 'public-context-bundle', RUNTIME_ENDPOINTS.USD_M_PUBLIC_REST.id,
    );
  }
  const symbol = leg.symbol.toLowerCase();
  const stream = evidenceKind === 'LIQUIDATION' ? `${symbol}@forceOrder` : `${symbol}@markPrice@1s`;
  return websocket(
    allocation, capability, 'USD_M_PERPETUAL', evidenceKind, 'USD_M_MARKET', stream, RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.id,
  );
}

/** Maps an authoritative allocation profile to concrete current public-only resources. */
export function buildFocusDemands(
  allocation: AttentionAllocation,
  capability: FocusInstrumentCapability,
  deliveries: readonly FocusDeliveredEvidence[],
): FocusDemand[] {
  if (allocation.instrumentId !== capability.attentionInstrumentId) {
    throw new TypeError('focus capability does not match attention allocation');
  }
  if (validSymbol(allocation.symbol, 'allocation symbol') !== validSymbol(capability.symbol, 'capability symbol')) {
    throw new TypeError('focus capability symbol does not match attention allocation');
  }
  const output: FocusDemand[] = [];
  for (const evidenceKind of [...allocation.requestedEvidence].sort()) {
    switch (evidenceKind) {
      case 'TRADE':
      case 'BOOK_TICKER':
      case 'DEPTH_DELTA':
        output.push(...legDemands(allocation, capability, deliveries, evidenceKind));
        break;
      case 'DEPTH_SNAPSHOT':
        output.push(...depthSnapshots(allocation, capability));
        break;
      case 'MARK_PRICE':
      case 'FUNDING':
      case 'OPEN_INTEREST':
      case 'LIQUIDATION':
      case 'CONTEXT':
        output.push(usdMOnly(allocation, capability, deliveries, evidenceKind));
        break;
      case 'BORROW':
        output.push(unavailable(allocation, capability, evidenceKind, 'PRIVATE_ENDPOINT_FORBIDDEN'));
        break;
      default: {
        const exhaustive: never = evidenceKind;
        throw new TypeError(`unsupported evidence kind ${String(exhaustive)}`);
      }
    }
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}
