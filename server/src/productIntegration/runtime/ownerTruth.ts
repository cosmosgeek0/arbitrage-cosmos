import type { PrivateReadSnapshot, PrivateReadState } from '../../services/privateRead.js';
import type { SystemSupervisorReadModel } from '../../systemIntegration/supervisor/types.js';
import {
  PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS,
  PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA,
  type ProductRuntimeOwnerTruthCut,
  type ProductRuntimeOwnerTruthAvailableLabel,
  type ProductRuntimeOwnerTruthField,
  type ProductRuntimeOwnerTruthSurfaceCut,
  type ProductRuntimeOwnerTruthSurfaceId,
  type ProductRuntimeOwnerTruthUnavailableLabel,
} from './types.js';

const OWNER_SOURCE = 'server.ownerTruth';
const SUPERVISOR_SOURCE = 'systemIntegration.supervisor';
const PRIVATE_READ_SOURCE = 'services.privateRead';
const MARKET_SOURCE = 'intelligenceRuntime.marketSources';
const DASHBOARD_MAX_AGE_MS = 60_000;
const ACCOUNT_MAX_AGE_MS = 45_000;
const MARKETS_MAX_AGE_MS = 5_000;
const MAX_VALUE_CHARS = 240;
const MAX_MARKET_ROWS = 128;
const MAX_SYMBOLS_IN_VALUE = 4;
const MAX_NUMERIC_MAGNITUDE = 1e100;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SYMBOL = /^[A-Z0-9]{5,30}$/;
const ASSET = /^[A-Z0-9]{1,20}$/;

export type ProductRuntimeOwnerTruthMarketSourceState = 'fresh' | 'unavailable';

/**
 * Bounded structural subset of the existing `/api/markets` projected row.
 * Index owns acquisition and projection; this adapter only summarizes the
 * immutable rows it is given.
 */
export interface ProductRuntimeOwnerTruthMarketRow {
  readonly symbol: string;
  readonly basisPct?: number | null;
  readonly executableBasisBestPct?: number | null;
  readonly executableBasisSide?: 'LONG_SPOT_SHORT_PERP' | 'SHORT_SPOT_LONG_PERP' | null;
  readonly change24hPct?: number | null;
  readonly quoteVolume24h?: number | null;
  readonly spotSpreadPct?: number | null;
  readonly spotTopQuoteUsd?: number | null;
  readonly perpSpreadPct?: number | null;
  readonly perpTopQuoteUsd?: number | null;
  readonly fundingRate?: number | null;
  readonly fundingAnnualPct?: number | null;
  readonly openInterestUsd?: number | null;
  readonly oiToPerpVolume24h?: number | null;
  readonly liquidations15mUsd?: number | null;
  readonly longLiquidations15mUsd?: number | null;
  readonly shortLiquidations15mUsd?: number | null;
}

export interface ProductRuntimeOwnerTruthMarketsInput {
  readonly observedAtMs: number;
  readonly dataSources: Readonly<{
    readonly spotBookTicker: ProductRuntimeOwnerTruthMarketSourceState;
    readonly futuresBookTicker: ProductRuntimeOwnerTruthMarketSourceState;
    readonly futures24hTicker: ProductRuntimeOwnerTruthMarketSourceState;
  }>;
  readonly rows: readonly Readonly<ProductRuntimeOwnerTruthMarketRow>[];
}

export interface ProductRuntimeOwnerTruthProjectionInput {
  readonly supervisor: Readonly<SystemSupervisorReadModel>;
  readonly privateRead: Readonly<PrivateReadSnapshot>;
  readonly markets: Readonly<ProductRuntimeOwnerTruthMarketsInput>;
}

function validObservedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) <= MAX_NUMERIC_MAGNITUDE
    ? value
    : null;
}

function count(value: unknown): string {
  return Array.isArray(value) ? String(value.length) : 'UNKNOWN';
}

function exactDecimal(value: unknown): string | null {
  return typeof value === 'string'
    && value.length <= 32
    && DECIMAL.test(value)
    ? value
    : null;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : null;
}

function safeSymbol(value: unknown): string | null {
  return typeof value === 'string' && SYMBOL.test(value) ? value : null;
}

function safeAsset(value: unknown): string | null {
  return typeof value === 'string' && ASSET.test(value) ? value : null;
}

function printable(value: unknown, maximum = 120): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) return null;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return null;
  }
  return value;
}

/**
 * Values are assembled from whole bounded facts. No fact is cut mid-decimal or
 * mid-identifier merely to satisfy the Product row ceiling.
 */
function line(fragments: readonly (string | null)[]): string | null {
  let value = '';
  for (const fragment of fragments) {
    if (fragment === null || fragment.length === 0) continue;
    const candidate = value.length === 0 ? fragment : `${value};${fragment}`;
    if (candidate.length > MAX_VALUE_CHARS) continue;
    value = candidate;
  }
  return value.length > 0 ? value : null;
}

