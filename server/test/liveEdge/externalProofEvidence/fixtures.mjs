import {
  RUNTIME_UNIVERSE_DEFAULTS,
  RUNTIME_UNIVERSE_SOURCE_IDS,
  parseExchangeInformation,
} from '../../../dist/intelligenceRuntime/universe/index.js';
import {
  L04_BINANCE_MATRIX_SHA256,
  L04_EXCHANGE_INFO_CONTRACT_IDS,
  normalizeRuntimeInstrumentRegistry,
  preflightInstrumentSizing,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  L15_SATELLITE_EVIDENCE,
} from '../../../dist/liveEdge/adapters/externalProofEvidence/index.js';
import {
  projectMachineGraphEvidence,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  ASSEMBLED_AT_MS,
  acceptedL12Snapshot,
  completeInput as completeL13Input,
} from '../machineGraphEvidence/fixtures.mjs';

export const EVALUATED_AT_MS = ASSEMBLED_AT_MS + 1_000;
export const IMPLEMENTATION_REVISION = '1'.repeat(40);

const CONFIG = Object.freeze({
  ...RUNTIME_UNIVERSE_DEFAULTS,
  configurationVersion: 'l16-external-proof-fixture-v1',
  universePolicy: Object.freeze({ ...RUNTIME_UNIVERSE_DEFAULTS.universePolicy }),
});

function localChecks() {
  return [
    ['SERVER_BUILD', null],
    ['L16_FOCUSED', 32],
    ['IMPORT_PURITY', 4],
    ['ACCUMULATED_LIVE_EDGE', 900],
    ['PROTOCOL', 40],
    ['NPM_TEST', 120],
    ['TEST_ALL', 1_200],
    ['DIFF_CHECK', null],
  ].map(([check, assertions]) => ({ check, exitCode: 0, assertions }));
}

