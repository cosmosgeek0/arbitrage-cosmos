import { createHash } from 'node:crypto';

import {
  PRIVATE_DATA_BOUNDS,
  deepFreezePrivate,
  privateAccountRealmReference,
  privateArray,
  privateIdentifier,
  privateInteger,
  privateRecord,
  privateSortedUnique,
  privateString,
  snapshotPrivateData,
} from './bounds.js';
import { L05_BINANCE_MATRIX_SHA256 } from './contracts.js';
import { normalizePrivateFactEvidence } from './normalize.js';
import { evaluatePrivatePermissions } from './permissions.js';
import {
  L05_PRIVATE_PROJECTION_SCHEMA,
  L05_PRIVATE_SOURCE_CUT_SCHEMA,
  NO_PRIVATE_ACTION_AUTHORITY,
  PRIVATE_FACT_KINDS,
  PRIVATE_HISTORY_COVERAGE_FACT_KINDS,
  PRIVATE_TRUTH_POSTURES,
  type NormalizedPrivateFact,
  type PrivateFactKind,
  type PrivateHistoryCoverageFactKind,
  type PrivateHistoryCoverageRequirement,
  type PrivateLifecycleReconciliationObservation,
  type PrivatePermissionDecision,
  type PrivateProduct,
  type PrivateProductProjection,
  type PrivateTruthCompleteness,
  type PrivateTruthPosture,
  type PrivateTruthProjection,
} from './types.js';

const MAXIMUM_FUTURE_SKEW_MS = 2_000;

const INPUT_FIELDS = Object.freeze([
  'matrixSha256', 'posture', 'accountRealmId', 'targetSymbol', 'evaluatedAtMs', 'facts',
  'permissions', 'historyCoverageRequirements', 'reconciliationObservation',
] as const);
const INPUT_FIELDS_WITHOUT_HISTORY_COVERAGE = Object.freeze(
  INPUT_FIELDS.filter((field) => field !== 'historyCoverageRequirements'),
);

const SOURCE_CUT_INPUT_FIELDS = Object.freeze([
  'matrixSha256', 'posture', 'accountRealmId', 'targetSymbol', 'evaluatedAtMs', 'facts',
  'permissions',
] as const);

const AUTHORITY_FIELDS = Object.freeze([
  'sendEligible', 'accountReadAuthority', 'mutationAuthority',
  'reconciliationAuthority', 'capitalAuthority', 'riskAuthority',
  'externalActionAuthorization', 'actionAuthority',
] as const);

const FACT_FIELDS = Object.freeze([
  'schema', 'matrixSha256', 'factKind', 'product', 'environment', 'realm',
  'accountRealmId', 'profileId', 'contractId', 'sourceId', 'schemaRevision',
  'queryScope', 'querySymbol', 'queryAsset', 'queryType', 'marginMode',
  'queryCoverage',
  'receiptId', 'readState', 'authority', 'completeness', 'sourceTimeMs',
  'receivedAtMs', 'maxAgeMs', 'injectedValue', 'value', 'contentRevision',
  'evidenceRevision', 'freshness', 'validUntilMs', 'usableAsPrivateEvidence',
  'reasonCodes', ...AUTHORITY_FIELDS, 'contentBlockingCodes',
] as const);

const PERMISSION_FIELDS = Object.freeze([
  'profileClass', 'profileId', 'accountRealmId', 'accountFingerprintRef',
  'environment', 'deployedEgressMatch', 'permissions', 'accountStatus',
  'apiTradingLocked', 'usdmDualSidePosition', 'usdmMultiAssetsMargin',
  'marginMode', 'posture', 'acceptableForOwnerReview', 'reasonCodes', 'revision',
  ...AUTHORITY_FIELDS,
] as const);

const RECONCILIATION_FIELDS = Object.freeze([
  'owner', 'status', 'resultRevision', 'sourceCutRevision', 'observedAtMs',
  'productCutRevisions', 'executionAuthority',
] as const);
const HISTORY_COVERAGE_REQUIREMENT_FIELDS = Object.freeze([
  'owner', 'status', 'requirementRevision', 'accountRealmId', 'posture',
  'targetSymbol', 'factKind', 'factEvidenceRevision', 'sourceCutRevision',
  'startTimeMs', 'endTimeMs', 'executionAuthority',
] as const);
const PRODUCT_CUT_FIELDS = Object.freeze([
  'SPOT', 'USD_M_PERPETUAL', 'MARGIN',
] as const);

const PROJECTION_FIELDS = Object.freeze([
  'schema', 'matrixSha256', 'posture', 'accountRealmId', 'targetSymbol', 'evaluatedAtMs',
  'sourceFacts', 'permissions', 'historyCoverageRequirements',
  'reconciliationObservation', 'validUntilMs',
  'spot', 'futures', 'margin', 'completeness', 'entryEvidenceComplete',
  'reasonCodes', 'semanticRevision', 'evidenceRevision', 'projectionRevision',
  ...AUTHORITY_FIELDS,
] as const);

const PERMISSION_EVIDENCE_FIELDS = Object.freeze([
  'ipRestrict', 'createTime', 'enableReading', 'enableWithdrawals',
  'enableInternalTransfer', 'enableMargin', 'enableFutures',
  'permitsUniversalTransfer', 'enableVanillaOptions', 'enableFixApiTrade',
  'enableFixReadOnly', 'enableSpotAndMarginTrading',
  'enablePortfolioMarginTrading',
] as const);

const PERMISSION_BOOLEAN_FIELDS = Object.freeze([
  'ipRestrict', 'enableReading', 'enableWithdrawals', 'enableInternalTransfer',
  'enableMargin', 'enableFutures', 'permitsUniversalTransfer',
  'enableVanillaOptions', 'enableFixApiTrade', 'enableFixReadOnly',
  'enableSpotAndMarginTrading', 'enablePortfolioMarginTrading',
] as const);