function available(
  fieldId: string,
  value: string,
  source: string,
  truthLabel: ProductRuntimeOwnerTruthAvailableLabel = 'WIRED',
): Readonly<ProductRuntimeOwnerTruthField> {
  return Object.freeze({
    fieldId,
    state: 'AVAILABLE',
    value,
    truthLabel,
    source,
    unavailableReason: null,
  });
}

function unavailable(
  fieldId: string,
  unavailableReason: string,
  source: string,
  truthLabel: ProductRuntimeOwnerTruthUnavailableLabel = 'UNAVAILABLE',
): Readonly<ProductRuntimeOwnerTruthField> {
  return Object.freeze({
    fieldId,
    state: 'UNAVAILABLE',
    value: null,
    truthLabel,
    source,
    unavailableReason,
  });
}

function answered(
  fieldId: string,
  value: string | null,
  unavailableReason: string,
  source: string,
  truthLabel: ProductRuntimeOwnerTruthUnavailableLabel = 'UNAVAILABLE',
): Readonly<ProductRuntimeOwnerTruthField> {
  return value === null
    ? unavailable(fieldId, unavailableReason, source, truthLabel)
    : available(fieldId, value, source);
}

function availableSurface(
  surfaceId: ProductRuntimeOwnerTruthSurfaceId,
  observedAtMs: number,
  maxAgeMs: number,
  source: string,
  fields: Readonly<Record<string, Readonly<ProductRuntimeOwnerTruthField>>>,
  supersedesCanonicalAccountTruthState: string | null = null,
  truthLabel: ProductRuntimeOwnerTruthAvailableLabel = 'WIRED',
): Readonly<ProductRuntimeOwnerTruthSurfaceCut> {
  return Object.freeze({
    surfaceId,
    source,
    state: 'AVAILABLE',
    observedAtMs,
    maxAgeMs,
    truthLabel,
    unavailableReason: null,
    supersedesCanonicalAccountTruthState,
    fields: Object.freeze(PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS[surfaceId].map((fieldId) => fields[fieldId]!)),
  });
}

function unavailableSurface(
  surfaceId: ProductRuntimeOwnerTruthSurfaceId,
  observedAtMs: number,
  maxAgeMs: number,
  unavailableReason: string,
  truthLabel: ProductRuntimeOwnerTruthUnavailableLabel,
  source: string,
): Readonly<ProductRuntimeOwnerTruthSurfaceCut> {
  return Object.freeze({
    surfaceId,
    source,
    state: 'UNAVAILABLE',
    observedAtMs,
    maxAgeMs,
    truthLabel,
    unavailableReason,
    supersedesCanonicalAccountTruthState: null,
    fields: Object.freeze([]),
  });
}

function countFragment(label: string, value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? `${label}=${value}`
    : null;
}

function dashboardSurface(
  supervisor: Readonly<SystemSupervisorReadModel>,
): Readonly<ProductRuntimeOwnerTruthSurfaceCut> {
  const observedAtMs = validObservedAt(supervisor.evaluatedAtMs);
  if (observedAtMs === null) {
    return unavailableSurface(
      'dashboard',
      0,
      DASHBOARD_MAX_AGE_MS,
      'SUPERVISOR_OBSERVED_AT_INVALID',
      'UNAVAILABLE',
      SUPERVISOR_SOURCE,
    );
  }
  const basis = supervisor.summaries.strategies.basis;
  const volume = supervisor.summaries.strategies.volume;
  const capital = supervisor.summaries.capital;
  const execution = supervisor.summaries.execution;
  const pipelineValues = [
    basis.candidateCount,
    basis.proposalCount,
    basis.cooldownCount,
    basis.rejectionCount,
    volume.candidateCount,
    volume.proposalCount,
    volume.cooldownCount,
    volume.rejectionCount,
  ];
  const pipelineCounts = pipelineValues.every((value) => (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  )) ? line([
    `basisState=${basis.truthLabel}`,
    countFragment('basisCandidates', basis.candidateCount),
    countFragment('basisProposals', basis.proposalCount),
    countFragment('basisCooldowns', basis.cooldownCount),
    countFragment('basisRejections', basis.rejectionCount),
    `volumeState=${volume.truthLabel}`,
    countFragment('volumeCandidates', volume.candidateCount),
    countFragment('volumeProposals', volume.proposalCount),
    countFragment('volumeCooldowns', volume.cooldownCount),
    countFragment('volumeRejections', volume.rejectionCount),
  ]) : null;
  const activeValues = [
    capital.reservationCount,
    capital.stagedMandateCount,
    capital.activeExposureCount,
    capital.recoveryCount,
    execution.legCount,
  ];
  const activeObjects = activeValues.every((value) => (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  )) ? line([
    countFragment('reservations', capital.reservationCount),
    countFragment('stagedMandates', capital.stagedMandateCount),
    countFragment('activeExposures', capital.activeExposureCount),
    countFragment('recoveries', capital.recoveryCount),
    countFragment('executionLegs', execution.legCount),
    execution.planId === null ? 'executionPlan=NONE' : `executionPlan=${printable(execution.planId, 64) ?? 'INVALID'}`,
  ]) : null;
  const fields: Record<string, Readonly<ProductRuntimeOwnerTruthField>> = {
    'pnl-drawdown': unavailable(
      'pnl-drawdown',
      'PNL_DRAWDOWN_NOT_PUBLISHED',
      PRIVATE_READ_SOURCE,
    ),
    'pipeline-counts': answered(
      'pipeline-counts',
      pipelineCounts,
      'PIPELINE_COUNTS_NOT_PUBLISHED',
      SUPERVISOR_SOURCE,
    ),
    'active-objects': answered(
      'active-objects',
      activeObjects,
      'ACTIVE_OBJECT_COUNTS_NOT_PUBLISHED',
      SUPERVISOR_SOURCE,
    ),
    'strategy-q': unavailable(
      'strategy-q',
      'STRATEGY_Q_ASSESSMENT_NOT_PUBLISHED',
      SUPERVISOR_SOURCE,
    ),
  };
  return availableSurface(
    'dashboard',
    observedAtMs,
    DASHBOARD_MAX_AGE_MS,
    SUPERVISOR_SOURCE,
    fields,
  );
}