export function baseEvidence() {
  const at = EVALUATED_AT_MS;
  const revision = IMPLEMENTATION_REVISION;
  return [
    {
      subject: 'LOCAL_BUILD_AND_TESTS', evidenceId: 'l16-local-verification', reasonCodes: [],
      kind: 'LOCAL_VERIFICATION', sourceRevision: revision, verifiedAtMs: at,
      checks: localChecks(),
    },
    {
      subject: 'SYNTHETIC_FAULT_AND_REPLAY', evidenceId: 'l16-synthetic-replay',
      reasonCodes: ['SYNTHETIC_TEST_ONLY'], kind: 'DETERMINISTIC_REPLAY',
      authority: 'SYNTHETIC_TEST', sourceRevision: revision, verifiedAtMs: at,
      exitCode: 0, scenarioCount: 8, assertions: 24, deterministic: true, networkFree: true,
    },
    {
      subject: 'LANE_RUNTIME_WIRING', evidenceId: 'l16-runtime-wiring',
      reasonCodes: ['RUNTIME_COMPOSITION_UNWIRED'], kind: 'ADAPTER_INTEGRATION_STATE',
      sourceRevision: revision, integrationState: 'UNWIRED', runtimeCompositionObserved: false,
    },
    {
      subject: 'L15_DEPLOYMENT_ARTIFACTS', evidenceId: 'l16-l15-satellite', reasonCodes: [],
      kind: 'L15_SATELLITE_ACCEPTANCE', ...L15_SATELLITE_EVIDENCE,
      acceptedSatellite: true, merged: false, wired: false, deployed: false, live: false,
    },
    {
      subject: 'PUBLIC_RUNTIME_OBSERVATION', evidenceId: 'l16-public-runtime',
      reasonCodes: ['EXTERNAL_OBSERVATION_NOT_PERFORMED'], kind: 'EXTERNAL_NON_PERFORMANCE',
      actionClass: 'PUBLIC_RUNTIME_OBSERVATION', performed: false, checkedAtMs: at,
    },
    {
      subject: 'PRIVATE_ACCOUNT_AND_RECONCILIATION_TRUTH', evidenceId: 'l16-private-truth',
      reasonCodes: ['AUTHORIZATION_MISSING'], kind: 'EXTERNAL_AUTHORIZATION_GAP',
      expectedActionClass: 'READ_ONLY_PRIVATE_BINANCE_ACCESS', authorizationState: 'MISSING',
      observedActionClass: null, authorizationExpiresAtMs: null, checkedAtMs: at,
    },
    {
      subject: 'DEPLOYED_EC2_APPLICATION_AND_COCKPIT', evidenceId: 'l16-ec2-app',
      reasonCodes: ['DEPLOYED_APPLICATION_PROOF_ABSENT'], kind: 'ABSENT_RUNTIME_EVIDENCE',
      requiredProof: 'DEPLOYED_APP_AND_COCKPIT', evidenceState: 'ABSENT',
      infrastructureSignal: 'EC2_STATUS_OK_ONLY', checkedAtMs: at,
    },
    {
      subject: 'CLOUDFLARE_TUNNEL_AND_ACCESS', evidenceId: 'l16-cloudflare',
      reasonCodes: ['ORIGIN_AND_ACCESS_PROOF_ABSENT'], kind: 'ABSENT_RUNTIME_EVIDENCE',
      requiredProof: 'CLOUDFLARE_ORIGIN_AND_ACCESS', evidenceState: 'ABSENT',
      infrastructureSignal: 'TUNNEL_HEALTHY_ONLY', checkedAtMs: at,
    },
    {
      subject: 'SERVICE_RESTART_AND_DEGRADED_BEHAVIOR', evidenceId: 'l16-restart',
      reasonCodes: ['AUTHORIZATION_MISSING'], kind: 'EXTERNAL_AUTHORIZATION_GAP',
      expectedActionClass: 'SERVICE_RESTART', authorizationState: 'MISSING',
      observedActionClass: null, authorizationExpiresAtMs: null, checkedAtMs: at,
    },
    ...['SPOT_SIGNED_TEST_ORDER', 'USD_M_SIGNED_TEST_ORDER', 'MARGIN_SIGNED_TEST_ORDER'].map(
      (subject) => ({
        subject, evidenceId: `l16-${subject.toLowerCase()}`, reasonCodes: ['REPOSITORY_POLICY_BLOCK'],
        kind: 'REPOSITORY_POLICY_BLOCK', policy: 'NO_SIGNED_TEST_ORDERS',
        performed: false, checkedAtMs: at,
      }),
    ),
    {
      subject: 'MARGIN_BORROW_AND_REPAY', evidenceId: 'l16-margin-borrow-repay',
      reasonCodes: ['REPOSITORY_POLICY_BLOCK'], kind: 'REPOSITORY_POLICY_BLOCK',
      policy: 'NO_BORROW_REPAY', performed: false, checkedAtMs: at,
    },
    ...['LIVE_ORDER', 'STRATEGY_LIVE_TICKET'].map((subject) => ({
      subject, evidenceId: `l16-${subject.toLowerCase()}`, reasonCodes: ['LIVE_EXECUTION_NOT_IMPLEMENTED'],
      kind: 'REPOSITORY_POLICY_BLOCK', policy: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      performed: false, checkedAtMs: at,
    })),
    {
      subject: 'I00_COMBINED_FAN_IN', evidenceId: 'l16-i00-deferral',
      reasonCodes: ['INTEGRATION_DEFERRED_TO_I00'], kind: 'I00_INTEGRATION_DEFERRAL',
      target: 'I00', integrationState: 'DEFERRED', merged: false, wired: false, deployed: false,
    },
    {
      subject: 'CURRENT_FILTER_ADMISSION', evidenceId: 'l16-current-filter-absent',
      reasonCodes: ['CURRENT_FILTER_OWNER_VERDICT_ABSENT'], kind: 'ABSENT_RUNTIME_EVIDENCE',
      requiredProof: 'CURRENT_FILTER_OWNER_VERDICT', evidenceState: 'ABSENT',
      infrastructureSignal: 'NONE', checkedAtMs: at,
    },
  ];
}

