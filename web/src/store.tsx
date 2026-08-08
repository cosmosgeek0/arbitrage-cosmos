import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { applyPrefs, getPrefs, onPrefs, resolvedTheme, setPref, CURRENCIES, type Prefs } from './lib/prefs';
import { setBasisUnit, setDisplayUtc, setFxRate } from './format';
import { fireRefresh } from './lib/refresh';
import { ApiRequestError, fetchJson, type ApiFailure } from './lib/http';
import { createSettledPoll } from './lib/polling';
import {
  WEB_SOCKET_CLOSE_DIAGNOSTIC_ID,
  reduceTrustedWebSocketCloseDiagnostic,
  webSocketCloseDiagnosticAttributes,
  type WebSocketCloseDiagnostic,
} from './lib/webSocketCloseDiagnostic';
import {
  INITIAL_WEB_SOCKET_PROTOCOL_HEALTH,
  WEB_SOCKET_PROTOCOL_CLOSE_CODE,
  WEB_SOCKET_PROTOCOL_CLOSE_REASON,
  decodeWebSocketProtocolEnvelope,
  reduceWebSocketProtocolHealth,
  type WebSocketProtocolObservation,
} from './lib/webSocketProtocolHealth';
import {
  INITIAL_RECONNECT_BACKOFF_STATE,
  RECONNECT_BACKOFF_STABLE_OPEN_MS,
  planReconnectBackoff,
} from './lib/reconnectBackoff';
import {
  INITIAL_REAL_DATA_CLIENT_TUPLE,
  appliedPrivateReadSource,
  decodeM0SpotReadinessTruth,
  decodePrivateReadSnapshot,
  nextPrivateReadFreshnessExpiry,
  privateReadAccessReasonForStatus,
  projectPrivateReadGuard,
  readPrivateReadStateField,
  reduceRealDataClientTuple,
  type M0SpotReadinessClientTruth,
  type PrivateReadClientTruth,
  type PrivateReadSnapshot,
  type RealDataClientEvent,
  type RealDataClientTuple,
} from './lib/privateRead';
import type {
  AppConfig,
  MarketRow,
  ServerState,
} from './types';

export type RefreshResult = {
  ok: boolean;
  issues: string[];
  ts?: number;
};

export type CompatibilityStateStatus = 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';

export type CompatibilityStateTruth = Readonly<{
  status: CompatibilityStateStatus;
  lastSuccessAtMs: number | null;
  error: string | null;
}>;

export type CompatibilityStateTruthEvent =
  | Readonly<{ kind: 'SUCCESS'; observedAtMs: number }>
  | Readonly<{ kind: 'FAILURE'; observedAtMs: number; error: string }>;

export const INITIAL_COMPATIBILITY_STATE_TRUTH: CompatibilityStateTruth = Object.freeze({
  status: 'LOADING',
  lastSuccessAtMs: null,
  error: null,
});

export function reduceCompatibilityStateTruth(
  current: Readonly<CompatibilityStateTruth>,
  event: Readonly<CompatibilityStateTruthEvent>,
): CompatibilityStateTruth {
  const observedAtMs = Number.isFinite(event.observedAtMs) && event.observedAtMs >= 0
    ? event.observedAtMs
    : null;
  if (event.kind === 'SUCCESS' && observedAtMs !== null) {
    return Object.freeze({ status: 'CURRENT', lastSuccessAtMs: observedAtMs, error: null });
  }
  const error = event.kind === 'FAILURE' && event.error.trim()
    ? event.error.trim()
    : 'Compatibility state refresh failed.';
  return Object.freeze({
    status: current.lastSuccessAtMs === null ? 'UNAVAILABLE' : 'STALE',
    lastSuccessAtMs: current.lastSuccessAtMs,
    error,
  });
}

export type MarketStateTruth = CompatibilityStateTruth;
export type MarketStateTruthEvent = CompatibilityStateTruthEvent;

export const INITIAL_MARKET_STATE_TRUTH: MarketStateTruth = Object.freeze({
  status: 'LOADING',
  lastSuccessAtMs: null,
  error: null,
});

export function reduceMarketStateTruth(
  current: Readonly<MarketStateTruth>,
  event: Readonly<MarketStateTruthEvent>,
): MarketStateTruth {
  const reduced = reduceCompatibilityStateTruth(current, event);
  if (event.kind === 'FAILURE' && reduced.error === 'Compatibility state refresh failed.') {
    return Object.freeze({ ...reduced, error: 'Market refresh failed.' });
  }
  return reduced;
}

export type MarketSourcePublicationState = 'fresh' | 'stale' | 'unavailable';
export type MarketSourcePublicationTruth = Readonly<{
  spotBookTicker: MarketSourcePublicationState;
  futuresBookTicker: MarketSourcePublicationState;
  futures24hTicker: MarketSourcePublicationState;
}>;
export type MarketSnapshotPayload = Readonly<{
  updatedAt?: number;
  streamUpdatedAt?: number | null;
  dataSources: MarketSourcePublicationTruth;
  rows: MarketRow[];
}>;

export type DecodedMarketSnapshot = Readonly<{
  updatedAt: number;
  streamUpdatedAt: number | null | undefined;
  dataSources: MarketSourcePublicationTruth;
  rows: MarketRow[];
  normalizedReceiptIdentity: string;
  publicationError: string | null;
}>;

const MARKET_SOURCE_PUBLICATION_KEYS = Object.freeze([
  'spotBookTicker',
  'futuresBookTicker',
  'futures24hTicker',
] as const);

const UNAVAILABLE_MARKET_FIELDS = Object.freeze({
  spotBookTicker: Object.freeze([
    'spotBid', 'spotAsk', 'spotBidQty', 'spotAskQty', 'spotSpreadPct', 'spotTopQuoteUsd',
  ]),
  futuresBookTicker: Object.freeze([
    'perpBid', 'perpAsk', 'perpBidQty', 'perpAskQty', 'perpSpreadPct', 'perpTopQuoteUsd',
  ]),
  futures24hTicker: Object.freeze([
    'perpLast', 'perpChange24hPct', 'perpVolume24h', 'perpHigh24h', 'perpLow24h',
    'oiToPerpVolume24h',
  ]),
} satisfies Record<keyof MarketSourcePublicationTruth, readonly (keyof MarketRow)[]>);

const EXECUTABLE_BASIS_FIELDS = Object.freeze([
  'executableBasisLongSpotPct',
  'executableBasisShortSpotPct',
  'executableBasisBestPct',
  'executableBasisSide',
] satisfies readonly (keyof MarketRow)[]);

function decodeMarketSourcePublicationTruth(value: unknown): MarketSourcePublicationTruth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Market source truth is missing.');
  }
  const source = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(source);
  const exactKeys = ownKeys.length === MARKET_SOURCE_PUBLICATION_KEYS.length
    && ownKeys.every((key) => (
      typeof key === 'string'
      && MARKET_SOURCE_PUBLICATION_KEYS.includes(
        key as typeof MARKET_SOURCE_PUBLICATION_KEYS[number],
      )
    ));
  const invalid = MARKET_SOURCE_PUBLICATION_KEYS.filter((key) => (
    source[key] !== 'fresh' && source[key] !== 'stale' && source[key] !== 'unavailable'
  ));
  if (!exactKeys || invalid.length > 0) {
    const unexpected = ownKeys.filter((key) => (
      typeof key !== 'string'
      || !MARKET_SOURCE_PUBLICATION_KEYS.includes(
        key as typeof MARKET_SOURCE_PUBLICATION_KEYS[number],
      )
    ));
    const details = [...invalid, ...unexpected.map(String)];
    throw new TypeError(`Market source truth is invalid: ${details.join(', ') || 'key set'}.`);
  }
  return Object.freeze({
    spotBookTicker: source.spotBookTicker as MarketSourcePublicationState,
    futuresBookTicker: source.futuresBookTicker as MarketSourcePublicationState,
    futures24hTicker: source.futures24hTicker as MarketSourcePublicationState,
  });
}

/**
 * A 200 response proves only that the publication endpoint answered. It does
 * not make retained exchange facts current. The paired stream timestamp owns
 * row liveness; REST source labels remain structural enrichment truth and are
 * still fail-closed when an older server cannot publish that timestamp.
 */
export function marketSnapshotTruthEvent(
  dataSources: unknown,
  observedAtMs: number,
  streamUpdatedAt?: unknown,
  staleAfterMs?: number,
): MarketStateTruthEvent {
  let source: MarketSourcePublicationTruth;
  try {
    source = decodeMarketSourcePublicationTruth(dataSources);
  } catch (cause) {
    return Object.freeze({
      kind: 'FAILURE',
      observedAtMs,
      error: cause instanceof Error ? cause.message : 'Market source truth is invalid.',
    });
  }
  const nonFresh = MARKET_SOURCE_PUBLICATION_KEYS.filter((key) => source[key] !== 'fresh');
  if (streamUpdatedAt !== undefined) {
    const sourceTimeMs = normalizeMarketSourceTime(streamUpdatedAt);
    const sourceAgeMs = sourceTimeMs === null ? null : observedAtMs - sourceTimeMs;
    if (sourceAgeMs === null
      || sourceAgeMs < 0
      || !Number.isFinite(staleAfterMs)
      || staleAfterMs! <= 0
      || sourceAgeMs >= staleAfterMs!) {
      return Object.freeze({
        kind: 'FAILURE',
        observedAtMs,
        error: 'Public market stream is not current.',
      });
    }
    return Object.freeze({ kind: 'SUCCESS', observedAtMs });
  }
  if (nonFresh.length > 0) {
    return Object.freeze({
      kind: 'FAILURE',
      observedAtMs,
      error: `Market sources are not current: ${nonFresh
        .map((key) => `${key}=${String(source[key])}`)
        .join(', ')}.`,
    });
  }
  return Object.freeze({ kind: 'SUCCESS', observedAtMs });
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Invalid non-finite market response number');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') return undefined;
  if (ancestors.has(value)) throw new TypeError('Invalid cyclic market response');
  ancestors.add(value);
  let encoded: string;
  if (Array.isArray(value)) {
    encoded = `[${value.map((entry) => canonicalJson(entry, ancestors) ?? 'null').join(',')}]`;
  } else {
    const fields = Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const child = canonicalJson((value as Record<string, unknown>)[key], ancestors);
        return child === undefined ? [] : [`${JSON.stringify(key)}:${child}`];
      });
    encoded = `{${fields.join(',')}}`;
  }
  ancestors.delete(value);
  return encoded;
}