function productReason(prefix: 'SPOT' | 'MARGIN' | 'USDM', state: PrivateReadState): string {
  if (state === 'NOT_CONFIGURED') return `${prefix}_PRIVATE_READ_NOT_CONFIGURED`;
  if (state === 'UNAVAILABLE') return `${prefix}_PRIVATE_READ_UNAVAILABLE`;
  return `${prefix}_PRIVATE_READ_PARTIAL`;
}

function productTruth(
  fieldId: string,
  state: PrivateReadState,
  value: string | null,
  prefix: 'SPOT' | 'MARGIN' | 'USDM',
  complete: boolean,
): Readonly<ProductRuntimeOwnerTruthField> {
  if (state === 'NOT_CONFIGURED') {
    return unavailable(fieldId, productReason(prefix, state), PRIVATE_READ_SOURCE, 'NOT_CONFIGURED');
  }
  if (state === 'UNAVAILABLE') {
    return unavailable(fieldId, productReason(prefix, state), PRIVATE_READ_SOURCE);
  }
  if (state === 'PARTIAL') {
    return unavailable(fieldId, productReason(prefix, state), PRIVATE_READ_SOURCE);
  }
  return complete
    ? answered(fieldId, value, `${prefix}_PRIVATE_READ_INCOMPLETE`, PRIVATE_READ_SOURCE)
    : unavailable(fieldId, `${prefix}_PRIVATE_READ_INCOMPLETE`, PRIVATE_READ_SOURCE);
}

function firstSpotBalance(snapshot: Readonly<PrivateReadSnapshot>): string | null {
  const row = snapshot.spot.balances?.slice(0, 1)[0];
  const asset = safeAsset(row?.asset);
  const free = exactDecimal(row?.free);
  const locked = exactDecimal(row?.locked);
  return asset !== null && free !== null && locked !== null
    ? `firstBalance=${asset}:free=${free}:locked=${locked}`
    : null;
}

function firstUsdmBalance(snapshot: Readonly<PrivateReadSnapshot>): string | null {
  const row = snapshot.usdm.balances?.slice(0, 1)[0];
  const asset = safeAsset(row?.asset);
  const balance = exactDecimal(row?.balance);
  const availableBalance = exactDecimal(row?.availableBalance);
  return asset !== null && balance !== null && availableBalance !== null
    ? `firstBalance=${asset}:balance=${balance}:available=${availableBalance}`
    : null;
}

function firstMarginAsset(snapshot: Readonly<PrivateReadSnapshot>): string | null {
  const row = snapshot.margin.assets?.slice(0, 1)[0];
  const asset = safeAsset(row?.asset);
  const free = exactDecimal(row?.free);
  const borrowed = exactDecimal(row?.borrowed);
  const interest = exactDecimal(row?.interest);
  return asset !== null && free !== null && borrowed !== null && interest !== null
    ? `firstAsset=${asset}:free=${free}:borrowed=${borrowed}:interest=${interest}`
    : null;
}

function spotValue(snapshot: Readonly<PrivateReadSnapshot>): string | null {
  return line([
    `state=${snapshot.spot.state}`,
    `observedAtMs=${snapshot.spot.observedAt ?? 'UNKNOWN'}`,
    `balances=${count(snapshot.spot.balances)}`,
    `openOrders=${count(snapshot.spot.openOrders)}`,
    `fills=${count(snapshot.spot.fills)}`,
    firstSpotBalance(snapshot),
  ]);
}