const REQUIRED: Readonly<Record<PrivateProduct, readonly PrivateFactKind[]>> = Object.freeze({
  SPOT: Object.freeze<readonly PrivateFactKind[]>([
    'SPOT_PERMISSIONS', 'SPOT_ACCOUNT', 'SPOT_OPEN_ORDERS', 'SPOT_TRADES',
    'SPOT_COMMISSIONS', 'SPOT_ACCOUNT_STATUS', 'SPOT_TRADING_STATUS',
  ]),
  USD_M_PERPETUAL: Object.freeze<readonly PrivateFactKind[]>([
    'USDM_PERMISSIONS', 'USDM_ACCOUNT', 'USDM_BALANCE', 'USDM_POSITIONS',
    'USDM_OPEN_ORDERS', 'USDM_ALGO_OPEN_ORDERS', 'USDM_TRADES',
    'USDM_COMMISSIONS', 'USDM_INCOME',
    'USDM_ADL', 'USDM_ACCOUNT_CONFIGURATION', 'USDM_SYMBOL_CONFIGURATION',
    'USDM_ACCOUNT_STATUS', 'USDM_TRADING_STATUS',
    'USDM_MULTI_ASSETS_MODE', 'USDM_POSITION_MODE',
  ]),
  MARGIN: Object.freeze<readonly PrivateFactKind[]>([
    'MARGIN_PERMISSIONS', 'MARGIN_CROSS_ACCOUNT', 'MARGIN_OPEN_ORDERS',
    'MARGIN_TRADES', 'MARGIN_INTEREST', 'MARGIN_INTEREST_RATE',
    'MARGIN_INVENTORY', 'MARGIN_MAX_BORROWABLE',
    'MARGIN_BORROW_REPAY_HISTORY', 'MARGIN_ACCOUNT_STATUS', 'MARGIN_TRADING_STATUS',
  ]),
});

const OPEN_ORDER_FACT_KINDS = Object.freeze({
    SPOT: Object.freeze(['SPOT_OPEN_ORDERS'] as const),
    USD_M_PERPETUAL: Object.freeze([
      'USDM_OPEN_ORDERS', 'USDM_ALGO_OPEN_ORDERS',
    ] as const),
    MARGIN: Object.freeze(['MARGIN_OPEN_ORDERS'] as const),
  } as const satisfies Readonly<Record<
    PrivateProduct,
    readonly PrivateFactKind[]
  >>);

export interface ProjectPrivateTruthInput {
  readonly matrixSha256: unknown;
  readonly posture: unknown;
  readonly accountRealmId: unknown;
  readonly targetSymbol: unknown;
  readonly evaluatedAtMs: unknown;
  readonly facts: unknown;
  readonly permissions: unknown;
  readonly historyCoverageRequirements?: unknown;
  readonly reconciliationObservation: unknown;
}

function privateProjectionInput(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return privateRecord(value, INPUT_FIELDS, 'private truth projection');
  }
  const hasHistoryCoverage = Object.hasOwn(value, 'historyCoverageRequirements');
  const record = privateRecord(
    value,
    hasHistoryCoverage ? INPUT_FIELDS : INPUT_FIELDS_WITHOUT_HISTORY_COVERAGE,
    'private truth projection',
  );
  return hasHistoryCoverage
    ? record
    : Object.freeze({ ...record, historyCoverageRequirements: Object.freeze([]) });
}

export interface DerivePrivateTruthSourceCutRevisionInput {
  readonly matrixSha256: unknown;
  readonly posture: unknown;
  readonly accountRealmId: unknown;
  readonly targetSymbol: unknown;
  readonly evaluatedAtMs: unknown;
  readonly facts: unknown;
  readonly permissions: unknown;
}