/** Decode and normalize one immutable server-owned market receipt. */
export function decodeMarketSnapshot(
  payload: unknown,
  observedAtMs: number,
  maximumAgeMs: number,
): DecodedMarketSnapshot {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Invalid market response');
  }
  if (!Number.isFinite(observedAtMs) || observedAtMs <= 0) {
    throw new TypeError('Invalid market observation time');
  }
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0) {
    throw new TypeError('Invalid market maximum age');
  }
  const candidate = payload as Partial<MarketSnapshotPayload>;
  const updatedAt = normalizeMarketSourceTime(candidate.updatedAt);
  if (updatedAt === null) throw new TypeError('Market updatedAt is missing or invalid.');
  if (updatedAt > observedAtMs) throw new TypeError('Market updatedAt is in the future.');
  if (!Array.isArray(candidate.rows)) throw new TypeError('Invalid market response');

  const hasStreamUpdatedAt = Object.hasOwn(candidate, 'streamUpdatedAt');
  let streamUpdatedAt: number | null | undefined;
  if (!hasStreamUpdatedAt) {
    streamUpdatedAt = undefined;
  } else if (candidate.streamUpdatedAt === null) {
    streamUpdatedAt = null;
  } else {
    streamUpdatedAt = normalizeMarketSourceTime(candidate.streamUpdatedAt);
    if (streamUpdatedAt === null) throw new TypeError('Market streamUpdatedAt is invalid.');
  }

  const dataSources = decodeMarketSourcePublicationTruth(candidate.dataSources);
  const rows = candidate.rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('Invalid market row');
    }
    const projected: MarketRow = { ...row };
    for (const sourceKey of MARKET_SOURCE_PUBLICATION_KEYS) {
      if (dataSources[sourceKey] !== 'unavailable') continue;
      for (const field of UNAVAILABLE_MARKET_FIELDS[sourceKey]) {
        (projected as unknown as Record<string, unknown>)[field] = null;
      }
    }
    if (dataSources.spotBookTicker === 'unavailable'
        || dataSources.futuresBookTicker === 'unavailable') {
      for (const field of EXECUTABLE_BASIS_FIELDS) {
        (projected as unknown as Record<string, unknown>)[field] = null;
      }
    }
    return projected;
  });
  const sourceTruthEvent = marketSnapshotTruthEvent(
    dataSources,
    observedAtMs,
    streamUpdatedAt,
    maximumAgeMs,
  );
  const unavailableSources = MARKET_SOURCE_PUBLICATION_KEYS.filter((key) => (
    dataSources[key] === 'unavailable'
  ));
  const publicationError = unavailableSources.length > 0
    ? `Market sources are unavailable: ${unavailableSources.join(', ')}.`
    : sourceTruthEvent.kind === 'FAILURE'
      ? sourceTruthEvent.error
      : null;
  const normalizedReceiptIdentity = canonicalJson({
    updatedAt,
    streamUpdatedAt,
    dataSources,
    rows,
  });
  if (normalizedReceiptIdentity === undefined) throw new TypeError('Invalid market response');

  return Object.freeze({
    updatedAt,
    streamUpdatedAt,
    dataSources,
    rows,
    normalizedReceiptIdentity,
    publicationError,
  });
}

export type MarketAdmissionErrorKind = 'NONE' | 'TRANSIENT' | 'PUBLICATION' | 'CONFLICT';

export type MarketAdmissionState = Readonly<{
  rows: MarketRow[];
  updatedAt: number | null;
  dataSources: MarketSourcePublicationTruth | null;
  normalizedReceiptIdentity: string | null;
  truth: MarketStateTruth;
  errorKind: MarketAdmissionErrorKind;
}>;

export type MarketAdmissionObservation =
  | Readonly<{
      kind: 'RECEIPT';
      payload: unknown;
      observedAtMs: number;
      maximumAgeMs: number;
    }>
  | Readonly<{
      kind: 'FAILURE';
      observedAtMs: number;
      error: string;
    }>;

export type MarketAdmissionDisposition =
  | 'FAILURE'
  | 'OLDER_IGNORED'
  | 'EQUAL_IDENTICAL_CURRENT'
  | 'EQUAL_IDENTICAL_NON_CURRENT'
  | 'CONFLICT'
  | 'NEWER_CURRENT'
  | 'NEWER_NON_CURRENT';

export type MarketAdmissionResult = Readonly<{
  state: MarketAdmissionState;
  disposition: MarketAdmissionDisposition;
}>;

export const INITIAL_MARKET_ADMISSION_STATE: MarketAdmissionState = Object.freeze({
  rows: [] as MarketRow[],
  updatedAt: null,
  dataSources: null,
  normalizedReceiptIdentity: null,
  truth: INITIAL_MARKET_STATE_TRUTH,
  errorKind: 'NONE',
});

function failedMarketAdmission(
  current: MarketAdmissionState,
  observedAtMs: number,
  error: string,
): MarketAdmissionResult {
  if (current.errorKind === 'CONFLICT') {
    return Object.freeze({ state: current, disposition: 'FAILURE' });
  }
  const normalizedError = typeof error === 'string' && error.trim()
    ? error.trim()
    : 'Market refresh failed.';
  const truth = reduceMarketStateTruth(current.truth, {
    kind: 'FAILURE',
    observedAtMs,
    error: normalizedError,
  });
  return Object.freeze({
    state: Object.freeze({
      ...current,
      truth,
      errorKind: 'TRANSIENT',
    }),
    disposition: 'FAILURE',
  });
}

function retainedMarketTruth(
  current: MarketAdmissionState,
  receipt: DecodedMarketSnapshot,
  observedAtMs: number,
): Pick<MarketAdmissionState, 'truth' | 'errorKind'> {
  if (receipt.publicationError === null && current.truth.lastSuccessAtMs !== null) {
    return {
      truth: Object.freeze({
        status: 'CURRENT',
        lastSuccessAtMs: current.truth.lastSuccessAtMs,
        error: null,
      }),
      errorKind: 'NONE',
    };
  }
  return {
    truth: reduceMarketStateTruth(current.truth, {
      kind: 'FAILURE',
      observedAtMs,
      error: receipt.publicationError ?? 'Market receipt has no admitted success timestamp.',
    }),
    errorKind: 'PUBLICATION',
  };
}

function replacedMarketTruth(
  current: MarketAdmissionState,
  receipt: DecodedMarketSnapshot,
  observedAtMs: number,
): Pick<MarketAdmissionState, 'truth' | 'errorKind'> {
  if (receipt.publicationError === null) {
    return {
      truth: Object.freeze({ status: 'CURRENT', lastSuccessAtMs: observedAtMs, error: null }),
      errorKind: 'NONE',
    };
  }
  return {
    truth: reduceMarketStateTruth(current.truth, {
      kind: 'FAILURE',
      observedAtMs,
      error: receipt.publicationError ?? 'Market sources are not current.',
    }),
    errorKind: 'PUBLICATION',
  };
}

function candidateMarketSourceTime(payload: unknown, observedAtMs: number): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  try {
    const updatedAt = normalizeMarketSourceTime((payload as { updatedAt?: unknown }).updatedAt);
    return updatedAt !== null && updatedAt <= observedAtMs ? updatedAt : null;
  } catch {
    return null;
  }
}

/** Sole monotonic transition for polled and manual market completions. */
export function reduceMarketAdmission(
  current: MarketAdmissionState,
  observation: MarketAdmissionObservation,
): MarketAdmissionResult {
  if (observation.kind === 'FAILURE') {
    return failedMarketAdmission(current, observation.observedAtMs, observation.error);
  }

  const candidateTime = candidateMarketSourceTime(observation.payload, observation.observedAtMs);
  if (candidateTime !== null && current.updatedAt !== null && candidateTime < current.updatedAt) {
    return Object.freeze({ state: current, disposition: 'OLDER_IGNORED' });
  }
  if (candidateTime !== null && current.updatedAt === candidateTime
      && current.errorKind === 'CONFLICT') {
    return Object.freeze({ state: current, disposition: 'CONFLICT' });
  }

  let receipt: DecodedMarketSnapshot;
  try {
    receipt = decodeMarketSnapshot(
      observation.payload,
      observation.observedAtMs,
      observation.maximumAgeMs,
    );
  } catch (cause) {
    return failedMarketAdmission(
      current,
      observation.observedAtMs,
      cause instanceof Error ? cause.message : 'Invalid market response',
    );
  }

  if (current.updatedAt !== null && receipt.updatedAt < current.updatedAt) {
    return Object.freeze({ state: current, disposition: 'OLDER_IGNORED' });
  }
  if (current.updatedAt === receipt.updatedAt) {
    if (current.normalizedReceiptIdentity !== receipt.normalizedReceiptIdentity) {
      const error = `Market receipt conflict at updatedAt ${receipt.updatedAt}.`;
      return Object.freeze({
        state: Object.freeze({
          ...current,
          truth: reduceMarketStateTruth(current.truth, {
            kind: 'FAILURE',
            observedAtMs: observation.observedAtMs,
            error,
          }),
          errorKind: 'CONFLICT',
        }),
        disposition: 'CONFLICT',
      });
    }
    const retained = retainedMarketTruth(current, receipt, observation.observedAtMs);
    return Object.freeze({
      state: Object.freeze({
        ...current,
        truth: retained.truth,
        errorKind: retained.errorKind,
      }),
      disposition: retained.truth.status === 'CURRENT'
          && retained.truth.lastSuccessAtMs !== null
        ? 'EQUAL_IDENTICAL_CURRENT'
        : 'EQUAL_IDENTICAL_NON_CURRENT',
    });
  }

  const replaced = replacedMarketTruth(current, receipt, observation.observedAtMs);
  return Object.freeze({
    state: Object.freeze({
      rows: receipt.rows,
      updatedAt: receipt.updatedAt,
      dataSources: receipt.dataSources,
      normalizedReceiptIdentity: receipt.normalizedReceiptIdentity,
      truth: replaced.truth,
      errorKind: replaced.errorKind,
    }),
    disposition: receipt.publicationError === null
      ? 'NEWER_CURRENT'
      : 'NEWER_NON_CURRENT',
  });
}