function usdmValue(snapshot: Readonly<PrivateReadSnapshot>): string | null {
  return line([
    `state=${snapshot.usdm.state}`,
    `observedAtMs=${snapshot.usdm.observedAt ?? 'UNKNOWN'}`,
    `balances=${count(snapshot.usdm.balances)}`,
    `positions=${count(snapshot.usdm.positions)}`,
    `openOrders=${count(snapshot.usdm.openOrders)}`,
    `fills=${count(snapshot.usdm.fills)}`,
    firstUsdmBalance(snapshot),
  ]);
}

function marginValue(snapshot: Readonly<PrivateReadSnapshot>): string | null {
  return line([
    `state=${snapshot.margin.state}`,
    `observedAtMs=${snapshot.margin.observedAt ?? 'UNKNOWN'}`,
    `assets=${count(snapshot.margin.assets)}`,
    `openOrders=${count(snapshot.margin.openOrders)}`,
    `fills=${count(snapshot.margin.fills)}`,
    exactDecimal(snapshot.margin.totalNetAssetBtc) === null
      ? null
      : `totalNetAssetBtc=${snapshot.margin.totalNetAssetBtc}`,
    firstMarginAsset(snapshot),
  ]);
}

function permissionValue(snapshot: Readonly<PrivateReadSnapshot>): string {
  const permission = snapshot.permissionPosture;
  const boolean = (value: boolean | null): string => value === null ? 'UNKNOWN' : value ? 'TRUE' : 'FALSE';
  return line([
    `posture=${permission.state}`,
    `observedAtMs=${permission.observedAt ?? 'UNKNOWN'}`,
    `reading=${boolean(permission.reading)}`,
    `spotMarginTrading=${boolean(permission.spotMarginTrading)}`,
    `margin=${boolean(permission.margin)}`,
    `futures=${boolean(permission.futures)}`,
    `withdrawals=${boolean(permission.withdrawals)}`,
    `internalTransfer=${boolean(permission.internalTransfer)}`,
    `universalTransfer=${boolean(permission.universalTransfer)}`,
    `ipRestricted=${boolean(permission.ipRestricted)}`,
  ])!;
}

function permissionField(
  snapshot: Readonly<PrivateReadSnapshot>,
): Readonly<ProductRuntimeOwnerTruthField> {
  const permission = snapshot.permissionPosture;
  if (permission.state === 'NOT_CONFIGURED') {
    return unavailable(
      'permissions-modes',
      'PRIVATE_READ_PERMISSION_NOT_CONFIGURED',
      PRIVATE_READ_SOURCE,
      'NOT_CONFIGURED',
    );
  }
  if (permission.state === 'UNSAFE') {
    return unavailable(
      'permissions-modes',
      'PRIVATE_READ_PERMISSION_POSTURE_UNSAFE',
      PRIVATE_READ_SOURCE,
      'BLOCKED',
    );
  }
  if (permission.state !== 'VERIFIED_READ_ONLY') {
    return unavailable(
      'permissions-modes',
      'PRIVATE_READ_PERMISSION_POSTURE_UNKNOWN',
      PRIVATE_READ_SOURCE,
    );
  }
  const required = [
    permission.reading,
    permission.spotMarginTrading,
    permission.margin,
    permission.futures,
    permission.withdrawals,
    permission.internalTransfer,
    permission.universalTransfer,
    permission.ipRestricted,
  ];
  return required.every((value) => typeof value === 'boolean')
    ? available('permissions-modes', permissionValue(snapshot), PRIVATE_READ_SOURCE)
    : unavailable(
        'permissions-modes',
        'PRIVATE_READ_PERMISSION_FIELDS_INCOMPLETE',
        PRIVATE_READ_SOURCE,
      );
}

function symbolsValue(symbols: readonly string[]): string {
  const bounded = symbols
    .slice(0, MAX_SYMBOLS_IN_VALUE)
    .map(safeSymbol)
    .filter((value): value is string => value !== null);
  return bounded.length === 0 ? 'NONE' : bounded.join(',');
}

function freshnessValue(snapshot: Readonly<PrivateReadSnapshot>): string {
  return line([
    `state=${snapshot.state}`,
    `observedAtMs=${snapshot.observedAt ?? 'UNKNOWN'}`,
    `spotCoverage=${snapshot.spot.coverage.state}`,
    `spotSymbols=${symbolsValue(snapshot.spot.coverage.symbols)}`,
    `marginCoverage=${snapshot.margin.coverage.state}`,
    `marginSymbols=${symbolsValue(snapshot.margin.coverage.symbols)}`,
    `usdmCoverage=${snapshot.usdm.coverage.state}`,
    `usdmSymbols=${symbolsValue(snapshot.usdm.coverage.symbols)}`,
  ])!;
}