interface ValidatedPrivateEvidenceCut {
  readonly posture: PrivateTruthPosture;
  readonly accountRealmId: string;
  readonly targetSymbol: string | null;
  readonly evaluatedAtMs: number;
  readonly sourceFacts: readonly Readonly<NormalizedPrivateFact>[];
  readonly orderedPermissions: readonly Readonly<PrivatePermissionDecision>[];
  readonly permissionReasons: readonly string[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function revision(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function isNoAuthority(record: Readonly<Record<string, unknown>>): boolean {
  return record.sendEligible === false
    && record.accountReadAuthority === 'NONE'
    && record.mutationAuthority === 'NONE'
    && record.reconciliationAuthority === 'NONE'
    && record.capitalAuthority === 'NONE'
    && record.riskAuthority === 'NONE'
    && record.externalActionAuthorization === 'NONE'
    && record.actionAuthority === 'NONE_RECORD_ONLY';
}

function postureValue(value: unknown): PrivateTruthPosture {
  if (typeof value !== 'string'
    || !(PRIVATE_TRUTH_POSTURES as readonly string[]).includes(value)) {
    throw new TypeError('private projection posture is unsupported');
  }
  return value as PrivateTruthPosture;
}

function canonicalTargetSymbol(
  posture: PrivateTruthPosture,
  value: unknown,
): string | null {
  if (posture === 'SUPERVISION_ONLY') {
    if (value !== null) {
      throw new TypeError('supervision-only private projection cannot carry a target symbol');
    }
    return null;
  }
  const symbol = privateString(value, 'private projection targetSymbol', 128);
  if (symbol.normalize('NFC') !== symbol
    || symbol.toUpperCase() !== symbol
    || !/^[\p{L}\p{N}._-]+$/u.test(symbol)) {
    throw new TypeError('private projection targetSymbol must match the canonical L04 instrument token grammar');
  }
  return symbol;
}

function requiredProducts(posture: PrivateTruthPosture): readonly PrivateProduct[] {
  switch (posture) {
    case 'SPOT_NEW_EXPOSURE': return Object.freeze(['SPOT']);
    case 'USDM_NEW_EXPOSURE': return Object.freeze(['USD_M_PERPETUAL']);
    case 'SPOT_USDM_NEW_EXPOSURE': return Object.freeze(['SPOT', 'USD_M_PERPETUAL']);
    case 'MARGIN_NEW_EXPOSURE': return Object.freeze(['MARGIN']);
    case 'SUPERVISION_ONLY': return Object.freeze([]);
  }
}

function reasonArray(value: unknown, label: string): readonly string[] {
  const rows = privateArray(value, label, PRIVATE_DATA_BOUNDS.maximumMismatches);
  return privateSortedUnique(rows.map((row, index) => privateIdentifier(row, `${label}[${index}]`)));
}

function normalizedFact(value: unknown, evaluatedAtMs: number): Readonly<NormalizedPrivateFact> {
  const record = privateRecord(value, FACT_FIELDS, 'normalized private fact');
  const regenerated = normalizePrivateFactEvidence({
    schema: record.schema,
    matrixSha256: record.matrixSha256,
    factKind: record.factKind,
    product: record.product,
    environment: record.environment,
    realm: record.realm,
    accountRealmId: record.accountRealmId,
    profileId: record.profileId,
    contractId: record.contractId,
    queryScope: record.queryScope,
    querySymbol: record.querySymbol,
    queryAsset: record.queryAsset,
    queryType: record.queryType,
    marginMode: record.marginMode,
    queryCoverage: record.queryCoverage,
    sourceId: record.sourceId,
    schemaRevision: record.schemaRevision,
    receiptId: record.receiptId,
    readState: record.readState,
    authority: record.authority,
    completeness: record.completeness,
    sourceTimeMs: record.sourceTimeMs,
    receivedAtMs: record.receivedAtMs,
    maxAgeMs: record.maxAgeMs,
    value: record.injectedValue,
  }, evaluatedAtMs);
  if (canonicalJson(regenerated) !== canonicalJson(record)) {
    throw new TypeError('normalized private fact does not reproduce from its injected-value witness');
  }
  return regenerated;
}

function permissionDecision(
  value: unknown,
  posture: PrivateTruthPosture,
  accountRealmId: string,
): Readonly<PrivatePermissionDecision> {
  const record = privateRecord(value, PERMISSION_FIELDS, 'private permission decision');
  if (!isNoAuthority(record)
    || !['READ_KEY', 'EXECUTION_KEY'].includes(String(record.profileClass))
    || record.posture !== posture
    || record.accountRealmId !== accountRealmId
    || record.environment !== 'PRODUCTION'
    || typeof record.acceptableForOwnerReview !== 'boolean') {
    throw new TypeError('private permission decision contract mismatch');
  }
  privateIdentifier(record.profileId, 'private permission profile revision identity');
  privateIdentifier(record.revision, 'private permission revision');
  reasonArray(record.reasonCodes, 'private permission reasons');
  return record as unknown as Readonly<PrivatePermissionDecision>;
}

function reconciliationObservation(
  value: unknown,
  evaluatedAtMs: number,
  expectedSourceCutRevision: string,
  posture: PrivateTruthPosture,
): { readonly observation: Readonly<PrivateLifecycleReconciliationObservation> | null; readonly reasons: readonly string[] } {
  if (value === null) {
    return Object.freeze({ observation: null, reasons: Object.freeze(['FOUNDATION_RECONCILIATION_REQUIRED']) });
  }
  const record = privateRecord(value, RECONCILIATION_FIELDS, 'Foundation reconciliation observation');
  if (record.owner !== 'FOUNDATION_RECONCILIATION' || record.status !== 'EXACT'
    || record.executionAuthority !== 'NONE') {
    throw new TypeError('Foundation reconciliation observation authority mismatch');
  }
  const observedAtMs = privateInteger(record.observedAtMs, 'reconciliation observedAtMs');
  const reasons: string[] = [];
  if (observedAtMs > evaluatedAtMs + MAXIMUM_FUTURE_SKEW_MS) {
    reasons.push('FOUNDATION_RECONCILIATION_CLOCK_SKEWED');
  } else if (observedAtMs !== evaluatedAtMs) {
    // The owner observation carries no independent maximum-age contract. Only
    // an exact same-cut observation can therefore support completeness.
    reasons.push('FOUNDATION_RECONCILIATION_CUT_NOT_CURRENT');
  }
  const resultRevision = privateIdentifier(record.resultRevision, 'reconciliation result revision');
  if (!/^foundation-reconciliation-result:[0-9a-f]{24,64}$/.test(resultRevision)) {
    throw new TypeError('Foundation reconciliation result revision namespace mismatch');
  }
  const sourceCutRevision = privateIdentifier(record.sourceCutRevision, 'reconciliation source cut revision');
  if (!/^l05pcut_[0-9a-f]{64}$/.test(sourceCutRevision)) {
    throw new TypeError('Foundation reconciliation source cut revision namespace mismatch');
  }
  const cutRecord = privateRecord(
    record.productCutRevisions,
    PRODUCT_CUT_FIELDS,
    'Foundation reconciliation product cuts',
  );
  const productCutRevisions = Object.freeze({
    SPOT: cutRecord.SPOT === null
      ? null
      : privateIdentifier(cutRecord.SPOT, 'Spot lifecycle reconciliation revision'),
    USD_M_PERPETUAL: cutRecord.USD_M_PERPETUAL === null
      ? null
      : privateIdentifier(
          cutRecord.USD_M_PERPETUAL,
          'USD-M lifecycle reconciliation revision',
        ),
    MARGIN: cutRecord.MARGIN,
  });
  const products = requiredProducts(posture);
  if ((productCutRevisions.SPOT !== null
      && !/^spot_rest_[0-9a-f]{32}$/.test(productCutRevisions.SPOT))
    || (productCutRevisions.USD_M_PERPETUAL !== null
      && !/^usdm_rest_[0-9a-f]{32}$/.test(productCutRevisions.USD_M_PERPETUAL))) {
    throw new TypeError('Foundation reconciliation product cut namespace mismatch');
  }
  if ((products.includes('SPOT')) !== (productCutRevisions.SPOT !== null)
    || (products.includes('USD_M_PERPETUAL'))
      !== (productCutRevisions.USD_M_PERPETUAL !== null)
    || productCutRevisions.MARGIN !== null) {
    throw new TypeError('Foundation reconciliation product cuts do not match posture');
  }
  if (record.sourceCutRevision !== expectedSourceCutRevision) {
    reasons.push('FOUNDATION_RECONCILIATION_SOURCE_CUT_MISMATCH');
  }
  return Object.freeze({
    observation: Object.freeze({
      ...record,
      productCutRevisions,
    } as unknown as PrivateLifecycleReconciliationObservation),
    reasons: privateSortedUnique(reasons),
  });
}

interface ValidatedHistoryCoverageRequirements {
  readonly requirements: readonly Readonly<PrivateHistoryCoverageRequirement>[];
  readonly reasons: readonly string[];
  readonly reasonsByProduct: Readonly<Record<PrivateProduct, readonly string[]>>;
}

function historyProduct(factKind: PrivateHistoryCoverageFactKind): PrivateProduct {
  if (factKind === 'SPOT_TRADES') return 'SPOT';
  if (factKind === 'USDM_TRADES') return 'USD_M_PERPETUAL';
  return 'MARGIN';
}

function requiredHistoryKinds(
  posture: PrivateTruthPosture,
): readonly PrivateHistoryCoverageFactKind[] {
  const products = new Set(requiredProducts(posture));
  return PRIVATE_HISTORY_COVERAGE_FACT_KINDS.filter((kind) => (
    products.has(historyProduct(kind))
  ));
}

function validateHistoryCoverageRequirements(
  value: unknown,
  cut: Readonly<ValidatedPrivateEvidenceCut>,
  sourceCutRevision: string,
): Readonly<ValidatedHistoryCoverageRequirements> {
  const rows = privateArray(
    value,
    'Foundation history coverage requirements',
    PRIVATE_HISTORY_COVERAGE_FACT_KINDS.length,
  );
  const requirements = rows.map((row, index) => {
    const record = privateRecord(
      row,
      HISTORY_COVERAGE_REQUIREMENT_FIELDS,
      `Foundation history coverage requirements[${index}]`,
    );
    if (record.owner !== 'FOUNDATION_RECONCILIATION_HISTORY_COVERAGE'
      || record.status !== 'EXACT_REQUIREMENT'
      || record.executionAuthority !== 'NONE') {
      throw new TypeError('Foundation history coverage requirement authority mismatch');
    }
    const requirementRevision = privateIdentifier(
      record.requirementRevision,
      'Foundation history coverage requirement revision',
    );
    if (!/^foundation-history-coverage-requirement:[0-9a-f]{24}$/.test(
      requirementRevision,
    )) {
      throw new TypeError('Foundation history coverage requirement revision namespace mismatch');
    }
    const accountRealmId = privateAccountRealmReference(
      record.accountRealmId,
      'Foundation history coverage accountRealmId',
    );
    const posture = postureValue(record.posture);
    const targetSymbol = privateString(
      record.targetSymbol,
      'Foundation history coverage targetSymbol',
      128,
    );
    if (!PRIVATE_HISTORY_COVERAGE_FACT_KINDS.includes(record.factKind as never)) {
      throw new TypeError('Foundation history coverage fact kind is unsupported');
    }
    const factEvidenceRevision = privateIdentifier(
      record.factEvidenceRevision,
      'Foundation history coverage fact evidence revision',
    );
    if (!/^l05-private-fact-evidence:[0-9a-f]{24}$/.test(factEvidenceRevision)) {
      throw new TypeError('Foundation history coverage fact evidence revision namespace mismatch');
    }
    const boundSourceCutRevision = privateIdentifier(
      record.sourceCutRevision,
      'Foundation history coverage source cut revision',
    );
    if (!/^l05pcut_[0-9a-f]{64}$/.test(boundSourceCutRevision)) {
      throw new TypeError('Foundation history coverage source cut revision namespace mismatch');
    }
    const startTimeMs = privateInteger(
      record.startTimeMs,
      'Foundation history coverage startTimeMs',
    );
    const endTimeMs = privateInteger(
      record.endTimeMs,
      'Foundation history coverage endTimeMs',
    );
    return Object.freeze({
      owner: record.owner,
      status: record.status,
      requirementRevision,
      accountRealmId,
      posture,
      targetSymbol,
      factKind: record.factKind as PrivateHistoryCoverageFactKind,
      factEvidenceRevision,
      sourceCutRevision: boundSourceCutRevision,
      startTimeMs,
      endTimeMs,
      executionAuthority: record.executionAuthority,
    }) as Readonly<PrivateHistoryCoverageRequirement>;
  });
  const ordered = Object.freeze([...requirements].sort(compareCanonical));
  const expectedKinds = requiredHistoryKinds(cut.posture);
  const expected = new Set<PrivateHistoryCoverageFactKind>(expectedKinds);
  const reasons: string[] = [];
  const reasonsByProduct: Record<PrivateProduct, string[]> = {
    SPOT: [], USD_M_PERPETUAL: [], MARGIN: [],
  };
  const add = (kind: PrivateHistoryCoverageFactKind, reason: string): void => {
    reasons.push(reason);
    reasonsByProduct[historyProduct(kind)].push(reason);
  };
  if (new Set(ordered.map((item) => item.requirementRevision)).size !== ordered.length) {
    reasons.push('FOUNDATION_HISTORY_COVERAGE_DUPLICATE_REQUIREMENT_REVISION');
  }
  for (const requirement of ordered) {
    const kind = requirement.factKind;
    if (!expected.has(kind)) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_EXTRA_${kind}`);
      continue;
    }
    if (requirement.accountRealmId !== cut.accountRealmId) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_ACCOUNT_REALM_MISMATCH_${kind}`);
    }
    if (requirement.posture !== cut.posture) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_POSTURE_MISMATCH_${kind}`);
    }
    if (requirement.targetSymbol !== cut.targetSymbol) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_TARGET_MISMATCH_${kind}`);
    }
    if (requirement.sourceCutRevision !== sourceCutRevision) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_SOURCE_CUT_MISMATCH_${kind}`);
    }
    const facts = cut.sourceFacts.filter((fact) => fact.factKind === kind);
    if (facts.length !== 1) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_FACT_SET_MISMATCH_${kind}`);
      continue;
    }
    const fact = facts[0]!;
    if (requirement.factEvidenceRevision !== fact.evidenceRevision) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_FACT_REVISION_MISMATCH_${kind}`);
    }
    if (fact.queryCoverage.kind !== 'HISTORY_EXPLICIT_WINDOW'
      || requirement.startTimeMs !== fact.queryCoverage.startTimeMs
      || requirement.endTimeMs !== fact.queryCoverage.endTimeMs) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_WINDOW_MISMATCH_${kind}`);
    }
  }
  for (const kind of expectedKinds) {
    const matches = ordered.filter((item) => item.factKind === kind);
    if (matches.length === 0) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_REQUIREMENT_MISSING_${kind}`);
    } else if (matches.length > 1) {
      add(kind, `FOUNDATION_HISTORY_COVERAGE_REQUIREMENT_DUPLICATE_${kind}`);
    }
  }
  return Object.freeze({
    requirements: ordered,
    reasons: privateSortedUnique(reasons),
    reasonsByProduct: Object.freeze({
      SPOT: privateSortedUnique(reasonsByProduct.SPOT),
      USD_M_PERPETUAL: privateSortedUnique(reasonsByProduct.USD_M_PERPETUAL),
      MARGIN: privateSortedUnique(reasonsByProduct.MARGIN),
    }),
  });
}

function productProjection(
  product: PrivateProduct,
  facts: readonly Readonly<NormalizedPrivateFact>[],
  permissions: readonly Readonly<PrivatePermissionDecision>[],
  permissionReasons: readonly string[],
  historyCoverageReasons: readonly string[],
): Readonly<PrivateProductProjection> {
  const productFacts = facts.filter((fact) => fact.product === product);
  const grouped = new Map<PrivateFactKind, readonly Readonly<NormalizedPrivateFact>[]>();
  for (const kind of PRIVATE_FACT_KINDS) {
    const matches = productFacts.filter((fact) => fact.factKind === kind);
    if (matches.length > 0) grouped.set(kind, matches);
  }
  const reasons: string[] = [...permissionReasons, ...historyCoverageReasons];
  const readProfileId = permissions.find((item) => item.profileClass === 'READ_KEY')?.profileId;
  if (readProfileId === undefined) throw new TypeError('private projection READ_KEY decision is missing');

  if (product === 'MARGIN') {
    const profileModes = privateSortedUnique(permissions.map((item) => item.marginMode));
    const expectedFactMode = profileModes.length !== 1
      ? null
      : profileModes[0] === 'CROSS_CLASSIC'
        ? 'CROSS'
        : profileModes[0] === 'ISOLATED'
          ? 'ISOLATED'
          : null;
    if (profileModes.length !== 1) reasons.push('MARGIN_FACT_MODE_PROFILE_MISMATCH');
    else if (profileModes[0] === 'UNKNOWN') reasons.push('MARGIN_FACT_MODE_UNKNOWN');
    else if (profileModes[0] === 'ISOLATED') {
      // The current permission law cannot establish isolated symbol identity.
      // Matching isolated facts therefore remain explicitly blocking.
      reasons.push('ISOLATED_MARGIN_SYMBOL_IDENTITY_UNAVAILABLE');
    }
    for (const fact of productFacts) {
      if ((fact.factKind === 'MARGIN_OPEN_ORDERS'
          || fact.factKind === 'MARGIN_TRADES'
          || fact.factKind === 'MARGIN_INTEREST')
        && (expectedFactMode === null || fact.marginMode !== expectedFactMode)) {
        reasons.push(`FACT_MARGIN_MODE_MISMATCH_${fact.factKind}`);
      }
      if (fact.factKind === 'MARGIN_INVENTORY') {
        const expectedInventoryType = expectedFactMode === 'CROSS'
          ? 'MARGIN'
          : expectedFactMode === 'ISOLATED'
            ? 'ISOLATED'
            : null;
        if (expectedInventoryType === null || fact.queryType !== expectedInventoryType) {
          reasons.push('FACT_MARGIN_INVENTORY_TYPE_PROFILE_MISMATCH');
        }
      }
    }
  }

  if (product === 'USD_M_PERPETUAL') {
    const modeFacts = grouped.get('USDM_POSITION_MODE') ?? [];
    if (modeFacts.length === 1) {
      const modeValue = modeFacts[0]!.value as Readonly<{ dualSidePosition: boolean }>;
      const dualSidePosition = modeValue.dualSidePosition;
      if (typeof dualSidePosition !== 'boolean') {
        throw new TypeError('normalized USD-M position-mode fact lost its boolean posture');
      }
      if (permissions.some((decision) => (
        decision.usdmDualSidePosition !== dualSidePosition
      ))) {
        reasons.push('USDM_POSITION_MODE_FACT_PERMISSION_MISMATCH');
      }
      const sideBearingKinds = Object.freeze([
        'USDM_ACCOUNT', 'USDM_POSITIONS', 'USDM_OPEN_ORDERS',
        'USDM_ALGO_OPEN_ORDERS', 'USDM_TRADES',
      ] as const satisfies readonly PrivateFactKind[]);
      for (const kind of sideBearingKinds) {
        for (const fact of grouped.get(kind) ?? []) {
          if (!fact.usableAsPrivateEvidence || fact.value === null) continue;
          const rows = kind === 'USDM_ACCOUNT'
            ? (fact.value as Readonly<{
                positions: readonly Readonly<{ positionSide: string }>[];
              }>).positions
            : fact.value as readonly Readonly<{ positionSide: string }>[];
          if (!Array.isArray(rows)) {
            throw new TypeError(`normalized ${kind} fact lost its position-side rows`);
          }
          if (!dualSidePosition && rows.some((row) => row.positionSide !== 'BOTH')) {
            reasons.push(`USDM_ONE_WAY_POSITION_SIDE_MISMATCH_${kind}`);
          }
          if (dualSidePosition && rows.some((row) => row.positionSide === 'BOTH')) {
            reasons.push(`USDM_HEDGE_POSITION_SIDE_MISMATCH_${kind}`);
          }
        }
      }
    }
  }

  for (const fact of productFacts) {
    if ((OPEN_ORDER_FACT_KINDS[product] as readonly PrivateFactKind[])
      .includes(fact.factKind)
      && fact.queryScope !== 'ALL_SYMBOLS') {
      reasons.push(`FACT_OPEN_ORDERS_NOT_ALL_SYMBOLS_${fact.factKind}`);
    }
    if (!fact.factKind.endsWith('_PERMISSIONS')
      && fact.contractId !== null
      && fact.profileId !== readProfileId) {
      reasons.push(`FACT_READ_PROFILE_MISMATCH_${fact.factKind}`);
    }
  }
  for (const kind of REQUIRED[product]) {
    const matches = grouped.get(kind) ?? [];
    if (kind.endsWith('_PERMISSIONS')) {
      const expectedProfiles = privateSortedUnique(permissions.map((item) => item.profileId));
      const observedProfiles = privateSortedUnique(matches.flatMap((item) => (
        item.profileId === null ? [] : [item.profileId]
      )));
      if (matches.length === 0) reasons.push(`FACT_MISSING_${kind}`);
      else if (matches.length !== 2 || observedProfiles.length !== 2
        || expectedProfiles.some((item, index) => item !== observedProfiles[index])) {
        reasons.push(`FACT_PERMISSION_PROFILE_SET_MISMATCH_${kind}`);
      }
      for (const item of matches) {
        if (!item.usableAsPrivateEvidence) reasons.push(`FACT_UNUSABLE_${kind}`, ...item.reasonCodes);
        const matchingDecision = permissions.find((decision) => decision.profileId === item.profileId);
        if (matchingDecision !== undefined) {
          const payload = privateRecord(
            item.value,
            PERMISSION_EVIDENCE_FIELDS,
            `${kind} normalized permission evidence`,
          );
          if (PERMISSION_BOOLEAN_FIELDS.some((field) => (
            payload[field] !== matchingDecision.permissions[field]
          ))) {
            reasons.push(`FACT_PERMISSION_PAYLOAD_MISMATCH_${kind}`);
          }
        }
      }
    } else if (matches.length === 0) reasons.push(`FACT_MISSING_${kind}`);
    else if (matches.length > 1) reasons.push(`FACT_DUPLICATE_${kind}`);
    else if (!matches[0]!.usableAsPrivateEvidence) {
      reasons.push(`FACT_UNUSABLE_${kind}`, ...matches[0]!.reasonCodes);
    }
  }
  if (product === 'MARGIN' && grouped.has('MARGIN_ISOLATED_ACCOUNT')) {
    reasons.push('ISOLATED_MARGIN_NOT_SELECTED_BY_CURRENT_PERMISSION_POSTURE');
  }
  const reasonCodes = privateSortedUnique(reasons);
  let completeness: PrivateTruthCompleteness;
  if (productFacts.length === 0) completeness = 'UNKNOWN';
  else completeness = reasonCodes.length === 0 ? 'COMPLETE' : 'PARTIAL';
  return deepFreezePrivate({
    product,
    completeness,
    factKinds: privateSortedUnique(productFacts.map((fact) => fact.factKind)) as readonly PrivateFactKind[],
    contentRevisions: privateSortedUnique(productFacts.map((fact) => fact.contentRevision)),
    evidenceRevisions: privateSortedUnique(productFacts.map((fact) => fact.evidenceRevision)),
    reasonCodes,
  });
}

function compareCanonical(left: unknown, right: unknown): number {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function projectionValidUntil(
  facts: readonly Readonly<NormalizedPrivateFact>[],
): number | null {
  const candidates = facts.flatMap((fact) => (
    fact.validUntilMs === null ? [] : [fact.validUntilMs]
  ));
  return candidates.length === 0 ? null : Math.min(...candidates);
}

function validatePrivateEvidenceCut(
  input: Readonly<Record<string, unknown>>,
): Readonly<ValidatedPrivateEvidenceCut> {
  if (input.matrixSha256 !== L05_BINANCE_MATRIX_SHA256) {
    throw new TypeError('private projection matrix SHA mismatch');
  }
  const posture = postureValue(input.posture);
  const accountRealmId = privateAccountRealmReference(input.accountRealmId, 'accountRealmId');
  const targetSymbol = canonicalTargetSymbol(posture, input.targetSymbol);
  const evaluatedAtMs = privateInteger(input.evaluatedAtMs, 'evaluatedAtMs');
  const factRows = privateArray(input.facts, 'private facts', PRIVATE_DATA_BOUNDS.maximumSources);
  const facts = factRows.map((fact) => normalizedFact(fact, evaluatedAtMs));

  const duplicateEvidence = facts.map((fact) => fact.evidenceRevision);
  if (new Set(duplicateEvidence).size !== duplicateEvidence.length) {
    throw new TypeError('private facts contain duplicate evidence revisions');
  }
  if (facts.some((fact) => fact.accountRealmId !== accountRealmId)) {
    throw new TypeError('private fact account realm mismatch');
  }
  const relevantProducts = requiredProducts(posture);
  if (targetSymbol !== null && facts.some((fact) => (
    relevantProducts.includes(fact.product)
      && fact.queryScope === 'SYMBOL'
      && fact.querySymbol !== targetSymbol
  ))) {
    throw new TypeError('private fact query symbol does not match projection target');
  }
  const sourceFacts = Object.freeze([...facts].sort(compareCanonical));

  const permissionRows = privateArray(input.permissions, 'permission decisions', 2);
  if (permissionRows.length !== 2) throw new TypeError('exactly two permission profile decisions are required');
  const permissions = permissionRows.map((item) => permissionDecision(item, posture, accountRealmId));
  if (permissions[0]!.profileClass === permissions[1]!.profileClass
    || new Set(permissions.map((item) => item.profileId)).size !== 2
    || new Set(permissions.map((item) => item.revision)).size !== 2) {
    throw new TypeError('permission decisions must bind distinct read and execution profiles');
  }
  const orderedPermissions = Object.freeze([...permissions].sort((left, right) => (
    left.profileClass === right.profileClass ? 0 : left.profileClass === 'READ_KEY' ? -1 : 1
  )));
  const regeneratedPermissions = evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId,
    accountFingerprintRef: orderedPermissions[0]!.accountFingerprintRef,
    readProfile: {
      profileClass: orderedPermissions[0]!.profileClass,
      profileId: orderedPermissions[0]!.profileId,
      accountRealmId: orderedPermissions[0]!.accountRealmId,
      accountFingerprintRef: orderedPermissions[0]!.accountFingerprintRef,
      environment: orderedPermissions[0]!.environment,
      deployedEgressMatch: orderedPermissions[0]!.deployedEgressMatch,
      permissions: orderedPermissions[0]!.permissions,
      accountStatus: orderedPermissions[0]!.accountStatus,
      apiTradingLocked: orderedPermissions[0]!.apiTradingLocked,
      usdmDualSidePosition: orderedPermissions[0]!.usdmDualSidePosition,
      usdmMultiAssetsMargin: orderedPermissions[0]!.usdmMultiAssetsMargin,
      marginMode: orderedPermissions[0]!.marginMode,
    },
    executionProfile: {
      profileClass: orderedPermissions[1]!.profileClass,
      profileId: orderedPermissions[1]!.profileId,
      accountRealmId: orderedPermissions[1]!.accountRealmId,
      accountFingerprintRef: orderedPermissions[1]!.accountFingerprintRef,
      environment: orderedPermissions[1]!.environment,
      deployedEgressMatch: orderedPermissions[1]!.deployedEgressMatch,
      permissions: orderedPermissions[1]!.permissions,
      accountStatus: orderedPermissions[1]!.accountStatus,
      apiTradingLocked: orderedPermissions[1]!.apiTradingLocked,
      usdmDualSidePosition: orderedPermissions[1]!.usdmDualSidePosition,
      usdmMultiAssetsMargin: orderedPermissions[1]!.usdmMultiAssetsMargin,
      marginMode: orderedPermissions[1]!.marginMode,
    },
  });
  if (canonicalJson(regeneratedPermissions) !== canonicalJson(orderedPermissions)) {
    throw new TypeError('private permission decisions are not revision-coherent');
  }
  const permissionReasons = privateSortedUnique(orderedPermissions.flatMap((item) => (
    item.acceptableForOwnerReview ? [] : item.reasonCodes
  )));
  return Object.freeze({
    posture,
    accountRealmId,
    targetSymbol,
    evaluatedAtMs,
    sourceFacts,
    orderedPermissions,
    permissionReasons,
  });
}

function privateTruthSourceCutRevision(
  cut: Readonly<ValidatedPrivateEvidenceCut>,
): string {
  return revision('l05pcut_', {
    schema: L05_PRIVATE_SOURCE_CUT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: cut.posture,
    accountRealmId: cut.accountRealmId,
    targetSymbol: cut.targetSymbol,
    evaluatedAtMs: cut.evaluatedAtMs,
    sourceFacts: cut.sourceFacts,
    permissions: cut.orderedPermissions,
  });
}

/**
 * Derives only the deterministic identity of an exact, fully revalidated
 * private-evidence cut. It does not create a Foundation reconciliation result
 * or grant reconciliation, account-read, Risk, Capital, or action authority.
 */
export function derivePrivateTruthSourceCutRevision(inputValue: unknown): string {
  const input = privateRecord(
    snapshotPrivateData(inputValue),
    SOURCE_CUT_INPUT_FIELDS,
    'private truth source cut',
  );
  return privateTruthSourceCutRevision(validatePrivateEvidenceCut(input));
}

/**
 * Assembles an immutable evidence cut without owning account state, allocation,
 * risk, or reconciliation. Product completeness is never borrowed from a
 * sibling product or a connected stream.
 */
export function projectPrivateTruth(inputValue: unknown): Readonly<PrivateTruthProjection> {
  const input = privateProjectionInput(snapshotPrivateData(inputValue));
  const cut = validatePrivateEvidenceCut(input);
  const {
    posture,
    accountRealmId,
    targetSymbol,
    evaluatedAtMs,
    sourceFacts,
    orderedPermissions,
    permissionReasons,
  } = cut;
  const sourceCutRevision = privateTruthSourceCutRevision(cut);
  const historyCoverage = validateHistoryCoverageRequirements(
    input.historyCoverageRequirements,
    cut,
    sourceCutRevision,
  );
  const relevant = new Set(requiredProducts(posture));
  const spot = productProjection(
    'SPOT',
    sourceFacts,
    orderedPermissions,
    relevant.has('SPOT') ? permissionReasons : [],
    historyCoverage.reasonsByProduct.SPOT,
  );
  const futures = productProjection(
    'USD_M_PERPETUAL',
    sourceFacts,
    orderedPermissions,
    relevant.has('USD_M_PERPETUAL') ? permissionReasons : [],
    historyCoverage.reasonsByProduct.USD_M_PERPETUAL,
  );
  const margin = productProjection(
    'MARGIN',
    sourceFacts,
    orderedPermissions,
    relevant.has('MARGIN') ? permissionReasons : [],
    historyCoverage.reasonsByProduct.MARGIN,
  );
  const byProduct: Readonly<Record<PrivateProduct, Readonly<PrivateProductProjection>>> = {
    SPOT: spot,
    USD_M_PERPETUAL: futures,
    MARGIN: margin,
  };
  const reconciliation = reconciliationObservation(
    input.reconciliationObservation,
    evaluatedAtMs,
    sourceCutRevision,
    posture,
  );
  const required = requiredProducts(posture);
  const reasons = privateSortedUnique([
    ...permissionReasons,
    ...required.flatMap((product) => byProduct[product].reasonCodes),
    ...historyCoverage.reasons,
    ...reconciliation.reasons,
    ...(posture === 'SUPERVISION_ONLY' ? ['SUPERVISION_ONLY_NOT_ENTRY_EVIDENCE'] : []),
  ]);
  const requiredProductsComplete = required.length > 0
    && required.every((product) => byProduct[product].completeness === 'COMPLETE');
  const entryEvidenceComplete = posture !== 'SUPERVISION_ONLY'
    && requiredProductsComplete
    && permissionReasons.length === 0
    && historyCoverage.reasons.length === 0
    && reconciliation.observation !== null
    && reconciliation.reasons.length === 0;
  const completeness: PrivateTruthCompleteness = entryEvidenceComplete
    ? 'COMPLETE'
    : sourceFacts.length === 0 ? 'UNKNOWN' : 'PARTIAL';
  const validUntilMs = projectionValidUntil(sourceFacts);

  const semantic = {
    schema: L05_PRIVATE_PROJECTION_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId,
    targetSymbol,
    permissions: orderedPermissions.map((item) => item.revision),
    historyCoverageRequirements: historyCoverage.requirements.map((item) => ({
      requirementRevision: item.requirementRevision,
      factKind: item.factKind,
      factEvidenceRevision: item.factEvidenceRevision,
      sourceCutRevision: item.sourceCutRevision,
      startTimeMs: item.startTimeMs,
      endTimeMs: item.endTimeMs,
    })),
    products: {
      spot: { factKinds: spot.factKinds, contentRevisions: spot.contentRevisions },
      futures: { factKinds: futures.factKinds, contentRevisions: futures.contentRevisions },
      margin: { factKinds: margin.factKinds, contentRevisions: margin.contentRevisions },
    },
  };
  const semanticRevision = revision('l05psem_', semantic);
  const evidenceRevision = revision('l05pevd_', {
    semanticRevision,
    sourceFacts,
    historyCoverageRequirements: historyCoverage.requirements,
    reconciliationObservation: reconciliation.observation,
  });
  const projectionRevision = revision('l05proj_', {
    semanticRevision,
    evidenceRevision,
    evaluatedAtMs,
    validUntilMs,
    completeness,
    entryEvidenceComplete,
    reasonCodes: reasons,
  });

  return deepFreezePrivate({
    schema: L05_PRIVATE_PROJECTION_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId,
    targetSymbol,
    evaluatedAtMs,
    sourceFacts,
    permissions: orderedPermissions,
    historyCoverageRequirements: historyCoverage.requirements,
    reconciliationObservation: reconciliation.observation,
    validUntilMs,
    spot,
    futures,
    margin,
    completeness,
    entryEvidenceComplete,
    reasonCodes: reasons,
    semanticRevision,
    evidenceRevision,
    projectionRevision,
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}

/**
 * Rebuilds an untrusted projection from its raw fact witnesses and permission
 * witnesses, then requires byte-for-byte canonical equality with the supplied
 * cut. Consumers never trust projection summaries or revisions in isolation.
 */
export function validatePrivateTruthProjection(
  value: unknown,
): Readonly<PrivateTruthProjection> {
  const candidate = privateRecord(
    snapshotPrivateData(value),
    PROJECTION_FIELDS,
    'private truth projection validation',
  );
  if (candidate.schema !== L05_PRIVATE_PROJECTION_SCHEMA
    || candidate.matrixSha256 !== L05_BINANCE_MATRIX_SHA256
    || !isNoAuthority(candidate)) {
    throw new TypeError('private truth projection contract mismatch');
  }
  const sourceFacts = privateArray(
    candidate.sourceFacts,
    'private projection source facts',
    PRIVATE_DATA_BOUNDS.maximumSources,
  );
  const regenerated = projectPrivateTruth({
    matrixSha256: candidate.matrixSha256,
    posture: candidate.posture,
    accountRealmId: candidate.accountRealmId,
    targetSymbol: candidate.targetSymbol,
    evaluatedAtMs: candidate.evaluatedAtMs,
    facts: sourceFacts,
    permissions: candidate.permissions,
    historyCoverageRequirements: candidate.historyCoverageRequirements,
    reconciliationObservation: candidate.reconciliationObservation,
  });
  if (canonicalJson(candidate) !== canonicalJson(regenerated)) {
    throw new TypeError('private truth projection is not canonically reproducible');
  }
  return regenerated;
}