export type MarketFreshnessStatus = 'ERROR' | 'UNKNOWN' | 'DISCONNECTED' | 'LIVE' | 'STALE';

export type MarketFreshnessTruth = Readonly<{
  status: MarketFreshnessStatus;
  live: boolean;
  ageMs: number | null;
}>;

export function normalizeMarketSourceTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveMarketFreshness(input: Readonly<{
  connected: boolean;
  error: string | null;
  sourceTimeMs: number | null;
  nowMs: number;
  staleAfterMs: number;
}>): MarketFreshnessTruth {
  if (input.error) return Object.freeze({ status: 'ERROR', live: false, ageMs: null });
  const sourceTimeMs = normalizeMarketSourceTime(input.sourceTimeMs);
  if (sourceTimeMs === null || !Number.isFinite(input.nowMs) || sourceTimeMs > input.nowMs) {
    return Object.freeze({ status: 'UNKNOWN', live: false, ageMs: null });
  }
  const ageMs = input.nowMs - sourceTimeMs;
  const staleAfterMs = Number.isFinite(input.staleAfterMs) && input.staleAfterMs > 0
    ? input.staleAfterMs
    : 0;
  if (ageMs < staleAfterMs) return Object.freeze({ status: 'LIVE', live: true, ageMs });
  return Object.freeze({ status: 'STALE', live: false, ageMs });
}

// Account detail ids render controlled, read-only Account subviews. Product
// truth remains in ProductControlRoomProvider; this store owns navigation only.
export type Page =
  | 'dashboard'
  | 'control-room'
  | 'account'
  | 'wallets'
  | 'markets'
  | 'detail'
  | 'loans'
  | 'execution'
  | 'orders'
  | 'positions'
  | 'fills'
  | 'pnl'
  | 'strategies'
  | 'volume'
  | 'opportunities'
  | 'risk'
  | 'ledger'
  | 'system'
  | 'watchdog'
  | 'notifications'
  | 'news'
  | 'calendar'
  | 'research-lab';

const PAGE_IDS: Page[] = [
  'dashboard', 'control-room', 'account', 'wallets', 'markets', 'detail', 'loans', 'execution', 'orders',
  'positions', 'fills', 'pnl', 'strategies', 'volume', 'opportunities', 'risk', 'ledger', 'system',
  'watchdog', 'notifications', 'news', 'calendar', 'research-lab',
];

export function isPageId(value: unknown): value is Page {
  return typeof value === 'string' && PAGE_IDS.includes(value as Page);
}

// ---- durable URL <-> page routing ----------------------------------------
// The address bar is the durable owner of the visible page and, for Token
// Detail, of the symbol. localStorage stays as compatibility memory for the
// pre-routing shell's last symbol only; it never outranks the URL. Every helper
// below is pure; the only impure edges (read/push/replace) are injected so the
// whole contract is provable without a DOM.

export const CANONICAL_DASHBOARD_PATH = '/dashboard';
export const TOKEN_ROUTE_PREFIX = 'token';
export const ACCOUNT_ROUTE_PREFIX = 'account';
export const DEFAULT_DETAIL_SYMBOL = 'BTCUSDT';
export const ACTIVE_PAGE_STORAGE_KEY = 'cosmos-active-page';
export const DETAIL_SYMBOL_STORAGE_KEY = 'cosmos-detail-symbol';

// Keep browser routing inside the exact symbol domain accepted by the Token
// owner endpoints. A canonical route must not select a workspace whose every
// backend read is guaranteed to reject.
const TOKEN_SYMBOL_PATTERN = /^[A-Z0-9]{5,20}$/;

// Account subview ids render one controlled Account page (DESIGN.md §3), so
// their canonical paths stay nested under /account.
const ACCOUNT_SUBVIEW_PAGES: Readonly<Record<string, Page>> = Object.freeze({
  overview: 'account',
  wallets: 'wallets',
  execution: 'execution',
  orders: 'orders',
  positions: 'positions',
  fills: 'fills',
  pnl: 'pnl',
});

const PAGE_PATHS: Readonly<Record<Exclude<Page, 'detail'>, string>> = Object.freeze({
  dashboard: CANONICAL_DASHBOARD_PATH,
  'control-room': '/control-room',
  account: '/account',
  wallets: '/account/wallets',
  markets: '/markets',
  loans: '/borrow',
  execution: '/account/execution',
  orders: '/account/orders',
  positions: '/account/positions',
  fills: '/account/fills',
  pnl: '/account/pnl',
  strategies: '/basis',
  volume: '/volume',
  opportunities: '/opportunities',
  risk: '/risk',
  ledger: '/logs',
  system: '/health',
  watchdog: '/watchdog',
  notifications: '/notifications',
  news: '/news',
  calendar: '/calendar',
  'research-lab': '/research-lab',
});

const SINGLE_SEGMENT_PAGES: Readonly<Record<string, Page>> = Object.freeze({
  dashboard: 'dashboard',
  'control-room': 'control-room',
  account: 'account',
  markets: 'markets',
  borrow: 'loans',
  basis: 'strategies',
  volume: 'volume',
  opportunities: 'opportunities',
  risk: 'risk',
  logs: 'ledger',
  health: 'system',
  watchdog: 'watchdog',
  notifications: 'notifications',
  news: 'news',
  calendar: 'calendar',
  'research-lab': 'research-lab',
  // Legacy internal ids remain accepted only as normalized aliases.
  wallets: 'wallets',
  loans: 'loans',
  strategies: 'strategies',
  ledger: 'ledger',
  system: 'system',
});

export type RouteTarget = Readonly<{ page: Page; detailSymbol: string | null }>;

export type RouteParseStatus = 'CANONICAL' | 'NORMALIZED' | 'UNKNOWN';

export type RouteParse = Readonly<{ status: RouteParseStatus; target: RouteTarget | null }>;

const UNKNOWN_ROUTE_PARSE: RouteParse = Object.freeze({ status: 'UNKNOWN', target: null });

export function canonicalizeTokenSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const symbol = value.trim().toUpperCase();
  return TOKEN_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function routeTarget(page: Page, detailSymbol: unknown = null): RouteTarget {
  return Object.freeze({ page, detailSymbol: canonicalizeTokenSymbol(detailSymbol) });
}

/**
 * The canonical path for a target. A detail target without a valid symbol has
 * no honest token path, so it deterministically serializes to the dashboard
 * rather than inventing a symbol.
 */
export function serializeRoute(target: Readonly<{ page: Page; detailSymbol?: unknown }>): string {
  if (target.page === 'detail') {
    const symbol = canonicalizeTokenSymbol(target.detailSymbol);
    return symbol === null ? CANONICAL_DASHBOARD_PATH : `/${TOKEN_ROUTE_PREFIX}/${symbol}`;
  }
  return PAGE_PATHS[target.page] ?? CANONICAL_DASHBOARD_PATH;
}