function freshnessField(
  snapshot: Readonly<PrivateReadSnapshot>,
): Readonly<ProductRuntimeOwnerTruthField> {
  const complete = snapshot.state === 'AVAILABLE'
    && snapshot.observedAt !== null
    && [snapshot.spot, snapshot.margin, snapshot.usdm].every((family) => (
      family.state === 'AVAILABLE'
      && family.observedAt !== null
      && family.coverage.state === 'COMPLETE_CURRENT'
    ));
  return complete
    ? available('freshness-completeness', freshnessValue(snapshot), PRIVATE_READ_SOURCE)
    : unavailable(
        'freshness-completeness',
        'PRIVATE_ACCOUNT_FRESHNESS_OR_COVERAGE_PARTIAL',
        PRIVATE_READ_SOURCE,
      );
}

function reconciliationValue(snapshot: Readonly<PrivateReadSnapshot>): string {
  return line((['balances', 'orders', 'fills', 'positions', 'liabilities'] as const).flatMap((key) => {
    const value = snapshot.reconciliation[key];
    return [`${key}=${value.state}`, `${key}At=${value.observedAt ?? 'UNKNOWN'}`];
  }))!;
}

function reconciliationField(
  snapshot: Readonly<PrivateReadSnapshot>,
): Readonly<ProductRuntimeOwnerTruthField> {
  const values = Object.values(snapshot.reconciliation);
  if (values.every((value) => value.state === 'RECONCILED' && value.observedAt !== null)) {
    return available('reconciliation', reconciliationValue(snapshot), PRIVATE_READ_SOURCE);
  }
  if (values.some((value) => value.state === 'NOT_CONFIGURED')) {
    return unavailable(
      'reconciliation',
      'PRIVATE_ACCOUNT_RECONCILIATION_NOT_CONFIGURED',
      PRIVATE_READ_SOURCE,
      'NOT_CONFIGURED',
    );
  }
  return unavailable(
    'reconciliation',
    'PRIVATE_ACCOUNT_RECONCILIATION_INCOMPLETE',
    PRIVATE_READ_SOURCE,
  );
}

function liabilitiesValue(snapshot: Readonly<PrivateReadSnapshot>): string | null {
  const total = exactDecimal(snapshot.margin.totalLiabilityBtc);
  const asset = snapshot.margin.assets?.slice(0, 1)[0];
  const name = safeAsset(asset?.asset);
  const borrowed = exactDecimal(asset?.borrowed);
  const interest = exactDecimal(asset?.interest);
  return line([
    `state=${snapshot.margin.state}`,
    total === null ? null : `totalLiabilityBtc=${total}`,
    name !== null && borrowed !== null && interest !== null
      ? `firstLiability=${name}:borrowed=${borrowed}:interest=${interest}`
      : null,
    `reconciliation=${snapshot.reconciliation.liabilities.state}`,
  ]);
}

function ordersPositionsValue(snapshot: Readonly<PrivateReadSnapshot>): string {
  const firstSymbols = [
    snapshot.spot.openOrders?.slice(0, 1)[0]?.symbol,
    snapshot.margin.openOrders?.slice(0, 1)[0]?.symbol,
    snapshot.usdm.openOrders?.slice(0, 1)[0]?.symbol,
    snapshot.usdm.positions?.slice(0, 1)[0]?.symbol,
  ].map(safeSymbol).filter((value): value is string => value !== null);
  return line([
    `spotOrders=${count(snapshot.spot.openOrders)}`,
    `marginOrders=${count(snapshot.margin.openOrders)}`,
    `usdmOrders=${count(snapshot.usdm.openOrders)}`,
    `usdmPositions=${count(snapshot.usdm.positions)}`,
    `symbols=${firstSymbols.length === 0 ? 'NONE' : [...new Set(firstSymbols)].join(',')}`,
  ])!;
}

function ordersPositionsField(
  snapshot: Readonly<PrivateReadSnapshot>,
): Readonly<ProductRuntimeOwnerTruthField> {
  const required = [
    snapshot.spot.openOrders,
    snapshot.margin.openOrders,
    snapshot.usdm.openOrders,
    snapshot.usdm.positions,
  ];
  return required.every(Array.isArray)
    ? available('orders-positions', ordersPositionsValue(snapshot), PRIVATE_READ_SOURCE)
    : unavailable(
        'orders-positions',
        'PRIVATE_ORDERS_POSITIONS_INCOMPLETE',
        PRIVATE_READ_SOURCE,
      );
}