export function completeInput() {
  const l12Snapshot = acceptedL12Snapshot();
  const l13Snapshot = projectMachineGraphEvidence(completeL13Input(l12Snapshot));
  return {
    evaluatedAtMs: EVALUATED_AT_MS,
    implementationRevision: IMPLEMENTATION_REVISION,
    l12Snapshot,
    l13Snapshot,
    evidence: baseEvidence(),
  };
}

function usdMRegistry(symbolCount = 1) {
  const receivedTimeMs = EVALUATED_AT_MS - 1_000;
  const rows = Array.from({ length: symbolCount }, (_, index) => {
    const baseAsset = `A${String(index).padStart(4, '0')}`;
    const symbol = `${baseAsset}USDT`;
    return {
    symbol, pair: symbol, contractType: 'PERPETUAL',
    deliveryDate: 4_133_404_800_000, onboardDate: receivedTimeMs - 1_000_000,
    status: 'TRADING', baseAsset, quoteAsset: 'USDT', marginAsset: 'USDT',
    pricePrecision: 3, quantityPrecision: 3, baseAssetPrecision: 8, quotePrecision: 8,
    underlyingType: 'COIN', underlyingSubType: [], orderTypes: ['LIMIT', 'MARKET'],
    timeInForce: ['GTC', 'IOC'],
    filters: [
      { filterType: 'PRICE_FILTER', minPrice: '0.100', maxPrice: '1000000.000', tickSize: '0.100' },
      { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000.000', stepSize: '0.001' },
      { filterType: 'MIN_NOTIONAL', notional: '5.000' },
    ],
  };
  });
  const parsed = parseExchangeInformation(
    { timezone: 'UTC', serverTime: receivedTimeMs - 10, exchangeFilters: [], symbols: rows },
    {
      source: 'USD_M_PERPETUAL', sourceId: RUNTIME_UNIVERSE_SOURCE_IDS.USD_M_PERPETUAL,
      dataset: 'usd_m.exchange_info', receivedTimeMs, evaluatedAtMs: receivedTimeMs, config: CONFIG,
    },
  );
  const normalized = normalizeRuntimeInstrumentRegistry({
    matrixSha256: L04_BINANCE_MATRIX_SHA256,
    contractId: L04_EXCHANGE_INFO_CONTRACT_IDS.USD_M_PERPETUAL,
    product: 'USD_M_PERPETUAL', environment: 'PRODUCTION',
    evaluatedAtMs: EVALUATED_AT_MS, maximumAgeMs: 60_000,
    metadata: parsed.listings.map(({ metadata }) => metadata),
  });
  if (!normalized.ok) throw new Error(normalized.reasonCodes.join(','));
  return normalized.snapshot;
}

export function canonicalFilterEvidence(symbolCount = 1) {
  const ownerSnapshot = usdMRegistry(symbolCount);
  const instrument = ownerSnapshot.instruments[0];
  const request = {
    symbol: instrument.symbol, instrumentRevision: instrument.instrumentRevision,
    side: 'BUY', orderType: 'LIMIT', timeInForce: 'GTC', requestedPrice: '0.01',
    referencePrice: null, requestedQuantity: '1', notionalAsset: 'USDT',
    approvedNotional: '100', intendedExposure: '100', evaluatedAtMs: EVALUATED_AT_MS,
  };
  const ownerResult = preflightInstrumentSizing(ownerSnapshot, request);
  if (ownerResult.staticState !== 'BLOCKED') throw new Error('fixture must reproduce BLOCKED');
  return {
    subject: 'CURRENT_FILTER_ADMISSION', evidenceId: 'l16-current-owner-filter',
    reasonCodes: [...ownerResult.reasonCodes], kind: 'CURRENT_OWNER_FILTER_VERDICT',
    expectedSubject: {
      product: ownerSnapshot.product, environment: ownerSnapshot.environment,
      snapshotRevision: ownerSnapshot.snapshotRevision, request,
    },
    ownerSnapshot,
    ownerResult,
  };
}

export function withCanonicalFilter(input = completeInput()) {
  input.evidence[input.evidence.length - 1] = canonicalFilterEvidence();
  return input;
}