function routeSegments(pathname: string): string[] | null {
  const [pathOnly = ''] = pathname.split(/[?#]/, 1);
  const segments: string[] = [];
  for (const raw of pathOnly.split('/')) {
    if (raw.length === 0) continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return segments;
}

function matchRouteTarget(segments: readonly string[]): RouteTarget | null {
  if (segments.length === 1) {
    const id = segments[0].toLowerCase();
    const page = SINGLE_SEGMENT_PAGES[id];
    return page === undefined ? null : routeTarget(page);
  }
  if (segments.length !== 2) return null;
  const prefix = segments[0].toLowerCase();
  if (prefix === TOKEN_ROUTE_PREFIX) {
    const symbol = canonicalizeTokenSymbol(segments[1]);
    return symbol === null ? null : routeTarget('detail', symbol);
  }
  if (prefix === ACCOUNT_ROUTE_PREFIX) {
    const subview = ACCOUNT_SUBVIEW_PAGES[segments[1].toLowerCase()];
    return subview === undefined ? null : routeTarget(subview);
  }
  return null;
}

/** Parses a browser pathname; root normalizes to Dashboard and unknown paths fail there. */
export function parseRoutePath(pathname: unknown): RouteParse {
  if (typeof pathname !== 'string') return UNKNOWN_ROUTE_PARSE;
  const segments = routeSegments(pathname);
  if (segments === null) return UNKNOWN_ROUTE_PARSE;
  const target = segments.length === 0 ? routeTarget('dashboard') : matchRouteTarget(segments);
  if (target === null) return UNKNOWN_ROUTE_PARSE;
  const [pathOnly = ''] = pathname.split(/[?#]/, 1);
  return Object.freeze({
    status: serializeRoute(target) === pathOnly ? 'CANONICAL' : 'NORMALIZED',
    target,
  });
}

export function resolveInitialRouteTarget(pathname: unknown, memory: RouteTarget): RouteTarget {
  const parsed = parseRoutePath(pathname);
  if (parsed.status === 'UNKNOWN' || parsed.target === null) {
    return mergeRouteTarget(routeTarget('dashboard'), memory);
  }
  return mergeRouteTarget(parsed.target, memory);
}

/**
 * Compatibility memory: the page the owner was last on, then their configured
 * default page, then the dashboard. The URL outranks all three.
 */
export function resolveMemoryRouteTarget(input: Readonly<{
  savedPage?: unknown;
  savedSymbol?: unknown;
  defaultPage?: unknown;
}>): RouteTarget {
  const page = isPageId(input.savedPage)
    ? input.savedPage
    : isPageId(input.defaultPage)
      ? input.defaultPage
      : 'dashboard';
  return Object.freeze({
    page,
    detailSymbol: canonicalizeTokenSymbol(input.savedSymbol) ?? DEFAULT_DETAIL_SYMBOL,
  });
}

function mergeRouteTarget(next: RouteTarget, current: RouteTarget): RouteTarget {
  const detailSymbol = canonicalizeTokenSymbol(next.detailSymbol)
    ?? canonicalizeTokenSymbol(current.detailSymbol)
    ?? DEFAULT_DETAIL_SYMBOL;
  return Object.freeze({ page: next.page, detailSymbol });
}

export type RoutePathIo = Readonly<{
  readPath: () => string;
  pushPath: (path: string) => void;
  replacePath: (path: string) => void;
}>;

export type DurableRouteController = Readonly<{
  resolveInitial: (memory: RouteTarget) => RouteTarget;
  navigate: (next: RouteTarget, current: RouteTarget) => RouteTarget;
  resolvePop: (current: RouteTarget) => RouteTarget;
}>;

export function createDurableRouteController(io: RoutePathIo): DurableRouteController {
  const failToDashboard = (current: RouteTarget): RouteTarget => {
    const target = mergeRouteTarget(routeTarget('dashboard'), current);
    io.replacePath(CANONICAL_DASHBOARD_PATH);
    return target;
  };

  const resolveInitial = (memory: RouteTarget): RouteTarget => {
    const parsed = parseRoutePath(io.readPath());
    if (parsed.status === 'UNKNOWN') return failToDashboard(memory);
    if (parsed.target === null) return failToDashboard(memory);
    const target = mergeRouteTarget(parsed.target, memory);
    if (parsed.status !== 'CANONICAL') io.replacePath(serializeRoute(target));
    return target;
  };

  const navigate = (next: RouteTarget, current: RouteTarget): RouteTarget => {
    const target = mergeRouteTarget(next, current);
    const path = serializeRoute(target);
    // Re-selecting the visible route is not a history event.
    if (path !== io.readPath()) io.pushPath(path);
    return target;
  };

  // A popped entry is already in history: it may be repaired with replaceState
  // but never pushed, or Back would stop working.
  const resolvePop = (current: RouteTarget): RouteTarget => {
    const parsed = parseRoutePath(io.readPath());
    if (parsed.status === 'UNKNOWN' || parsed.target === null) {
      return failToDashboard(current);
    }
    const target = mergeRouteTarget(parsed.target, current);
    if (parsed.status !== 'CANONICAL') io.replacePath(serializeRoute(target));
    return target;
  };

  return Object.freeze({ resolveInitial, navigate, resolvePop });
}

const BROWSER_ROUTE_PATH_IO: RoutePathIo = Object.freeze({
  readPath: () => window.location.pathname,
  pushPath: (path: string) => window.history.pushState(null, '', path),
  replacePath: (path: string) => window.history.replaceState(null, '', path),
});

// ---- Product supervisor release identity ---------------------------------
// The footer states which release is actually deployed. Only deployment facts
// count: a tested commit or a schema revision is not deployment identity.

export const RELEASE_IDENTITY_UNKNOWN_TEXT = 'Release Identity Unknown';
const RELEASE_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_IDENTITY_SHORT_LENGTH = 12;

export type ReleaseIdentityFact = Readonly<{
  id: 'deployed' | 'config';
  label: string;
  display: string;
  exact: string;
}>;

export type ReleaseIdentityTruth = Readonly<{
  state: 'PRESENT' | 'PARTIAL' | 'UNKNOWN';
  facts: readonly ReleaseIdentityFact[];
  fallbackText: string | null;
}>;

function releaseIdentityValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function releaseIdentityFact(id: 'deployed' | 'config', label: string, value: unknown): ReleaseIdentityFact | null {
  const exact = releaseIdentityValue(value);
  if (exact === null) return null;
  const display = RELEASE_COMMIT_SHA_PATTERN.test(exact)
    ? exact.slice(0, RELEASE_IDENTITY_SHORT_LENGTH)
    : exact;
  return Object.freeze({ id, label, display, exact });
}

/**
 * Projects the supervisor revision set into footer identity facts. Absent
 * facts are omitted rather than rendered as a placeholder, and an identity
 * with neither deployment fact renders the exact unknown text.
 */
export function resolveReleaseIdentityTruth(revisions: unknown): ReleaseIdentityTruth {
  const source = revisions && typeof revisions === 'object' && !Array.isArray(revisions)
    ? revisions as Record<string, unknown>
    : null;
  const facts = [
    releaseIdentityFact('deployed', 'Deployed', source?.deployedCommit),
    releaseIdentityFact('config', 'Config', source?.configRevision),
  ].filter((fact): fact is ReleaseIdentityFact => fact !== null);
  return Object.freeze({
    state: facts.length === 2 ? 'PRESENT' : facts.length === 1 ? 'PARTIAL' : 'UNKNOWN',
    facts: Object.freeze(facts),
    fallbackText: facts.length === 0 ? RELEASE_IDENTITY_UNKNOWN_TEXT : null,
  });
}

interface Store {
  state: ServerState | null;
  stateStatus: CompatibilityStateStatus;
  stateLastSuccessAtMs: number | null;
  stateError: string | null;
  privateRead: PrivateReadSnapshot;
  privateReadSource: 'PENDING' | 'STATE' | 'FALLBACK';
  privateReadError: string | null;
  privateReadClient: PrivateReadClientTruth;
  m0SpotReadiness: M0SpotReadinessClientTruth;
  realDataClient: RealDataClientTuple;
  markets: MarketRow[];
  marketStatus: CompatibilityStateStatus;
  marketsLastSuccessAtMs: number | null;
  marketsUpdatedAt: number | null;
  marketsError: string | null;
  mutationError: ApiFailure | null;
  fxTruth: FxTruth;
  fxBusy: boolean;
  refreshFx: () => void;
  connected: boolean;
  dataNonce: number;
  refresh: () => Promise<RefreshResult>;
  page: Page;
  setPage: (p: Page) => void;
  detailSymbol: string;
  openDetail: (symbol: string) => void;
  openLedger: (symbol: string) => void;
  prefs: Prefs;
  updatePref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  toggleWatch: (symbol: string) => Promise<ApiFailure | null>;
  saveConfig: (patch: Partial<AppConfig>) => Promise<AppConfig | null>;
}

const StoreContext = createContext<Store | null>(null);

export const FX_MAX_SOURCE_AGE_MS = 30 * 60_000;
export type FxTruthStatus = 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';
export type FxTruth = Readonly<{
  status: FxTruthStatus;
  rates: Readonly<Record<string, number>>;
  sourceTimeMs: number | null;
  lastSuccessAtMs: number | null;
  error: string | null;
}>;
export type FxTruthEvent =
  | Readonly<{ kind: 'SUCCESS'; observedAtMs: number; payload: Readonly<{ rates?: Record<string, number>; fetchedAt?: number }> }>
  | Readonly<{ kind: 'FAILURE'; observedAtMs: number; error: string }>;

export const INITIAL_FX_TRUTH: FxTruth = Object.freeze({
  status: 'LOADING', rates: Object.freeze({}), sourceTimeMs: null, lastSuccessAtMs: null, error: null,
});

export function reduceFxTruth(current: FxTruth, event: FxTruthEvent): FxTruth {
  if (event.kind === 'FAILURE') {
    return Object.freeze({
      ...current,
      status: current.lastSuccessAtMs === null ? 'UNAVAILABLE' : 'STALE',
      error: event.error.trim() || 'FX refresh failed.',
    });
  }
  const observedAtMs = Number.isFinite(event.observedAtMs) ? event.observedAtMs : 0;
  const sourceTimeMs = Number.isFinite(event.payload.fetchedAt) && Number(event.payload.fetchedAt) > 0
    ? Number(event.payload.fetchedAt)
    : null;
  const rates = Object.fromEntries(Object.entries(event.payload.rates ?? {}).filter(([, rate]) => Number.isFinite(rate) && rate > 0));
  const fresh = sourceTimeMs !== null
    && sourceTimeMs <= observedAtMs
    && observedAtMs - sourceTimeMs <= FX_MAX_SOURCE_AGE_MS
    && Object.keys(rates).length > 0;
  return Object.freeze({
    status: fresh ? 'CURRENT' : Object.keys(rates).length > 0 ? 'STALE' : 'UNAVAILABLE',
    rates: Object.freeze(rates),
    sourceTimeMs,
    lastSuccessAtMs: fresh ? observedAtMs : current.lastSuccessAtMs,
    error: fresh ? null : 'FX source is stale or invalid.',
  });
}

export function resolveFxRate(
  truth: FxTruth,
  currency: string,
  nowMs: number,
): Readonly<{ status: FxTruthStatus; rate: number | null }> {
  if (currency === 'USD') return Object.freeze({ status: 'CURRENT', rate: 1 });
  const rate = truth.rates[currency];
  const current = truth.status === 'CURRENT'
    && truth.sourceTimeMs !== null
    && nowMs >= truth.sourceTimeMs
    && nowMs - truth.sourceTimeMs <= FX_MAX_SOURCE_AGE_MS
    && Number.isFinite(rate)
    && rate > 0;
  if (current) return Object.freeze({ status: 'CURRENT', rate });
  const status = truth.status === 'LOADING'
    ? 'LOADING'
    : truth.lastSuccessAtMs !== null || Number.isFinite(rate)
      ? 'STALE'
      : 'UNAVAILABLE';
  return Object.freeze({ status, rate: null });
}

// ---- live order-book stream (Token Detail) -------------------------------
// Rides the same /ws socket as canonical invalidations and material-event
// pages. One symbol at a time; the server opens a Binance depth20@100ms +
// aggTrade stream while subscribed.
export type LiveBookMsg =
  | { type: 'book'; symbol: string; bids: [string, string][]; asks: [string, string][]; ts: number }
  | { type: 'btrades'; symbol: string; trades: { id: number; price: number; qty: number; time: number; isBuyerMaker: boolean }[] };

let liveWs: WebSocket | null = null;
let liveBookSymbol: string | null = null;
const liveBookListeners = new Set<(m: LiveBookMsg) => void>();

function sendLiveSub(): void {
  if (liveWs?.readyState === WebSocket.OPEN) {
    liveWs.send(JSON.stringify(liveBookSymbol ? { type: 'sub-book', symbol: liveBookSymbol } : { type: 'unsub-book' }));
  }
}

export function subscribeLiveBook(symbol: string, fn: (m: LiveBookMsg) => void): () => void {
  liveBookListeners.add(fn);
  liveBookSymbol = symbol;
  sendLiveSub();
  return () => {
    liveBookListeners.delete(fn);
    if (liveBookListeners.size === 0) {
      liveBookSymbol = null;
      sendLiveSub();
    }
  };
}
// ---------------------------------------------------------------------------

type MutationResult<T> = { data: T; error: null } | { data: null; error: ApiFailure };

export type MutationFailureTruthEvent =
  | Readonly<{ kind: 'REJECTED'; failure: ApiFailure }>
  | Readonly<{ kind: 'ACKNOWLEDGED' }>;

export function reduceMutationFailureTruth(
  current: ApiFailure | null,
  event: MutationFailureTruthEvent,
): ApiFailure | null {
  if (event.kind === 'ACKNOWLEDGED') return null;
  return event.failure ?? current;
}

function mutationFailure(error: unknown): ApiFailure {
  if (error instanceof ApiRequestError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  return {
    status: 0,
    code: 'NETWORK_ERROR',
    message: error instanceof Error && error.message ? error.message : 'Network request failed',
  };
}

/** HTTP admission outranks an arbitrary response-body error code. */
function privateReadFailure(error: unknown): ApiFailure {
  const failure = mutationFailure(error);
  const accessReason = error instanceof ApiRequestError
    ? privateReadAccessReasonForStatus(error.status)
    : null;
  return accessReason === null ? failure : { ...failure, code: accessReason };
}

function acknowledgementFailure(message: string): ApiFailure {
  return { status: 502, code: 'INVALID_ACKNOWLEDGEMENT', message };
}

function isConfigAcknowledgement(value: unknown): value is AppConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<AppConfig>;
  return (
    typeof config.killSwitch === 'boolean' &&
    typeof config.liveTradingEnabled === 'boolean' &&
    typeof config.fundsLocked === 'boolean' &&
    typeof config.automationPaused === 'boolean' &&
    Array.isArray(config.allowedSymbols) &&
    Array.isArray(config.blockedSymbols) &&
    Array.isArray(config.watchlist) &&
    Boolean(config.controlModes && typeof config.controlModes === 'object') &&
    Boolean(config.borrowGuard && typeof config.borrowGuard === 'object')
  );
}

function isCanonicalSupervisorDeltaMessage(value: unknown): value is Readonly<{
  type: 'canonical-supervisor-delta';
  payload: Readonly<{ schemaVersion: 'canonical-supervisor-delta.v1'; revision: string }>;
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type !== 'canonical-supervisor-delta'
      || !message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return false;
  const payload = message.payload as Record<string, unknown>;
  return payload.schemaVersion === 'canonical-supervisor-delta.v1'
    && typeof payload.revision === 'string'
    && payload.revision.length > 0
    && payload.revision.length <= 256
    && ['LIVE_PUBLIC', 'WIRED', 'BUILT_AND_TESTED', 'IMPORTED', 'SYNTHETIC_ONLY', 'BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN'].includes(String(payload.truthLabel))
    && ['STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED'].includes(String(payload.overallPosture))
    && (payload.firstRootBlockerComponentId === null
      || (typeof payload.firstRootBlockerComponentId === 'string'
        && payload.firstRootBlockerComponentId.length > 0
        && payload.firstRootBlockerComponentId.length <= 128))
    && Number.isSafeInteger(payload.runtimeGeneration)
    && Number(payload.runtimeGeneration) >= 0
    && Number.isSafeInteger(payload.controlGeneration)
    && Number(payload.controlGeneration) >= 0
    && Number.isSafeInteger(payload.controlRevision)
    && Number(payload.controlRevision) >= 0
    && ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(String(payload.safeMode))
    && typeof payload.killSwitchEngaged === 'boolean'
    && typeof payload.intakePaused === 'boolean';
}

function isDecimalWebSocketCursor(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d{0,18})$/.test(value)
    && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function isMaterialEventPageMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type !== 'material-event-page'
      || !message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return false;
  const payload = message.payload as Record<string, unknown>;
  if (!isDecimalWebSocketCursor(payload.afterCursor)
      || !isDecimalWebSocketCursor(payload.nextCursor)
      || BigInt(payload.nextCursor) < BigInt(payload.afterCursor)
      || !Array.isArray(payload.events)
      || payload.events.length > 200
      || !payload.events.every((event) => Boolean(event && typeof event === 'object' && !Array.isArray(event)))
      || !['CONTINUOUS', 'GAP_REQUIRES_BACKFILL', 'TRUNCATED_REQUIRES_BACKFILL'].includes(String(payload.continuity))
      || typeof payload.hasMore !== 'boolean') return false;
  const missingFrom = payload.missingFromCursor;
  const missingTo = payload.missingToCursor;
  return (missingFrom === null && missingTo === null)
    || (isDecimalWebSocketCursor(missingFrom)
      && isDecimalWebSocketCursor(missingTo)
      && BigInt(missingFrom) <= BigInt(missingTo));
}

function isPositiveNumericString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isBookLevel(value: unknown): value is [string, string] {
  return Array.isArray(value)
    && value.length === 2
    && isPositiveNumericString(value[0])
    && isPositiveNumericString(value[1]);
}

function isLiveBookMessage(value: unknown): value is LiveBookMsg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (typeof message.symbol !== 'string' || !/^[A-Z0-9]{2,32}$/.test(message.symbol)) return false;
  if (message.type === 'book') {
    if (!Array.isArray(message.bids) || message.bids.length < 1 || message.bids.length > 20
        || !Array.isArray(message.asks) || message.asks.length < 1 || message.asks.length > 20
        || !message.bids.every(isBookLevel) || !message.asks.every(isBookLevel)
        || !Number.isSafeInteger(message.ts) || Number(message.ts) <= 0) return false;
    return Number(message.bids[0][0]) < Number(message.asks[0][0]);
  }
  if (message.type !== 'btrades'
      || !Array.isArray(message.trades)
      || message.trades.length < 1
      || message.trades.length > 400) return false;
  let previousId = -1;
  for (const trade of message.trades) {
    if (!trade || typeof trade !== 'object' || Array.isArray(trade)) return false;
    const row = trade as Record<string, unknown>;
    if (!Number.isSafeInteger(row.id) || Number(row.id) <= previousId
        || !Number.isFinite(row.price) || Number(row.price) <= 0
        || !Number.isFinite(row.qty) || Number(row.qty) <= 0
        || !Number.isSafeInteger(row.time) || Number(row.time) <= 0
        || typeof row.isBuyerMaker !== 'boolean') return false;
    previousId = Number(row.id);
  }
  return true;
}

function isKnownWebSocketEnvelope(value: unknown): boolean {
  return isCanonicalSupervisorDeltaMessage(value)
    || isMaterialEventPageMessage(value)
    || isLiveBookMessage(value);
}

function failClosedConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    liveTradingEnabled: false,
    fundsLocked: true,
    automationPaused: true,
    controlModes: {
      ...config.controlModes,
      funds: 'blocked',
      borrowing: 'blocked',
      automation: 'paused',
      liveOrders: 'blocked',
    },
    borrowGuard: {
      ...config.borrowGuard,
      enabled: true,
      newBorrowPaused: true,
      repayOnly: true,
    },
  };
}

export function failClosedState(serverState: ServerState): ServerState {
  const config = failClosedConfig(serverState.config);
  // A compatibility payload without the canonical control snapshot is not
  // evidence that the kill is clear. Treat missing or malformed truth as halt.
  // The slim view publishes the posture directly; the full view still carries it
  // inside the canonical projection. Both are read here so either document is
  // judged by the same rule, and a document carrying neither still halts.
  const canonicalKillEngaged = (
    serverState.killSwitchEngaged ?? serverState.canonicalSupervisor?.control?.killSwitchEngaged
  ) !== false;
  const hasCompletePrivateAccountReadback = serverState.account != null && Array.isArray(serverState.positions);
  const privateAccountTruth = !serverState.binance.keysPresent || serverState.privateAccountTruth === 'NOT_CONFIGURED'
    ? 'NOT_CONFIGURED'
    : serverState.privateAccountTruth === 'AVAILABLE' && hasCompletePrivateAccountReadback
      ? 'AVAILABLE'
      : 'UNAVAILABLE';
  const privateOrderTruth = privateAccountTruth !== 'AVAILABLE'
    ? privateAccountTruth
    : serverState.privateOrderTruth === 'AVAILABLE' && Array.isArray(serverState.openOrders)
      ? 'AVAILABLE'
      : 'UNAVAILABLE';
  return {
    ...serverState,
    mode: config.killSwitch || canonicalKillEngaged ? 'HALTED' : 'MANUAL',
    config,
    privateAccountTruth,
    privateOrderTruth,
    account: privateAccountTruth === 'AVAILABLE' ? serverState.account : null,
    positions: privateAccountTruth === 'AVAILABLE' ? serverState.positions : null,
    openOrders: privateOrderTruth === 'AVAILABLE' ? serverState.openOrders : null,
  };
}

async function post<T>(url: string, body: unknown): Promise<MutationResult<T>> {
  try {
    const data = await fetchJson<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 12_000);
    return { data, error: null };
  } catch (error) {
    return { data: null, error: mutationFailure(error) };
  }
}