function accountSurface(
  supervisor: Readonly<SystemSupervisorReadModel>,
  snapshot: Readonly<PrivateReadSnapshot>,
): Readonly<ProductRuntimeOwnerTruthSurfaceCut> {
  const supervisorObservedAt = validObservedAt(supervisor.evaluatedAtMs) ?? 0;
  if (snapshot.schemaVersion !== 'binance.private-read.v1') {
    return unavailableSurface(
      'account',
      supervisorObservedAt,
      ACCOUNT_MAX_AGE_MS,
      'PRIVATE_ACCOUNT_SNAPSHOT_MALFORMED',
      'UNAVAILABLE',
      PRIVATE_READ_SOURCE,
    );
  }
  const privateObservedAt = validObservedAt(snapshot.observedAt)
    ?? validObservedAt(snapshot.permissionPosture.observedAt);
  const accountObservedAt = privateObservedAt ?? supervisorObservedAt;
  if (snapshot.state === 'NOT_CONFIGURED') {
    return unavailableSurface(
      'account',
      accountObservedAt,
      ACCOUNT_MAX_AGE_MS,
      'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED',
      'NOT_CONFIGURED',
      PRIVATE_READ_SOURCE,
    );
  }
  if (privateObservedAt === null) {
    return unavailableSurface(
      'account',
      supervisorObservedAt,
      ACCOUNT_MAX_AGE_MS,
      'PRIVATE_ACCOUNT_OBSERVED_AT_INVALID',
      'UNAVAILABLE',
      PRIVATE_READ_SOURCE,
    );
  }

  const allocatable = printable(supervisor.summaries.capital.allocatableAmount);
  const accountTruthState = safeIdentifier(supervisor.summaries.capital.accountTruthState);
  const fields: Record<string, Readonly<ProductRuntimeOwnerTruthField>> = {
    'spot-truth': productTruth(
      'spot-truth',
      snapshot.spot.state,
      spotValue(snapshot),
      'SPOT',
      snapshot.spot.observedAt !== null
        && Array.isArray(snapshot.spot.balances)
        && Array.isArray(snapshot.spot.openOrders)
        && Array.isArray(snapshot.spot.fills),
    ),
    'usdm-truth': productTruth(
      'usdm-truth',
      snapshot.usdm.state,
      usdmValue(snapshot),
      'USDM',
      snapshot.usdm.observedAt !== null
        && Array.isArray(snapshot.usdm.balances)
        && Array.isArray(snapshot.usdm.positions)
        && Array.isArray(snapshot.usdm.openOrders)
        && Array.isArray(snapshot.usdm.fills),
    ),
    'margin-truth': productTruth(
      'margin-truth',
      snapshot.margin.state,
      marginValue(snapshot),
      'MARGIN',
      snapshot.margin.observedAt !== null
        && exactDecimal(snapshot.margin.totalAssetBtc) !== null
        && exactDecimal(snapshot.margin.totalLiabilityBtc) !== null
        && exactDecimal(snapshot.margin.totalNetAssetBtc) !== null
        && Array.isArray(snapshot.margin.assets)
        && Array.isArray(snapshot.margin.openOrders)
        && Array.isArray(snapshot.margin.fills),
    ),
    'balances-equity-collateral': unavailable(
      'balances-equity-collateral',
      'EQUITY_COLLATERAL_VALUATION_NOT_PUBLISHED',
      PRIVATE_READ_SOURCE,
    ),
    'available-capital': answered(
      'available-capital',
      allocatable === null
        ? null
        : line([
            `allocatableAmount=${allocatable}`,
            accountTruthState === null ? null : `accountTruthState=${accountTruthState}`,
          ]),
      'AVAILABLE_CAPITAL_NOT_PUBLISHED',
      SUPERVISOR_SOURCE,
    ),
    'permissions-modes': permissionField(snapshot),
    'orders-positions': ordersPositionsField(snapshot),
    'liabilities-interest': snapshot.margin.state === 'NOT_CONFIGURED'
      ? unavailable(
          'liabilities-interest',
          'MARGIN_PRIVATE_READ_NOT_CONFIGURED',
          PRIVATE_READ_SOURCE,
          'NOT_CONFIGURED',
        )
      : snapshot.margin.state === 'UNAVAILABLE'
        ? unavailable(
            'liabilities-interest',
            'MARGIN_PRIVATE_READ_UNAVAILABLE',
            PRIVATE_READ_SOURCE,
          )
        : snapshot.margin.state === 'PARTIAL'
          ? unavailable(
              'liabilities-interest',
              'MARGIN_PRIVATE_READ_PARTIAL',
              PRIVATE_READ_SOURCE,
            )
          : answered(
              'liabilities-interest',
              liabilitiesValue(snapshot),
              'MARGIN_LIABILITIES_NOT_AVAILABLE',
              PRIVATE_READ_SOURCE,
            ),
    'freshness-completeness': freshnessField(snapshot),
    reconciliation: reconciliationField(snapshot),
    'foreign-manual': unavailable(
      'foreign-manual',
      'FOREIGN_MANUAL_PROVENANCE_NOT_PUBLISHED',
      PRIVATE_READ_SOURCE,
    ),
  };
  return availableSurface(
    'account',
    accountObservedAt,
    ACCOUNT_MAX_AGE_MS,
    PRIVATE_READ_SOURCE,
    fields,
    accountTruthState,
  );
}

function normalizedSourceState(value: unknown): ProductRuntimeOwnerTruthMarketSourceState {
  return value === 'fresh' ? 'fresh' : 'unavailable';
}

