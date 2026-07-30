import {
  PRIVATE_READ_STALE_AFTER_MS,
  privateReadAge,
  type PrivateReadPresentation,
  type PrivateReadSnapshot,
  type PrivateReadState,
  type PrivateReadTone,
  type UsdmPosition,
} from '../lib/privateRead';
import type { CompatibilityStateStatus } from '../store';

export type AccountProduct = 'Spot' | 'Margin' | 'USD-M';
export type AccountReadSource = 'PENDING' | 'STATE' | 'FALLBACK';
export type AccountSourceClass = 'on' | 'partial' | 'bad' | 'loading';
export type AccountDatasetState = 'ALL_SOURCES_PRESENT' | 'PARTIAL_SOURCES' | 'UNAVAILABLE';

export interface AccountOrderRow {
  readonly product: AccountProduct;
  readonly symbol: string;
  readonly orderId: string;
  readonly side: 'BUY' | 'SELL';
  readonly type: string;
  readonly price: string;
  readonly origQty: string;
  readonly executedQty: string;
  readonly status: string;
  readonly time: number;
  readonly positionSide: string | null;
  readonly reduceOnly: boolean | null;
}

export interface AccountFillRow {
  readonly product: AccountProduct;
  readonly symbol: string;
  readonly id: string;
  readonly orderId: string;
  readonly side: 'BUY' | 'SELL';
  readonly price: string;
  readonly qty: string;
  readonly quoteQty: string;
  readonly commission: string;
  readonly commissionAsset: string;
  readonly time: number;
  readonly realizedPnl: string | null;
}

export interface AccountWalletRow {
  readonly id: string;
  readonly product: AccountProduct;
  readonly asset: string;
  readonly first: string;
  readonly firstLabel: string;
  readonly second: string;
  readonly secondLabel: string;
  readonly third: string;
  readonly thirdLabel: string;
  readonly fourth: string;
  readonly fourthLabel: string;
}

export interface AccountDataset<T> {
  readonly rows: readonly T[];
  readonly state: AccountDatasetState;
  readonly sourceLabel: string;
  readonly countLabel: string;
  readonly missingProducts: readonly AccountProduct[];
  readonly allSourcesCurrent: boolean;
  readonly exactEmptyCurrent: boolean;
  readonly retained: boolean;
}

export interface AccountFreshnessFact {
  readonly id: string;
  readonly label: string;
  readonly scope: string;
  readonly stateLabel: string;
  readonly observedLabel: string;
  readonly observedAt: number | null;
  readonly coverageLabel: string;
  readonly freshnessLabel: string;
  readonly detail: string;
}

export interface AccountTruthProjection {
  readonly orders: AccountDataset<AccountOrderRow>;
  readonly fills: AccountDataset<AccountFillRow>;
  readonly positions: AccountDataset<UsdmPosition>;
  readonly wallets: AccountDataset<AccountWalletRow>;
  readonly freshnessFacts: readonly AccountFreshnessFact[];
  readonly retained: boolean;
  readonly sourceClass: AccountSourceClass;
  readonly guardTone: PrivateReadTone;
  readonly sourceLabel: string;
  readonly sourceReason: string;
  readonly stateLabel: string;
  readonly observedLabel: string;
  readonly freshnessLabel: string;
  readonly freshnessReason: string;
}

interface AccountTruthInput {
  readonly snapshot: PrivateReadSnapshot;
  readonly presentation: PrivateReadPresentation;
  readonly source: AccountReadSource;
  readonly privateReadError: string | null;
  readonly stateStatus: CompatibilityStateStatus;
  readonly stateLastSuccessAtMs: number | null;
  readonly stateError: string | null;
  readonly now?: number;
}

interface DatasetSource {
  readonly product: AccountProduct;
  readonly present: boolean;
  readonly current: boolean;
}

function sourceClass(tone: PrivateReadTone): AccountSourceClass {
  if (tone === 'ok') return 'on';
  if (tone === 'warn') return 'partial';
  if (tone === 'bad') return 'bad';
  return 'loading';
}