type WatchlistAcknowledgement = Readonly<Pick<AppConfig, 'watchlist'>>;

export type SerializedWatchlistMutationQueue = Readonly<{
  synchronize: (watchlist: readonly string[]) => void;
  enqueue: (symbol: string) => Promise<WatchlistAcknowledgement | null>;
}>;

/**
 * Serializes complete-watchlist writes and keeps an acknowledgement-backed
 * shadow while a batch is pending. The config API does not expose a revision
 * or compare-and-swap token, so sending the next mutation only after the
 * preceding acknowledgement is the client-side ordering authority.
 */
export function createSerializedWatchlistMutationQueue(
  initialWatchlist: readonly string[],
  submit: (watchlist: readonly string[]) => Promise<WatchlistAcknowledgement | null>,
): SerializedWatchlistMutationQueue {
  let acknowledgedWatchlist = [...initialWatchlist];
  let pendingCount = 0;
  let tail: Promise<void> = Promise.resolve();

  const synchronize = (watchlist: readonly string[]) => {
    if (pendingCount === 0) acknowledgedWatchlist = [...watchlist];
  };

  const enqueue = (symbol: string): Promise<WatchlistAcknowledgement | null> => {
    pendingCount += 1;
    const operation = tail.then(async () => {
      const current = acknowledgedWatchlist;
      const next = current.includes(symbol)
        ? current.filter((entry) => entry !== symbol)
        : [...current, symbol];
      const acknowledgement = await submit(Object.freeze([...next]));
      if (acknowledgement) acknowledgedWatchlist = [...acknowledgement.watchlist];
      return acknowledgement;
    });
    tail = operation.then(
      () => { pendingCount -= 1; },
      () => { pendingCount -= 1; },
    );
    return operation;
  };

  return Object.freeze({ synchronize, enqueue });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState | null>(null);
  const [stateTruth, setStateTruth] = useState<CompatibilityStateTruth>(
    INITIAL_COMPATIBILITY_STATE_TRUTH,
  );
  const [realDataClient, setRealDataClient] = useState<RealDataClientTuple>(
    INITIAL_REAL_DATA_CLIENT_TUPLE,
  );
  const [privateReadFreshnessTick, bumpPrivateReadFreshness] = useState(0);
  const [marketAdmission, setMarketAdmission] = useState<MarketAdmissionState>(
    INITIAL_MARKET_ADMISSION_STATE,
  );
  const markets = marketAdmission.rows;
  const marketTruth = marketAdmission.truth;
  const marketsUpdatedAt = marketAdmission.updatedAt;
  const marketsError = marketAdmission.truth.error;
  const [mutationError, setMutationError] = useState<ApiFailure | null>(null);
  const [fxTruth, setFxTruth] = useState<FxTruth>(INITIAL_FX_TRUTH);
  const [fxBusy, setFxBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    applyPrefs();
    const p = getPrefs();
    setDisplayUtc(p.timezone === 'utc');
    setBasisUnit(p.basisUnit);
    return p;
  });
  // The URL owns the visible page and the Token Detail symbol. localStorage
  // retains only the previous symbol; root and unknown URLs resolve to the
  // canonical dashboard without inheriting a remembered page.
  const routeControllerRef = useRef<DurableRouteController | null>(null);
  if (!routeControllerRef.current) {
    routeControllerRef.current = createDurableRouteController(BROWSER_ROUTE_PATH_IO);
  }
  const routeController = routeControllerRef.current;
  const [route, setRoute] = useState<RouteTarget>(() => {
    const memory = resolveMemoryRouteTarget({
      savedPage: localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY),
      savedSymbol: localStorage.getItem(DETAIL_SYMBOL_STORAGE_KEY),
      defaultPage: getPrefs().defaultPage,
    });
    return resolveInitialRouteTarget(window.location.pathname, memory);
  });
  const routeRef = useRef<RouteTarget>(route);
  const page = route.page;
  const detailSymbol = route.detailSymbol ?? DEFAULT_DETAIL_SYMBOL;
  const [dataNonce, setDataNonce] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [webSocketCloseDiagnostic, setWebSocketCloseDiagnostic] = useState<WebSocketCloseDiagnostic | null>(null);
  const [, bumpFx] = useState(0);
  const fxPollRef = useRef<ReturnType<typeof createSettledPoll> | null>(null);
  const m0ReadinessPollRef = useRef<ReturnType<typeof createSettledPoll> | null>(null);
  const m0ReadinessRefreshRef = useRef<(() => Promise<boolean>) | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<(() => void) | null>(null);
  const privateReadCadenceRef = useRef<(() => void) | null>(null);
  const watchlistMutationQueueRef = useRef<SerializedWatchlistMutationQueue | null>(null);
  const marketAdmissionRef = useRef<MarketAdmissionState>(INITIAL_MARKET_ADMISSION_STATE);

  const admitMarketCompletion = useCallback((observation: MarketAdmissionObservation) => {
    const previous = marketAdmissionRef.current;
    const result = reduceMarketAdmission(previous, observation);
    if (result.state !== previous) {
      marketAdmissionRef.current = result.state;
      setMarketAdmission(result.state);
    }
    return result;
  }, []);

  // Private snapshots are ordered by the id assigned when their request left
  // the browser, so a slow earlier answer can never overwrite newer account
  // truth no matter which caller (socket delta, cadence, manual refresh) won.
  const privateReadRequestRef = useRef(0);
  const m0ReadinessRequestRef = useRef(0);
  const nextPrivateReadRequestId = useCallback(() => {
    privateReadRequestRef.current += 1;
    return privateReadRequestRef.current;
  }, []);
  const nextM0ReadinessRequestId = useCallback(() => {
    m0ReadinessRequestRef.current += 1;
    return m0ReadinessRequestRef.current;
  }, []);

  const dispatchRealDataClient = useCallback((event: RealDataClientEvent) => {
    setRealDataClient((current) => reduceRealDataClientTuple(current, event));
  }, []);

  const acceptPrivateReadFromState = useCallback((snapshot: ServerState, requestId: number) => {
    const field = readPrivateReadStateField(snapshot);
    dispatchRealDataClient({
      kind: 'PRIVATE_STATE_RESULT',
      requestId,
      observedAtMs: Date.now(),
      field,
    });
    return field.presence === 'PRESENT'
      && decodePrivateReadSnapshot(field.value) !== null;
  }, [dispatchRealDataClient]);

  // One FX owner feeds both global formatters and the operator sheet. Cached
  // rates remain diagnostic evidence after failure, but never current truth.
  useEffect(() => {
    const poll = createSettledPoll<{ rates?: Record<string, number>; fetchedAt?: number }>({
      intervalMs: Math.max(0.5, prefs.dataCadence?.fx ?? 300) * 1_000,
      request: (signal) => {
        setFxBusy(true);
        return fetchJson('/api/fx', { signal });
      },
      onSuccess: (d) => {
        setFxTruth((current) => reduceFxTruth(current, { kind: 'SUCCESS', observedAtMs: Date.now(), payload: d }));
        setFxBusy(false);
      },
      onError: (cause) => {
        setFxTruth((current) => reduceFxTruth(current, {
          kind: 'FAILURE', observedAtMs: Date.now(), error: mutationFailure(cause).message,
        }));
        setFxBusy(false);
      },
    });
    fxPollRef.current = poll;
    poll.start();
    return () => {
      if (fxPollRef.current === poll) fxPollRef.current = null;
      poll.stop();
    };
  }, [prefs.dataCadence?.fx]);

  useEffect(() => {
    const cur = prefs.currency || 'USD';
    const sym = CURRENCIES[cur]?.symbol ?? '$';
    const resolved = resolveFxRate(fxTruth, cur, Date.now());
    setFxRate(resolved.rate, sym, resolved.status === 'CURRENT');
    bumpFx((n) => n + 1);
    if (fxTruth.status !== 'CURRENT' || fxTruth.sourceTimeMs === null) return;
    const delayMs = Math.max(0, fxTruth.sourceTimeMs + FX_MAX_SOURCE_AGE_MS - Date.now() + 1);
    const timer = window.setTimeout(() => {
      setFxTruth((current) => current.status === 'CURRENT' && current.sourceTimeMs === fxTruth.sourceTimeMs
        ? reduceFxTruth(current, { kind: 'FAILURE', observedAtMs: Date.now(), error: 'FX source expired.' })
        : current);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [fxTruth, prefs.currency]);

  const refreshFx = useCallback(() => {
    if (!fxPollRef.current) return;
    setFxBusy(true);
    fxPollRef.current.refresh();
  }, []);

  useEffect(() => onPrefs((p) => {
    setPrefs(p);
    setDisplayUtc(p.timezone === 'utc');
    setBasisUnit(p.basisUnit);
  }), []);

  // follow system theme changes when theme = system
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => {
      const current = getPrefs();
      if (current.theme === 'system' || current.motion === 'system') applyPrefs();
    };
    mq.addEventListener('change', fn);
    motionMq.addEventListener('change', fn);
    return () => {
      mq.removeEventListener('change', fn);
      motionMq.removeEventListener('change', fn);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: number | null = null;
    let stableOpenTimer: number | null = null;
    let reconnectBackoff = INITIAL_RECONNECT_BACKOFF_STATE;
    let generation = 0;
    let stateRefreshInFlight = false;
    let stateRefreshQueued = false;
    let stateRefreshController: AbortController | null = null;
    const requestCompatibilityState = (trigger: 'DELTA' | 'CADENCE' = 'DELTA') => {
      if (closed) return;
      if (stateRefreshInFlight) {
        // A cadence tick never queues a second read: the in-flight one already
        // answers it. Only a supervisor delta invalidates a read that started
        // before the delta, so only a delta may queue follow-up work.
        if (trigger === 'DELTA') stateRefreshQueued = true;
        return;
      }
      stateRefreshInFlight = true;
      const requestId = nextPrivateReadRequestId();
      const controller = new AbortController();
      stateRefreshController = controller;
      void fetchJson<ServerState>('/api/state?view=slim', { cache: 'no-store', signal: controller.signal })
        .then((snapshot) => {
          if (!closed && !controller.signal.aborted) {
            setState(failClosedState(snapshot));
            acceptPrivateReadFromState(snapshot, requestId);
            setStateTruth((current) => reduceCompatibilityStateTruth(current, {
              kind: 'SUCCESS',
              observedAtMs: Date.now(),
            }));
          }
        })
        .catch((cause) => {
          if (!closed && !controller.signal.aborted) {
            const failure = privateReadFailure(cause);
            dispatchRealDataClient({
              kind: 'PRIVATE_STATE_FAILURE',
              requestId,
              observedAtMs: Date.now(),
              failure: { code: failure.code, message: failure.message },
            });
            setStateTruth((current) => reduceCompatibilityStateTruth(current, {
              kind: 'FAILURE',
              observedAtMs: Date.now(),
              error: failure.message,
            }));
          }
        })
        .finally(() => {
          if (stateRefreshController === controller) stateRefreshController = null;
          stateRefreshInFlight = false;
          if (!closed && stateRefreshQueued) {
            stateRefreshQueued = false;
            requestCompatibilityState('DELTA');
          }
        });
    };
    privateReadCadenceRef.current = () => requestCompatibilityState('CADENCE');
    requestCompatibilityState('DELTA');
    const clearRetry = () => {
      if (retry !== null) window.clearTimeout(retry);
      retry = null;
    };
    const clearStableOpenTimer = () => {
      if (stableOpenTimer !== null) window.clearTimeout(stableOpenTimer);
      stableOpenTimer = null;
    };
    const closeCurrent = () => {
      clearStableOpenTimer();
      const previous = wsRef.current;
      wsRef.current = null;
      if (liveWs === previous) liveWs = null;
      if (!previous) return;
      previous.onopen = null;
      previous.onmessage = null;
      previous.onclose = null;
      previous.onerror = null;
      if (previous.readyState === WebSocket.CONNECTING || previous.readyState === WebSocket.OPEN) previous.close();
    };
    const scheduleConnect = (delay: number) => {
      clearRetry();
      if (closed) return;
      retry = window.setTimeout(() => {
        retry = null;
        connect();
      }, delay);
    };
    function connect() {
      if (closed) return;
      clearRetry();
      closeCurrent();
      const socketGeneration = ++generation;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socketUrl = new URL(`${proto}://${location.host}/ws`);
      // ProductControlRoomProvider owns material continuity over its bounded
      // HTTP lane. The compatibility/book socket does not opt into a separate
      // material stream that it does not consume.
      const ws = new WebSocket(socketUrl.toString());
      let connectionEstablished = false;
      let openedAtMonotonicMs: number | null = null;
      let protocolHealth = INITIAL_WEB_SOCKET_PROTOCOL_HEALTH;
      const applyProtocolObservation = (observation: WebSocketProtocolObservation) => {
        protocolHealth = reduceWebSocketProtocolHealth(protocolHealth, observation);
        if (protocolHealth.status === 'DEGRADED') setConnected(false);
        else if (connectionEstablished) setConnected(true);
        return protocolHealth;
      };
      wsRef.current = ws;
      liveWs = ws;
      ws.onopen = () => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        connectionEstablished = true;
        openedAtMonotonicMs = performance.now();
        protocolHealth = INITIAL_WEB_SOCKET_PROTOCOL_HEALTH;
        setConnected(true);
        sendLiveSub(); // re-attach any live book subscription after reconnect
        clearStableOpenTimer();
        stableOpenTimer = window.setTimeout(() => {
          stableOpenTimer = null;
          if (closed || socketGeneration !== generation || wsRef.current !== ws
              || ws.readyState !== WebSocket.OPEN) return;
          reconnectBackoff = INITIAL_RECONNECT_BACKOFF_STATE;
        }, RECONNECT_BACKOFF_STABLE_OPEN_MS);
      };
      ws.onmessage = (msg) => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        const decoded = decodeWebSocketProtocolEnvelope(msg.data, isKnownWebSocketEnvelope);
        if (!decoded.ok) {
          const degraded = applyProtocolObservation('INVALID_ENVELOPE');
          if (degraded.reconnectRequired && ws.readyState === WebSocket.OPEN) {
            ws.close(WEB_SOCKET_PROTOCOL_CLOSE_CODE, WEB_SOCKET_PROTOCOL_CLOSE_REASON);
          }
          return;
        }
        applyProtocolObservation('VALID_ENVELOPE');
        const data = decoded.value;
        // ProductControlRoomProvider owns canonical supervisor refreshes.
        // A supervisor delta must not invalidate compatibility /api/state or
        // owner timestamp revisions create a two-second feedback loop.
        if (isCanonicalSupervisorDeltaMessage(data)) {
          // Protocol-valid connection evidence only.
        } else if (isLiveBookMessage(data)) {
          for (const fn of liveBookListeners) fn(data);
        }
        // Material-event cursor consumption stays with the existing Product
        // Control Room binding; this compatibility store never advances it.
      };
      ws.onclose = (event) => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        setWebSocketCloseDiagnostic((current) => reduceTrustedWebSocketCloseDiagnostic(
          current,
          event,
          socketGeneration,
          connectionEstablished,
        ));
        clearStableOpenTimer();
        wsRef.current = null;
        if (liveWs === ws) liveWs = null;
        setConnected(false);
        const plan = planReconnectBackoff(reconnectBackoff, {
          entropySample: Math.random(),
          openDurationMs: openedAtMonotonicMs === null
            ? null
            : Math.max(0, performance.now() - openedAtMonotonicMs),
        });
        reconnectBackoff = plan.next;
        scheduleConnect(plan.delayMs);
      };
      ws.onerror = () => {
        if (socketGeneration === generation && wsRef.current === ws) ws.close();
      };
    }
    reconnectRef.current = () => {
      generation += 1;
      clearRetry();
      closeCurrent();
      setConnected(false);
      scheduleConnect(80);
    };
    connect();

    return () => {
      closed = true;
      generation += 1;
      clearRetry();
      stateRefreshController?.abort();
      stateRefreshController = null;
      stateRefreshQueued = false;
      privateReadCadenceRef.current = null;
      reconnectRef.current = null;
      closeCurrent();
      setConnected(false);
    };
  }, [acceptPrivateReadFromState, dispatchRealDataClient, nextPrivateReadRequestId]);

  // A mounted consumer must cross the same freshness boundary even when no
  // socket delta or transport completion causes another render. This timer
  // expires evidence only; it performs no request and renews no timestamp.
  useEffect(() => {
    const now = Date.now();
    const nextExpiryAt = nextPrivateReadFreshnessExpiry(
      realDataClient.privateRead.snapshot,
      now,
    );
    if (nextExpiryAt === null) return;
    const timer = window.setTimeout(
      () => bumpPrivateReadFreshness((value) => value + 1),
      nextExpiryAt - now + 1,
    );
    return () => window.clearTimeout(timer);
  }, [
    privateReadFreshnessTick,
    realDataClient.privateRead.snapshot.observedAt,
    realDataClient.privateRead.snapshot.permissionPosture.observedAt,
  ]);

  // The canonical socket only speaks when supervisor truth changes, so a
  // signed-in account would otherwise age silently behind a delta-free cockpit.
  // State uses the same single-flight owner as socket deltas. While fallback
  // serves rows, a slower bounded probe lets a recovered state contract reclaim
  // ownership without waiting for a socket delta or owner click.
  useEffect(() => {
    const accountCadenceSec = Math.max(5, prefs.dataCadence?.account ?? 10);
    const intervalMs = (
      realDataClient.privateRead.transport === 'FALLBACK'
        ? Math.max(30, accountCadenceSec * 3)
        : accountCadenceSec
    ) * 1_000;
    const timer = window.setInterval(() => privateReadCadenceRef.current?.(), intervalMs);
    return () => window.clearInterval(timer);
  }, [prefs.dataCadence?.account, realDataClient.privateRead.transport]);

  // The compatibility state is the preferred and normally sole private-read
  // transport. Older/malformed state envelopes activate one bounded fallback
  // poll; accepting state.privateRead stops and aborts that poll immediately.
  useEffect(() => {
    if (realDataClient.privateRead.transport !== 'FALLBACK') return;
    let fallbackRequestId = 0;
    const poll = createSettledPoll<unknown>({
      intervalMs: Math.max(5, prefs.dataCadence?.account ?? 10) * 1_000,
      request: (signal) => {
        fallbackRequestId = nextPrivateReadRequestId();
        return fetchJson<unknown>('/api/private-account', { cache: 'no-store', signal });
      },
      onSuccess: (payload) => {
        dispatchRealDataClient({
          kind: 'PRIVATE_FALLBACK_RESULT',
          requestId: fallbackRequestId,
          observedAtMs: Date.now(),
          payload,
        });
      },
      onError: (cause) => {
        const failure = privateReadFailure(cause);
        dispatchRealDataClient({
          kind: 'PRIVATE_FALLBACK_FAILURE',
          requestId: fallbackRequestId,
          observedAtMs: Date.now(),
          failure: { code: failure.code, message: failure.message },
        });
      },
    });
    poll.start();
    return poll.stop;
  }, [
    dispatchRealDataClient,
    nextPrivateReadRequestId,
    prefs.dataCadence?.account,
    realDataClient.privateRead.transport,
  ]);

  // M0 readiness is a separate, read-only local contract. It is never inferred
  // from private-account rows and this client never calls the POST execution
  // boundary. Its sole settled poll preserves the last admitted non-authorizing
  // card, and manual refresh waits for that same owner instead of racing it.
  useEffect(() => {
    let m0RequestId = 0;
    const manualWaiters = new Set<(accepted: boolean) => void>();
    const settleManualWaiters = (accepted: boolean) => {
      for (const resolve of manualWaiters) resolve(accepted);
      manualWaiters.clear();
    };
    const accountCadenceMs = Math.max(1, prefs.dataCadence?.account ?? 10) * 1_000;
    const poll = createSettledPoll<unknown>({
      intervalMs: Math.min(4_000, accountCadenceMs),
      request: (signal) => {
        m0RequestId = nextM0ReadinessRequestId();
        return fetchJson<unknown>(
          '/api/system-integration/m0/spot-canary',
          { cache: 'no-store', signal },
        );
      },
      onSuccess: (payload) => {
        const observedAtMs = Date.now();
        const accepted = decodeM0SpotReadinessTruth(payload, observedAtMs) !== null;
        dispatchRealDataClient({
          kind: 'M0_READINESS_RESULT',
          requestId: m0RequestId,
          observedAtMs,
          payload,
        });
        settleManualWaiters(accepted);
      },
      onError: (cause) => {
        const failure = mutationFailure(cause);
        dispatchRealDataClient({
          kind: 'M0_READINESS_FAILURE',
          requestId: m0RequestId,
          observedAtMs: Date.now(),
          failure: { code: failure.code, message: failure.message },
        });
        settleManualWaiters(false);
      },
    });
    m0ReadinessPollRef.current = poll;
    const manualRefresh = () => new Promise<boolean>((resolve) => {
      manualWaiters.add(resolve);
      poll.refresh();
    });
    m0ReadinessRefreshRef.current = manualRefresh;
    poll.start();
    return () => {
      if (m0ReadinessPollRef.current === poll) m0ReadinessPollRef.current = null;
      if (m0ReadinessRefreshRef.current === manualRefresh) {
        m0ReadinessRefreshRef.current = null;
      }
      settleManualWaiters(false);
      poll.stop();
    };
  }, [
    dispatchRealDataClient,
    nextM0ReadinessRequestId,
    prefs.dataCadence?.account,
  ]);

  // markets poll at the preferred source cadence. `refreshSec` is retained as
  // the legacy market value; `dataCadence.market` is the new source map.
  useEffect(() => {
    const marketSec = prefs.dataCadence?.market ?? prefs.refreshSec;
    const poll = createSettledPoll<unknown>({
      intervalMs: Math.max(0.5, marketSec) * 1_000,
      request: (signal) => fetchJson('/api/markets', { signal }),
      onSuccess: (payload) => {
        const observedAtMs = Date.now();
        const maximumAgeMs = Math.max(12_000, marketSec * 2_500);
        admitMarketCompletion({ kind: 'RECEIPT', payload, observedAtMs, maximumAgeMs });
      },
      onError: (cause) => {
        const error = mutationFailure(cause).message || 'Market refresh failed.';
        admitMarketCompletion({
          kind: 'FAILURE',
          observedAtMs: Date.now(),
          error,
        });
      },
    });
    poll.start();
    return poll.stop;
  }, [admitMarketCompletion, prefs.refreshSec, prefs.dataCadence?.market]);

  const applyRoute = useCallback((target: RouteTarget) => {
    routeRef.current = target;
    setRoute(target);
    localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, target.page);
    if (target.detailSymbol !== null) {
      localStorage.setItem(DETAIL_SYMBOL_STORAGE_KEY, target.detailSymbol);
    }
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0 });
    document.querySelector('.app-main main')?.scrollTo({ top: 0 });
  }, []);

  // The initial resolution already owns the address bar; mirror it into
  // compatibility memory and follow Back/Forward for the life of the shell.
  useEffect(() => {
    applyRoute(routeController.resolveInitial(routeRef.current));
    const onPopState = () => {
      applyRoute(routeController.resolvePop(routeRef.current));
      scrollToTop();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyRoute, routeController, scrollToTop]);

  const openDetail = useCallback((symbol: string) => {
    const requested = routeTarget('detail', symbol);
    // An uncanonicalizable symbol is never navigated to; the visible route and
    // the URL stay exactly where they are.
    if (requested.detailSymbol === null) return;
    applyRoute(routeController.navigate(requested, routeRef.current));
    scrollToTop();
  }, [applyRoute, routeController, scrollToTop]);

  const changePage = useCallback((p: Page) => {
    applyRoute(routeController.navigate(routeTarget(p), routeRef.current));
    scrollToTop();
  }, [applyRoute, routeController, scrollToTop]);

  const saveConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const result = await post<AppConfig>('/api/config', patch);
    const config = result.data && isConfigAcknowledgement(result.data) ? failClosedConfig(result.data) : null;
    const error = result.error ?? (config ? null : acknowledgementFailure('Configuration acknowledgement was malformed.'));
    setMutationError((current) => config
      ? reduceMutationFailureTruth(current, { kind: 'ACKNOWLEDGED' })
      : reduceMutationFailureTruth(current, {
          kind: 'REJECTED',
          failure: error ?? acknowledgementFailure('Configuration acknowledgement was malformed.'),
        }));
    if (config) setState((s) => (s ? failClosedState({ ...s, config }) : s));
    return config;
  }, []);

  if (!watchlistMutationQueueRef.current) {
    watchlistMutationQueueRef.current = createSerializedWatchlistMutationQueue(
      state?.config.watchlist ?? [],
      (watchlist) => saveConfig({ watchlist: [...watchlist] }),
    );
  }
  const watchlistMutationQueue = watchlistMutationQueueRef.current;

  useEffect(() => {
    watchlistMutationQueue.synchronize(state?.config.watchlist ?? []);
  }, [state?.config.watchlist, watchlistMutationQueue]);

  const toggleWatch = useCallback(
    async (symbol: string) => {
      const saved = await watchlistMutationQueue.enqueue(symbol);
      return saved ? null : acknowledgementFailure('The watchlist change was not acknowledged.');
    },
    [watchlistMutationQueue],
  );

  // Read-only browser snapshot refresh retained for compatibility consumers.
  // It never calls the managed-runtime /api/refresh targets: those require the
  // canonical Product preview/digest/revision/receipt protocol.
  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const issues: string[] = [];
    const requestId = nextPrivateReadRequestId();
    try {
      const s = await fetchJson<ServerState>('/api/state', { cache: 'no-store' });
      setState(failClosedState(s));
      if (!acceptPrivateReadFromState(s, requestId)) {
        issues.push('Private-read snapshot unavailable');
      }
      setStateTruth((current) => reduceCompatibilityStateTruth(current, {
        kind: 'SUCCESS',
        observedAtMs: Date.now(),
      }));
    } catch (cause) {
      const failure = privateReadFailure(cause);
      issues.push('State snapshot failed');
      dispatchRealDataClient({
        kind: 'PRIVATE_STATE_FAILURE',
        requestId,
        observedAtMs: Date.now(),
        failure: { code: failure.code, message: failure.message },
      });
      setStateTruth((current) => reduceCompatibilityStateTruth(current, {
        kind: 'FAILURE',
        observedAtMs: Date.now(),
        error: failure.message,
      }));
    }
    try {
      const payload = await fetchJson<unknown>('/api/markets');
      const observedAtMs = Date.now();
      const marketSec = prefs.dataCadence?.market ?? prefs.refreshSec;
      const result = admitMarketCompletion({
        kind: 'RECEIPT',
        payload,
        observedAtMs,
        maximumAgeMs: Math.max(12_000, marketSec * 2_500),
      });
      if (result.disposition === 'FAILURE') {
        issues.push('Market refresh failed');
      } else if (result.disposition === 'OLDER_IGNORED') {
        issues.push('Older market snapshot ignored');
      } else if (result.disposition === 'CONFLICT'
          || result.disposition === 'EQUAL_IDENTICAL_NON_CURRENT'
          || result.disposition === 'NEWER_NON_CURRENT'
          || result.state.truth.status !== 'CURRENT'
          || result.state.truth.lastSuccessAtMs === null) {
        issues.push('Market sources are not current');
      }
    } catch (cause) {
      issues.push('Market refresh failed');
      const error = mutationFailure(cause).message || 'Market refresh failed.';
      admitMarketCompletion({
        kind: 'FAILURE',
        observedAtMs: Date.now(),
        error,
      });
    }
    const refreshM0Readiness = m0ReadinessRefreshRef.current;
    if (!refreshM0Readiness || !await refreshM0Readiness()) {
      issues.push('M0 readiness refresh failed');
    }
    // Rebuild only the browser's cockpit socket, then re-attach any active
    // token-book subscription. No server runtime is restarted here.
    reconnectRef.current?.();
    setDataNonce((n) => n + 1);
    fireRefresh();
    return {
      ok: issues.length === 0,
      issues,
      ts: Date.now(),
    };
  }, [
    acceptPrivateReadFromState,
    admitMarketCompletion,
    dispatchRealDataClient,
    nextPrivateReadRequestId,
    prefs.dataCadence?.market,
    prefs.refreshSec,
  ]);

  const privateReadClient = realDataClient.privateRead;
  const privateReadSource = appliedPrivateReadSource(privateReadClient);
  const privateReadError = privateReadClient.failure?.code ?? null;
  const privateReadGuard = projectPrivateReadGuard({
    snapshot: privateReadClient.snapshot,
    source: privateReadSource,
    error: privateReadError,
  });
  const store: Store = {
    state,
    stateStatus: stateTruth.status,
    stateLastSuccessAtMs: stateTruth.lastSuccessAtMs,
    stateError: stateTruth.error,
    privateRead: privateReadGuard.renderSnapshot,
    privateReadSource,
    privateReadError,
    privateReadClient,
    m0SpotReadiness: realDataClient.m0SpotReadiness,
    realDataClient,
    markets,
    marketStatus: marketTruth.status,
    marketsLastSuccessAtMs: marketTruth.lastSuccessAtMs,
    marketsUpdatedAt,
    marketsError,
    mutationError,
    fxTruth,
    fxBusy,
    refreshFx,
    connected,
    dataNonce,
    refresh,
    page,
    setPage: changePage,
    detailSymbol,
    openDetail,
    openLedger: useCallback(
      (symbol: string) => {
        sessionStorage.setItem('cosmos-ledger-symbol', symbol);
        changePage('ledger');
      },
      [changePage]
    ),
    prefs,
    updatePref: useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
      setPrefs(setPref(k, v));
    }, []),
    paletteOpen,
    setPaletteOpen,
    toggleWatch,
    saveConfig,
  };

  return (
    <StoreContext.Provider value={store}>
      {children}
      <span
        id={WEB_SOCKET_CLOSE_DIAGNOSTIC_ID}
        hidden
        aria-hidden="true"
        {...webSocketCloseDiagnosticAttributes(webSocketCloseDiagnostic)}
      />
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const { prefs } = useStore();
  return resolvedTheme(prefs);
}