function marketRows(
  input: Readonly<ProductRuntimeOwnerTruthMarketsInput>,
): readonly Readonly<ProductRuntimeOwnerTruthMarketRow>[] {
  if (!Array.isArray(input.rows)) return Object.freeze([]);
  return Object.freeze(input.rows
    .slice(0, MAX_MARKET_ROWS)
    .filter((row) => safeSymbol(row?.symbol) !== null));
}

function numberFragment(label: string, value: unknown): string | null {
  const bounded = finite(value);
  return bounded === null ? null : `${label}=${String(bounded)}`;
}

function publicAnswered(
  fieldId: string,
  value: string | null,
  unavailableReason: string,
): Readonly<ProductRuntimeOwnerTruthField> {
  return value === null
    ? unavailable(fieldId, unavailableReason, MARKET_SOURCE)
    : available(fieldId, value, MARKET_SOURCE, 'LIVE_PUBLIC');
}

function marketWith(
  rows: readonly Readonly<ProductRuntimeOwnerTruthMarketRow>[],
  predicate: (row: Readonly<ProductRuntimeOwnerTruthMarketRow>) => boolean,
): Readonly<ProductRuntimeOwnerTruthMarketRow> | null {
  return rows.find(predicate) ?? null;
}

function basisRow(
  rows: readonly Readonly<ProductRuntimeOwnerTruthMarketRow>[],
): Readonly<ProductRuntimeOwnerTruthMarketRow> | null {
  let selected: Readonly<ProductRuntimeOwnerTruthMarketRow> | null = null;
  let selectedMagnitude = -1;
  for (const row of rows) {
    const basis = finite(row.executableBasisBestPct) ?? finite(row.basisPct);
    if (basis === null || Math.abs(basis) <= selectedMagnitude) continue;
    selected = row;
    selectedMagnitude = Math.abs(basis);
  }
  return selected;
}

function basisValue(row: Readonly<ProductRuntimeOwnerTruthMarketRow> | null): string | null {
  if (row === null) return null;
  return line([
    `symbol=${row.symbol}`,
    numberFragment('executableBasisBestPct', row.executableBasisBestPct),
    numberFragment('reportedBasisPct', row.basisPct),
    row.executableBasisSide === undefined || row.executableBasisSide === null
      ? null
      : `side=${row.executableBasisSide}`,
  ]);
}

function liquidityValue(rows: readonly Readonly<ProductRuntimeOwnerTruthMarketRow>[]): string | null {
  const row = marketWith(rows, (candidate) => (
    finite(candidate.spotSpreadPct) !== null
    || finite(candidate.perpSpreadPct) !== null
    || finite(candidate.spotTopQuoteUsd) !== null
    || finite(candidate.perpTopQuoteUsd) !== null
  ));
  if (row === null) return null;
  return line([
    `symbol=${row.symbol}`,
    numberFragment('spotSpreadPct', row.spotSpreadPct),
    numberFragment('spotTopQuoteUsd', row.spotTopQuoteUsd),
    numberFragment('perpSpreadPct', row.perpSpreadPct),
    numberFragment('perpTopQuoteUsd', row.perpTopQuoteUsd),
  ]);
}

function derivativesValue(rows: readonly Readonly<ProductRuntimeOwnerTruthMarketRow>[]): string | null {
  const row = marketWith(rows, (candidate) => (
    finite(candidate.fundingRate) !== null
    || finite(candidate.openInterestUsd) !== null
    || finite(candidate.liquidations15mUsd) !== null
  ));
  if (row === null) return null;
  return line([
    `symbol=${row.symbol}`,
    numberFragment('fundingRate', row.fundingRate),
    numberFragment('fundingAnnualPct', row.fundingAnnualPct),
    numberFragment('openInterestUsd', row.openInterestUsd),
    numberFragment('oiToPerpVolume24h', row.oiToPerpVolume24h),
    numberFragment('liquidations15mUsd', row.liquidations15mUsd),
    numberFragment('longLiquidations15mUsd', row.longLiquidations15mUsd),
    numberFragment('shortLiquidations15mUsd', row.shortLiquidations15mUsd),
  ]);
}