function titleState(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function observedFreshness(
  state: PrivateReadState,
  observedAt: number | null,
  now: number,
  transportCurrent: boolean,
): string {
  if (state === 'NOT_CONFIGURED') return 'NOT CONFIGURED';
  if (state === 'UNAVAILABLE') return 'UNKNOWN';
  if (!transportCurrent || observedAt === null) return 'UNKNOWN';
  if (!Number.isFinite(now) || now < observedAt) return 'UNKNOWN';
  return now - observedAt < PRIVATE_READ_STALE_AFTER_MS ? 'CURRENT' : 'STALE';
}

function isFamilyCurrent(
  state: PrivateReadState,
  observedAt: number | null,
  now: number,
  transportCurrent: boolean,
): boolean {
  return (state === 'AVAILABLE' || state === 'PARTIAL')
    && observedFreshness(state, observedAt, now, transportCurrent) === 'CURRENT';
}

function projectDataset<T>(
  rows: readonly T[],
  sources: readonly DatasetSource[],
  noun: string,
  retained: boolean,
): AccountDataset<T> {
  const missingProducts = sources.filter((source) => !source.present).map((source) => source.product);
  const state: AccountDatasetState = missingProducts.length === 0
    ? 'ALL_SOURCES_PRESENT'
    : missingProducts.length === sources.length
      ? 'UNAVAILABLE'
      : 'PARTIAL_SOURCES';
  const allSourcesCurrent = state === 'ALL_SOURCES_PRESENT'
    && sources.every((source) => source.current);
  const exactEmptyCurrent = rows.length === 0
    && allSourcesCurrent;
  const observedCount = rows.length > 0
    ? `${rows.length} Observed ${noun}`
    : exactEmptyCurrent
      ? `0 ${noun}`
      : '—';
  const sourceLabel = state === 'ALL_SOURCES_PRESENT'
    ? `All ${sources.length} Product ${sources.length === 1 ? 'Read' : 'Reads'} Present`
    : state === 'PARTIAL_SOURCES'
      ? `${sources.length - missingProducts.length}/${sources.length} Product Reads Present · ${missingProducts.join(', ')} Unavailable`
      : 'No Product Reads Available';
  return Object.freeze({
    rows: Object.freeze([...rows]),
    state,
    sourceLabel,
    countLabel: observedCount,
    missingProducts: Object.freeze(missingProducts),
    allSourcesCurrent,
    exactEmptyCurrent,
    retained,
  });
}

function fixedReadError(error: string | null): string | null {
  if (!error) return null;
  if (/AUTH/i.test(error)) return 'The authenticated account read was not admitted.';
  if (/ACCESS|DENIED/i.test(error)) return 'The authenticated account read was denied.';
  return 'The latest private account read was not admitted by the strict account contract.';
}

export function projectAccountTruth({
  snapshot,
  presentation,
  source,
  privateReadError,
  stateStatus,
  stateLastSuccessAtMs,
  stateError,
  now = Date.now(),
}: AccountTruthInput): AccountTruthProjection {
  const stateTransportCurrent = source === 'FALLBACK' || stateStatus === 'CURRENT';
  const transportCurrent = source !== 'PENDING' && !privateReadError && stateTransportCurrent;
  const retained = source === 'STATE'
    && stateStatus === 'STALE'
    && stateLastSuccessAtMs !== null;
  const rootCurrent = transportCurrent && presentation.freshness.state === 'CURRENT';
  const spotCurrent = isFamilyCurrent(snapshot.spot.state, snapshot.spot.observedAt, now, rootCurrent);
  const marginCurrent = isFamilyCurrent(snapshot.margin.state, snapshot.margin.observedAt, now, rootCurrent);
  const usdmCurrent = isFamilyCurrent(snapshot.usdm.state, snapshot.usdm.observedAt, now, rootCurrent);

  const openOrders: AccountOrderRow[] = [
    ...(snapshot.spot.openOrders ?? []).map((order) => ({
      ...order,
      product: 'Spot' as const,
      positionSide: null,
      reduceOnly: null,
    })),
    ...(snapshot.margin.openOrders ?? []).map((order) => ({
      ...order,
      product: 'Margin' as const,
      positionSide: null,
      reduceOnly: null,
    })),
    ...(snapshot.usdm.openOrders ?? []).map((order) => ({
      ...order,
      product: 'USD-M' as const,
      positionSide: order.positionSide,
      reduceOnly: order.reduceOnly,
    })),
  ].sort((left, right) => right.time - left.time);

  const fills: AccountFillRow[] = [
    ...(snapshot.spot.fills ?? []).map((fill) => ({
      ...fill,
      product: 'Spot' as const,
      side: fill.isBuyer ? 'BUY' as const : 'SELL' as const,
      realizedPnl: null,
    })),
    ...(snapshot.margin.fills ?? []).map((fill) => ({
      ...fill,
      product: 'Margin' as const,
      side: fill.isBuyer ? 'BUY' as const : 'SELL' as const,
      realizedPnl: null,
    })),
    ...(snapshot.usdm.fills ?? []).map((fill) => ({
      ...fill,
      product: 'USD-M' as const,
      side: fill.side,
      realizedPnl: fill.realizedPnl,
    })),
  ].sort((left, right) => right.time - left.time);

  const positions = [...(snapshot.usdm.positions ?? [])]
    .sort((left, right) => right.updateTime - left.updateTime);
  const walletRows: AccountWalletRow[] = [
    ...(snapshot.spot.balances ?? []).map((balance) => ({
      id: `spot-${balance.asset}`,
      product: 'Spot' as const,
      asset: balance.asset,
      first: balance.free,
      firstLabel: 'Available',
      second: balance.locked,
      secondLabel: 'Locked',
      third: '—',
      thirdLabel: 'Liability Not Applicable',
      fourth: snapshot.spot.state,
      fourthLabel: titleState(snapshot.spot.coverage.state),
    })),
    ...(snapshot.margin.assets ?? []).map((asset) => ({
      id: `margin-${asset.asset}`,
      product: 'Margin' as const,
      asset: asset.asset,
      first: asset.free,
      firstLabel: 'Available',
      second: asset.locked,
      secondLabel: 'Locked',
      third: `${asset.borrowed} / ${asset.interest}`,
      thirdLabel: 'Borrowed / Interest',
      fourth: asset.netAsset,
      fourthLabel: 'Net Asset',
    })),
    ...(snapshot.usdm.balances ?? []).map((balance) => ({
      id: `usdm-${balance.asset}`,
      product: 'USD-M' as const,
      asset: balance.asset,
      first: balance.availableBalance,
      firstLabel: 'Available',
      second: balance.crossWalletBalance,
      secondLabel: 'Cross Wallet',
      third: balance.crossUnPnl,
      thirdLabel: 'Cross Unrealized PnL',
      fourth: balance.balance,
      fourthLabel: 'Wallet Balance',
    })),
  ];

  const productSources = {
    orders: [
      { product: 'Spot' as const, present: snapshot.spot.openOrders !== null, current: spotCurrent },
      { product: 'Margin' as const, present: snapshot.margin.openOrders !== null, current: marginCurrent },
      { product: 'USD-M' as const, present: snapshot.usdm.openOrders !== null, current: usdmCurrent },
    ],
    fills: [
      { product: 'Spot' as const, present: snapshot.spot.fills !== null, current: spotCurrent },
      { product: 'Margin' as const, present: snapshot.margin.fills !== null, current: marginCurrent },
      { product: 'USD-M' as const, present: snapshot.usdm.fills !== null, current: usdmCurrent },
    ],
    positions: [
      { product: 'USD-M' as const, present: snapshot.usdm.positions !== null, current: usdmCurrent },
    ],
    wallets: [
      { product: 'Spot' as const, present: snapshot.spot.balances !== null, current: spotCurrent },
      { product: 'Margin' as const, present: snapshot.margin.assets !== null, current: marginCurrent },
      { product: 'USD-M' as const, present: snapshot.usdm.balances !== null, current: usdmCurrent },
    ],
  };

  const readError = fixedReadError(privateReadError);
  const sourceReason = readError
    ?? (retained
      ? `The last admitted account rows are retained from ${privateReadAge(stateLastSuccessAtMs, now)}; the latest shared-state refresh did not settle.`
      : source === 'PENDING' || stateStatus === 'LOADING'
        ? 'The first shared account read has not settled.'
          : source === 'STATE' && stateStatus === 'UNAVAILABLE'
            ? 'No successful shared-state account read is available.'
            : !transportCurrent
              ? 'The shared account read is not current; current account truth is not authorized.'
            : presentation.freshness.state !== 'CURRENT'
              ? presentation.freshness.reason
              : source === 'FALLBACK'
                ? 'The bounded fallback owns the current account snapshot; shared application state remains a separate fact.'
              : Object.values(snapshot.reconciliation).find((fact) => fact.reason)?.reason
                ?? presentation.coverageLabel);
  const stateLabel = readError
    ? 'Unavailable'
    : retained
      ? 'Retained Last-Known'
      : source === 'PENDING' || stateStatus === 'LOADING'
        ? 'Loading'
        : source === 'STATE' && stateStatus === 'UNAVAILABLE'
          ? 'Unavailable'
          : !transportCurrent
            ? titleState(stateStatus)
            : presentation.stateLabel;
  const freshnessLabel = retained
    ? 'Stale Last-Known Account Truth'
    : !transportCurrent
      ? 'Freshness Unknown'
      : presentation.freshness.label;
  const freshnessReason = rootCurrent ? presentation.freshness.reason : sourceReason;
  const projectionClass = readError
    ? 'bad'
    : retained
      ? 'partial'
      : source === 'PENDING' || stateStatus === 'LOADING'
        ? 'loading'
        : source === 'STATE' && stateStatus === 'UNAVAILABLE'
          ? 'bad'
          : source === 'FALLBACK'
            ? 'partial'
            : sourceClass(presentation.guardTone);
  const guardTone: PrivateReadTone = readError
    ? 'bad'
    : retained
      ? 'warn'
      : source === 'PENDING' || stateStatus === 'LOADING'
        ? 'idle'
        : source === 'STATE' && stateStatus === 'UNAVAILABLE'
          ? 'bad'
          : presentation.guardTone;
  const sourceLabel = readError
    ? 'Private Read Not Admitted'
    : retained
      ? 'Retained Account Truth · Latest Refresh Failed'
      : source === 'PENDING' || stateStatus === 'LOADING'
        ? 'Private Reads Loading'
        : source === 'STATE' && stateStatus === 'UNAVAILABLE'
          ? 'Private Reads Unavailable'
          : `Private Reads ${stateLabel} · ${freshnessLabel}`;

  const applicationObservation = stateLastSuccessAtMs;
  const applicationFreshness = source === 'FALLBACK'
    ? `STATE ${stateStatus} · FALLBACK ACCOUNT OWNER`
    : retained
      ? 'STALE · LAST-KNOWN ACCOUNT ROWS RETAINED'
      : stateStatus;
  const productFact = (
    id: string,
    label: string,
    state: PrivateReadState,
    observedAt: number | null,
    coverageState: string,
    limitation: string | null,
    current: boolean,
  ): AccountFreshnessFact => Object.freeze({
    id,
    label,
    scope: 'Provider Family',
    stateLabel: retained ? `${state} · LAST-KNOWN` : state,
    observedLabel: privateReadAge(observedAt, now),
    observedAt,
    coverageLabel: titleState(coverageState),
    freshnessLabel: current ? 'CURRENT' : observedFreshness(state, observedAt, now, rootCurrent),
    detail: !rootCurrent
      ? sourceReason
      : limitation && (state === 'AVAILABLE' || state === 'PARTIAL')
      ? limitation
      : `${label} private-read family is ${titleState(state).toLowerCase()}.`,
  });

  const freshnessFacts: AccountFreshnessFact[] = [
    Object.freeze({
      id: 'application',
      label: 'Application State',
      scope: source === 'FALLBACK' ? 'Shared State + Bounded Fallback' : 'Shared State',
      stateLabel: stateStatus,
      observedLabel: privateReadAge(applicationObservation, now),
      observedAt: applicationObservation,
      coverageLabel: source,
      freshnessLabel: applicationFreshness,
      detail: retained
        ? 'The failed refresh did not erase the last admitted account rows.'
        : stateError
          ? 'The latest application-state refresh did not settle.'
          : 'The shared store remains the sole account transport owner.',
    }),
    Object.freeze({
      id: 'account',
      label: 'Account Snapshot',
      scope: snapshot.schemaVersion,
      stateLabel: retained ? `${snapshot.state} · LAST-KNOWN` : stateLabel,
      observedLabel: presentation.observedLabel,
      observedAt: snapshot.observedAt,
      coverageLabel: presentation.coverageLabel,
      freshnessLabel,
      detail: freshnessReason,
    }),
    productFact('spot', 'Spot', snapshot.spot.state, snapshot.spot.observedAt, snapshot.spot.coverage.state, snapshot.spot.coverage.limitation, spotCurrent),
    productFact('margin', 'Cross Margin', snapshot.margin.state, snapshot.margin.observedAt, snapshot.margin.coverage.state, snapshot.margin.coverage.limitation, marginCurrent),
    productFact('usdm', 'USD-M', snapshot.usdm.state, snapshot.usdm.observedAt, snapshot.usdm.coverage.state, snapshot.usdm.coverage.limitation, usdmCurrent),
  ];

  return Object.freeze({
    orders: projectDataset(openOrders, productSources.orders, 'Orders', retained),
    fills: projectDataset(fills, productSources.fills, 'Scoped Fills', retained),
    positions: projectDataset(positions, productSources.positions, 'Position Rows', retained),
    wallets: projectDataset(walletRows, productSources.wallets, 'Asset Rows', retained),
    freshnessFacts: Object.freeze(freshnessFacts),
    retained,
    sourceClass: projectionClass,
    guardTone,
    sourceLabel,
    sourceReason,
    stateLabel,
    observedLabel: presentation.observedLabel,
    freshnessLabel,
    freshnessReason,
  });
}