function marketSurface(
  input: Readonly<ProductRuntimeOwnerTruthMarketsInput>,
  fallbackObservedAtMs: number,
): Readonly<ProductRuntimeOwnerTruthSurfaceCut> {
  const observedAtMs = validObservedAt(input.observedAtMs);
  if (observedAtMs === null) {
    return unavailableSurface(
      'markets',
      fallbackObservedAtMs,
      MARKETS_MAX_AGE_MS,
      'MARKET_SOURCE_OBSERVED_AT_INVALID',
      'UNAVAILABLE',
      MARKET_SOURCE,
    );
  }
  if (!Array.isArray(input.rows)) {
    return unavailableSurface(
      'markets',
      observedAtMs,
      MARKETS_MAX_AGE_MS,
      'MARKET_ROWS_MALFORMED',
      'UNAVAILABLE',
      MARKET_SOURCE,
    );
  }
  const sourceStates = Object.freeze({
    spotBookTicker: normalizedSourceState(input.dataSources?.spotBookTicker),
    futuresBookTicker: normalizedSourceState(input.dataSources?.futuresBookTicker),
    futures24hTicker: normalizedSourceState(input.dataSources?.futures24hTicker),
  });
  if (Object.values(sourceStates).every((state) => state === 'unavailable')) {
    return unavailableSurface(
      'markets',
      observedAtMs,
      MARKETS_MAX_AGE_MS,
      'MARKET_PUBLIC_SOURCES_UNAVAILABLE',
      'UNAVAILABLE',
      MARKET_SOURCE,
    );
  }
  const rows = marketRows(input);
  const strongestBasis = basisRow(rows);
  const allSourcesFresh = Object.values(sourceStates).every((state) => state === 'fresh');
  const dataQuality = line([
    `rowsReceived=${Array.isArray(input.rows) ? input.rows.length : 0}`,
    `rowsBounded=${rows.length}`,
    `truncated=${Array.isArray(input.rows) && input.rows.length > MAX_MARKET_ROWS ? 'YES' : 'NO'}`,
    `spotBookTicker=${sourceStates.spotBookTicker}`,
    `futuresBookTicker=${sourceStates.futuresBookTicker}`,
    `futures24hTicker=${sourceStates.futures24hTicker}`,
  ]);
  const sourceFreshness = line([
    `observedAtMs=${observedAtMs}`,
    `spotBookTicker=${sourceStates.spotBookTicker}`,
    `futuresBookTicker=${sourceStates.futuresBookTicker}`,
    `futures24hTicker=${sourceStates.futures24hTicker}`,
  ]);
  const fields: Record<string, Readonly<ProductRuntimeOwnerTruthField>> = {
    basis: publicAnswered(
      'basis',
      basisValue(strongestBasis),
      'MARKET_BASIS_NOT_AVAILABLE',
    ),
    'wake-up': unavailable(
      'wake-up',
      'MARKET_WAKE_UP_SEMANTICS_NOT_PUBLISHED',
      MARKET_SOURCE,
    ),
    flow: unavailable(
      'flow',
      'MARKET_FLOW_SEMANTICS_NOT_PUBLISHED',
      MARKET_SOURCE,
    ),
    liquidity: publicAnswered(
      'liquidity',
      liquidityValue(rows),
      'MARKET_LIQUIDITY_NOT_AVAILABLE',
    ),
    derivatives: publicAnswered(
      'derivatives',
      derivativesValue(rows),
      'MARKET_DERIVATIVES_NOT_AVAILABLE',
    ),
    'data-quality': publicAnswered(
      'data-quality',
      dataQuality,
      'MARKET_DATA_QUALITY_NOT_AVAILABLE',
    ),
    'candidate-focus': unavailable(
      'candidate-focus',
      'MARKET_CANDIDATE_FOCUS_NOT_PUBLISHED',
      MARKET_SOURCE,
    ),
    'source-freshness': allSourcesFresh
      ? publicAnswered(
          'source-freshness',
          sourceFreshness,
          'MARKET_SOURCE_FRESHNESS_NOT_AVAILABLE',
        )
      : unavailable(
          'source-freshness',
          'MARKET_PUBLIC_SOURCES_PARTIAL',
          MARKET_SOURCE,
        ),
    'q-assessment': unavailable(
      'q-assessment',
      'MARKET_Q_ASSESSMENT_NOT_PUBLISHED',
      MARKET_SOURCE,
    ),
  };
  return availableSurface(
    'markets',
    observedAtMs,
    MARKETS_MAX_AGE_MS,
    MARKET_SOURCE,
    fields,
    null,
    'LIVE_PUBLIC',
  );
}

/**
 * Pure owner-truth composition. The caller supplies one already sampled
 * supervisor cut, one current PrivateRead snapshot, and the same bounded public
 * Markets projection used by `/api/markets`; this function performs no I/O.
 */
export function projectProductRuntimeOwnerTruthCut(
  input: Readonly<ProductRuntimeOwnerTruthProjectionInput>,
): Readonly<ProductRuntimeOwnerTruthCut> {
  const supervisorObservedAt = validObservedAt(input.supervisor.evaluatedAtMs) ?? 0;
  const dashboard = dashboardSurface(input.supervisor);
  const account = accountSurface(input.supervisor, input.privateRead);
  const markets = marketSurface(input.markets, supervisorObservedAt);
  const cutObservedAtMs = Math.max(
    dashboard.observedAtMs,
    account.observedAtMs,
    markets.observedAtMs,
  );
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA,
    source: OWNER_SOURCE,
    observedAtMs: cutObservedAtMs,
    surfaces: Object.freeze([dashboard, account, markets]),
  });
}
