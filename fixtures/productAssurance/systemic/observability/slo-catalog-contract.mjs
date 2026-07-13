import {
  assertArray,
  assertBoolean,
  assertBoundedString,
  assertClosedRecord,
  assertEnum,
  assertGitSha,
  assertSafeInteger,
  assertSha256,
  assertUnique,
  sortedUniqueStrings,
} from './reference-helpers.mjs';
import {
  sha256CanonicalJson,
  sha256CanonicalJsonExcluding,
} from './canonical-sha256.mjs';

export const SLO_CATEGORIES = Object.freeze([
  'SOURCE_COHERENCE_AGE', 'QUEUE_BACKPRESSURE', 'PROCESSING_COMMAND_LATENCY',
  'AMBIGUITY_DURATION', 'RECONCILIATION_LAG', 'EVIDENCE_EXPIRY',
  'TELEMETRY_COMPLETENESS', 'RECOVERY_VERIFICATION', 'SENTINEL_PAGING_DELIVERY',
  'RESTART_RTO_RPO', 'RESOURCE_BUDGET',
]);

export const HISTORICAL_METRIC_CONTRACTS = Object.freeze([
  ['source-age-percentiles', 'SOURCE_AGE_PERCENTILES', 'INTELLIGENCE_RUNTIME', 'milliseconds', ['P50', 'P95', 'P99']],
  ['processing-age-percentiles', 'PROCESSING_AGE_PERCENTILES', 'I08_SUPERVISOR', 'milliseconds', ['P50', 'P95', 'P99']],
  ['cross-source-skew', 'CROSS_SOURCE_SKEW', 'INTELLIGENCE_RUNTIME', 'milliseconds', ['P50', 'P95', 'P99']],
  ['queue-depth-backpressure', 'QUEUE_DEPTH_BACKPRESSURE', 'I08_SUPERVISOR', 'events', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['dropped-coalesced-events', 'DROPPED_COALESCED_EVENTS', 'TELEMETRY_OWNER', 'events', ['COUNT', 'RATE']],
  ['reconciliation-gap', 'RECONCILIATION_GAP', 'FOUNDATION_RECONCILIATION', 'milliseconds', ['P50', 'P95', 'P99']],
  ['ambiguity-duration', 'AMBIGUITY_DURATION', 'FOUNDATION_RECONCILIATION', 'milliseconds', ['P50', 'P95', 'P99']],
  ['automatic-recovery-result-rate', 'AUTOMATIC_RECOVERY_RESULT_RATE', 'CONTROL_PLANE', 'ratio', ['COUNT', 'RATE']],
  ['execution-cost', 'EXECUTION_COST', 'CAPITAL_SUPERVISION', 'quote-asset', ['P50', 'P95', 'P99', 'SUM']],
  ['slippage', 'SLIPPAGE', 'CAPITAL_SUPERVISION', 'basis-points', ['P50', 'P95', 'P99']],
  ['funding', 'FUNDING', 'CAPITAL_SUPERVISION', 'quote-asset', ['P50', 'P95', 'P99', 'SUM']],
  ['borrow-interest', 'BORROW_INTEREST', 'CAPITAL_SUPERVISION', 'quote-asset', ['P50', 'P95', 'P99', 'SUM']],
  ['market-impact', 'MARKET_IMPACT', 'CAPITAL_SUPERVISION', 'basis-points', ['P50', 'P95', 'P99']],
  ['incident-frequency', 'INCIDENT_FREQUENCY', 'I08_SUPERVISOR', 'incidents', ['COUNT', 'RATE']],
  ['recurring-failed-invariants', 'RECURRING_FAILED_INVARIANTS', 'I08_SUPERVISOR', 'invariant-failures', ['COUNT', 'RATE']],
  ['cpu-budget', 'CPU_BUDGET', 'I00_OPERATIONS', 'percent', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['memory-budget', 'MEMORY_BUDGET', 'I00_OPERATIONS', 'bytes', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['disk-budget', 'DISK_BUDGET', 'I00_OPERATIONS', 'bytes', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['wal-budget', 'WAL_BUDGET', 'EXISTING_LEDGER', 'bytes', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['api-rate-budget', 'API_RATE_BUDGET', 'EXCHANGE_GATEWAY', 'request-weight', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['telemetry-budget', 'TELEMETRY_BUDGET', 'TELEMETRY_OWNER', 'events', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['token-budget', 'TOKEN_BUDGET', 'DIAGNOSTIC_PLANE', 'tokens', ['P50', 'P95', 'P99', 'UTILIZATION']],
  ['cost-budget', 'COST_BUDGET', 'I00_OPERATIONS', 'quote-asset', ['P50', 'P95', 'P99', 'SUM', 'UTILIZATION']],
].map(([metricId, family, ownerId, unit, statistics]) => Object.freeze({
  metricId,
  family,
  ownerId,
  unit,
  statistics: Object.freeze(statistics),
  maximumSeriesPoints: 1024,
  retentionWindowMs: 604800000,
})));

export const HISTORICAL_METRIC_FAMILIES = Object.freeze(
  HISTORICAL_METRIC_CONTRACTS.map((entry) => entry.family),
);

const historicalSource = (metricId, family, statistic) => Object.freeze({
  kind: 'HISTORICAL_METRIC_STATISTIC', metricId, family, statistic,
});
const ownerEvidenceSource = (ownerId, evidenceKind) => Object.freeze({
  kind: 'CANONICAL_OWNER_EVIDENCE', ownerId, evidenceKind,
});

export const SLO_SUBOBJECTIVE_CONTRACTS = Object.freeze([
  ['source-age', 'SOURCE_COHERENCE_AGE', 'INTELLIGENCE_RUNTIME', historicalSource('source-age-percentiles', 'SOURCE_AGE_PERCENTILES', 'P95')],
  ['cross-source-coherence', 'SOURCE_COHERENCE_AGE', 'INTELLIGENCE_RUNTIME', historicalSource('cross-source-skew', 'CROSS_SOURCE_SKEW', 'P95')],
  ['queue-depth-backpressure', 'QUEUE_BACKPRESSURE', 'I08_SUPERVISOR', historicalSource('queue-depth-backpressure', 'QUEUE_DEPTH_BACKPRESSURE', 'UTILIZATION')],
  ['dropped-coalesced-events', 'QUEUE_BACKPRESSURE', 'TELEMETRY_OWNER', historicalSource('dropped-coalesced-events', 'DROPPED_COALESCED_EVENTS', 'RATE')],
  ['processing-latency', 'PROCESSING_COMMAND_LATENCY', 'I08_SUPERVISOR', historicalSource('processing-age-percentiles', 'PROCESSING_AGE_PERCENTILES', 'P95')],
  ['command-latency', 'PROCESSING_COMMAND_LATENCY', 'I08_SUPERVISOR', ownerEvidenceSource('I08_SUPERVISOR', 'COMMAND_ROUND_TRIP_EVIDENCE')],
  ['ambiguity-duration', 'AMBIGUITY_DURATION', 'FOUNDATION_RECONCILIATION', historicalSource('ambiguity-duration', 'AMBIGUITY_DURATION', 'P95')],
  ['reconciliation-lag', 'RECONCILIATION_LAG', 'FOUNDATION_RECONCILIATION', historicalSource('reconciliation-gap', 'RECONCILIATION_GAP', 'P95')],
  ['evidence-expiry', 'EVIDENCE_EXPIRY', 'I08_SUPERVISOR', ownerEvidenceSource('I08_SUPERVISOR', 'EVIDENCE_EXPIRY_EVALUATION')],
  ['telemetry-completeness', 'TELEMETRY_COMPLETENESS', 'TELEMETRY_OWNER', ownerEvidenceSource('TELEMETRY_OWNER', 'TELEMETRY_COMPLETENESS_EVIDENCE')],
  ['automatic-recovery-result', 'RECOVERY_VERIFICATION', 'CONTROL_PLANE', historicalSource('automatic-recovery-result-rate', 'AUTOMATIC_RECOVERY_RESULT_RATE', 'RATE')],
  ['recovery-verification', 'RECOVERY_VERIFICATION', 'CONTROL_PLANE', ownerEvidenceSource('CONTROL_PLANE', 'INDEPENDENT_RECOVERY_VERIFICATION')],
  ['sentinel-delivery', 'SENTINEL_PAGING_DELIVERY', 'I08_SUPERVISOR', ownerEvidenceSource('I08_SUPERVISOR', 'SENTINEL_DELIVERY_RECEIPT')],
  ['paging-delivery', 'SENTINEL_PAGING_DELIVERY', 'I08_SUPERVISOR', ownerEvidenceSource('I08_SUPERVISOR', 'PAGING_DELIVERY_RECEIPT')],
  ['paging-acknowledgement', 'SENTINEL_PAGING_DELIVERY', 'I08_SUPERVISOR', ownerEvidenceSource('I08_SUPERVISOR', 'PAGING_ACKNOWLEDGEMENT_RECEIPT')],
  ['restart-rto', 'RESTART_RTO_RPO', 'I00_OPERATIONS', ownerEvidenceSource('I00_OPERATIONS', 'RESTART_RTO_EVIDENCE')],
  ['restart-rpo', 'RESTART_RTO_RPO', 'I00_OPERATIONS', ownerEvidenceSource('I00_OPERATIONS', 'RESTART_RPO_EVIDENCE')],
  ['cpu-budget', 'RESOURCE_BUDGET', 'I00_OPERATIONS', historicalSource('cpu-budget', 'CPU_BUDGET', 'UTILIZATION')],
  ['memory-budget', 'RESOURCE_BUDGET', 'I00_OPERATIONS', historicalSource('memory-budget', 'MEMORY_BUDGET', 'UTILIZATION')],
  ['disk-budget', 'RESOURCE_BUDGET', 'I00_OPERATIONS', historicalSource('disk-budget', 'DISK_BUDGET', 'UTILIZATION')],
  ['wal-budget', 'RESOURCE_BUDGET', 'EXISTING_LEDGER', historicalSource('wal-budget', 'WAL_BUDGET', 'UTILIZATION')],
  ['api-rate-budget', 'RESOURCE_BUDGET', 'EXCHANGE_GATEWAY', historicalSource('api-rate-budget', 'API_RATE_BUDGET', 'UTILIZATION')],
  ['telemetry-budget', 'RESOURCE_BUDGET', 'TELEMETRY_OWNER', historicalSource('telemetry-budget', 'TELEMETRY_BUDGET', 'UTILIZATION')],
  ['token-budget', 'RESOURCE_BUDGET', 'DIAGNOSTIC_PLANE', historicalSource('token-budget', 'TOKEN_BUDGET', 'UTILIZATION')],
  ['cost-budget', 'RESOURCE_BUDGET', 'I00_OPERATIONS', historicalSource('cost-budget', 'COST_BUDGET', 'UTILIZATION')],
].map(([sloId, category, ownerId, measurementSource]) => Object.freeze({
  sloId, version: 1, category, ownerId, measurementSource,
})));

export const SLO_SUBOBJECTIVE_IDS = Object.freeze(SLO_SUBOBJECTIVE_CONTRACTS.map((entry) => entry.sloId));

const STATISTICS = ['P50', 'P95', 'P99', 'COUNT', 'RATE', 'SUM', 'UTILIZATION'];

function assertIdentifier(value, path) {
  assertBoundedString(value, path, 1, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) throw new TypeError(`${path} is not a stable identifier`);
}

function catalogSloKey(value) {
  return `${value.sloId}@${value.version}`;
}

function validateEffectPolicy(value, path) {
  assertClosedRecord(value, path, [
    'authority', 'mayMutateCapital', 'mayMutateControls', 'mayExecuteRepair', 'riskReductionMustRemainAvailable',
  ]);
  assertEnum(value.authority, ['EVIDENCE_ONLY'], `${path}.authority`);
  for (const key of ['mayMutateCapital', 'mayMutateControls', 'mayExecuteRepair', 'riskReductionMustRemainAvailable']) {
    assertBoolean(value[key], `${path}.${key}`);
  }
  if (value.mayMutateCapital || value.mayMutateControls || value.mayExecuteRepair
      || !value.riskReductionMustRemainAvailable) {
    throw new TypeError(`${path} violates the evidence-only authority boundary`);
  }
}

export function validateSloMeasurementSource(value, path) {
  if (value?.kind === 'HISTORICAL_METRIC_STATISTIC') {
    assertClosedRecord(value, path, ['kind', 'metricId', 'family', 'statistic']);
    assertEnum(value.kind, ['HISTORICAL_METRIC_STATISTIC'], `${path}.kind`);
    assertIdentifier(value.metricId, `${path}.metricId`);
    assertEnum(value.family, HISTORICAL_METRIC_FAMILIES, `${path}.family`);
    assertEnum(value.statistic, STATISTICS, `${path}.statistic`);
    return;
  }
  assertClosedRecord(value, path, ['kind', 'ownerId', 'evidenceKind']);
  assertEnum(value.kind, ['CANONICAL_OWNER_EVIDENCE'], `${path}.kind`);
  assertIdentifier(value.ownerId, `${path}.ownerId`);
  assertIdentifier(value.evidenceKind, `${path}.evidenceKind`);
}

function validateCatalogSlo(value, index) {
  const path = `catalog.slos[${index}]`;
  assertClosedRecord(value, path, [
    'sloId', 'version', 'category', 'ownerId', 'definitionSchemaVersion',
    'definitionSha256', 'measurementSource', 'historicalMetricBindings', 'syntheticWindow',
    'truthLabel', 'authority', 'evidenceOnly',
  ]);
  assertIdentifier(value.sloId, `${path}.sloId`);
  assertSafeInteger(value.version, `${path}.version`, 1, 1_000_000);
  assertEnum(value.category, SLO_CATEGORIES, `${path}.category`);
  assertIdentifier(value.ownerId, `${path}.ownerId`);
  assertEnum(value.definitionSchemaVersion, ['slo-trend.v1'], `${path}.definitionSchemaVersion`);
  assertSha256(value.definitionSha256, `${path}.definitionSha256`);
  validateSloMeasurementSource(value.measurementSource, `${path}.measurementSource`);
  assertArray(value.historicalMetricBindings, `${path}.historicalMetricBindings`, 1);
  value.historicalMetricBindings.forEach((binding, child) => {
    const childPath = `${path}.historicalMetricBindings[${child}]`;
    assertClosedRecord(binding, childPath, ['metricId', 'family']);
    assertIdentifier(binding.metricId, `${childPath}.metricId`);
    assertEnum(binding.family, HISTORICAL_METRIC_FAMILIES, `${childPath}.family`);
  });
  assertUnique(
    value.historicalMetricBindings,
    (binding) => `${binding.metricId}|${binding.family}`,
    `${path}.historicalMetricBindings`,
  );
  if (value.measurementSource.kind === 'HISTORICAL_METRIC_STATISTIC') {
    if (value.historicalMetricBindings.length !== 1
        || value.historicalMetricBindings[0].metricId !== value.measurementSource.metricId
        || value.historicalMetricBindings[0].family !== value.measurementSource.family) {
      throw new TypeError(`${path}.historicalMetricBindings must exactly mirror the historical measurement source`);
    }
  } else if (value.historicalMetricBindings.length !== 0 || value.measurementSource.ownerId !== value.ownerId) {
    throw new TypeError(`${path} canonical owner evidence cannot borrow a historical proxy or a different owner`);
  }
  assertClosedRecord(value.syntheticWindow, `${path}.syntheticWindow`, ['windowId', 'startMs', 'endMs', 'sampleCount']);
  assertIdentifier(value.syntheticWindow.windowId, `${path}.syntheticWindow.windowId`);
  assertSafeInteger(value.syntheticWindow.startMs, `${path}.syntheticWindow.startMs`);
  assertSafeInteger(value.syntheticWindow.endMs, `${path}.syntheticWindow.endMs`);
  if (value.syntheticWindow.startMs >= value.syntheticWindow.endMs) {
    throw new TypeError(`${path}.syntheticWindow must have startMs < endMs`);
  }
  assertSafeInteger(value.syntheticWindow.sampleCount, `${path}.syntheticWindow.sampleCount`, 1, 2048);
  assertEnum(value.truthLabel, ['SYNTHETIC_ONLY'], `${path}.truthLabel`);
  assertEnum(value.authority, ['SYNTHETIC_TEST'], `${path}.authority`);
  assertBoolean(value.evidenceOnly, `${path}.evidenceOnly`);
  if (!value.evidenceOnly) throw new TypeError(`${path}.evidenceOnly must be true`);
}

function validateMetric(value, index) {
  const path = `catalog.historicalMetricRegistry[${index}]`;
  assertClosedRecord(value, path, [
    'metricId', 'family', 'ownerId', 'unit', 'statistics', 'maximumSeriesPoints',
    'retentionWindowMs', 'truthLabel', 'authority', 'evidenceOnly',
  ]);
  assertIdentifier(value.metricId, `${path}.metricId`);
  assertEnum(value.family, HISTORICAL_METRIC_FAMILIES, `${path}.family`);
  assertIdentifier(value.ownerId, `${path}.ownerId`);
  assertBoundedString(value.unit, `${path}.unit`, 1, 40);
  assertArray(value.statistics, `${path}.statistics`, 7);
  if (value.statistics.length === 0) throw new TypeError(`${path}.statistics must not be empty`);
  value.statistics.forEach((statistic, child) => assertEnum(statistic, STATISTICS, `${path}.statistics[${child}]`));
  assertUnique(value.statistics, (statistic) => statistic, `${path}.statistics`);
  assertSafeInteger(value.maximumSeriesPoints, `${path}.maximumSeriesPoints`, 1, 100_000);
  assertSafeInteger(value.retentionWindowMs, `${path}.retentionWindowMs`, 1, 31_536_000_000);
  assertEnum(value.truthLabel, ['SYNTHETIC_ONLY'], `${path}.truthLabel`);
  assertEnum(value.authority, ['SYNTHETIC_TEST'], `${path}.authority`);
  assertBoolean(value.evidenceOnly, `${path}.evidenceOnly`);
  if (!value.evidenceOnly) throw new TypeError(`${path}.evidenceOnly must be true`);
}

export function deriveSloCatalogSha256(catalog) {
  return sha256CanonicalJsonExcluding(catalog, 'catalogSha256');
}

export function deriveSloDefinitionSha256(definition) {
  return sha256CanonicalJson(definition);
}

export function validateSloCatalog(catalog) {
  assertClosedRecord(catalog, 'catalog', [
    'schemaVersion', 'catalogId', 'catalogRevision', 'catalogSha256', 'releaseSha', 'generatedAtMs',
    'truthLabel', 'authority', 'dataMode', 'evidenceOnly', 'effectPolicy', 'slos', 'historicalMetricRegistry',
  ]);
  assertEnum(catalog.schemaVersion, ['slo-catalog.v1'], 'catalog.schemaVersion');
  assertIdentifier(catalog.catalogId, 'catalog.catalogId');
  assertSafeInteger(catalog.catalogRevision, 'catalog.catalogRevision', 1, 1_000_000);
  assertSha256(catalog.catalogSha256, 'catalog.catalogSha256');
  assertGitSha(catalog.releaseSha, 'catalog.releaseSha');
  assertSafeInteger(catalog.generatedAtMs, 'catalog.generatedAtMs');
  assertEnum(catalog.truthLabel, ['SYNTHETIC_ONLY'], 'catalog.truthLabel');
  assertEnum(catalog.authority, ['SYNTHETIC_TEST'], 'catalog.authority');
  assertEnum(catalog.dataMode, ['SYNTHETIC'], 'catalog.dataMode');
  assertBoolean(catalog.evidenceOnly, 'catalog.evidenceOnly');
  if (!catalog.evidenceOnly) throw new TypeError('catalog.evidenceOnly must be true');
  validateEffectPolicy(catalog.effectPolicy, 'catalog.effectPolicy');
  assertArray(catalog.slos, 'catalog.slos', SLO_SUBOBJECTIVE_CONTRACTS.length);
  if (catalog.slos.length !== SLO_SUBOBJECTIVE_CONTRACTS.length) {
    throw new TypeError('catalog.slos must contain exactly 25 subobjectives');
  }
  catalog.slos.forEach(validateCatalogSlo);
  assertUnique(catalog.slos, catalogSloKey, 'catalog.slos');
  assertUnique(catalog.slos, (entry) => entry.syntheticWindow.windowId, 'catalog.slos synthetic windows');
  assertUnique(catalog.slos, (entry) => JSON.stringify(entry.measurementSource), 'catalog.slos measurement sources');
  const categories = new Set(catalog.slos.map((entry) => entry.category));
  const missingCategories = SLO_CATEGORIES.filter((category) => !categories.has(category));
  const expectedSloById = new Map(SLO_SUBOBJECTIVE_CONTRACTS.map((entry) => [entry.sloId, entry]));
  const observedSloById = new Map(catalog.slos.map((entry) => [entry.sloId, entry]));
  const missingSubobjectiveIds = SLO_SUBOBJECTIVE_IDS.filter((sloId) => !observedSloById.has(sloId));
  const unexpectedSubobjectiveIds = catalog.slos
    .map((entry) => entry.sloId)
    .filter((sloId) => !expectedSloById.has(sloId));
  const sloContractMismatches = [];
  for (const expected of SLO_SUBOBJECTIVE_CONTRACTS) {
    const observed = observedSloById.get(expected.sloId);
    if (observed === undefined) continue;
    const expectedBindings = expected.measurementSource.kind === 'HISTORICAL_METRIC_STATISTIC'
      ? [{ metricId: expected.measurementSource.metricId, family: expected.measurementSource.family }]
      : [];
    if (observed.version !== expected.version || observed.category !== expected.category
        || observed.ownerId !== expected.ownerId
        || JSON.stringify(observed.measurementSource) !== JSON.stringify(expected.measurementSource)
        || JSON.stringify(observed.historicalMetricBindings) !== JSON.stringify(expectedBindings)) {
      sloContractMismatches.push(expected.sloId);
    }
  }
  sloContractMismatches.push(...missingSubobjectiveIds, ...unexpectedSubobjectiveIds);

  assertArray(catalog.historicalMetricRegistry, 'catalog.historicalMetricRegistry', HISTORICAL_METRIC_FAMILIES.length);
  if (catalog.historicalMetricRegistry.length !== HISTORICAL_METRIC_FAMILIES.length) {
    throw new TypeError('catalog.historicalMetricRegistry must contain exactly 23 entries');
  }
  catalog.historicalMetricRegistry.forEach(validateMetric);
  assertUnique(catalog.historicalMetricRegistry, (entry) => entry.metricId, 'catalog.historicalMetricRegistry ids');
  assertUnique(catalog.historicalMetricRegistry, (entry) => entry.family, 'catalog.historicalMetricRegistry families');
  const metricFamilies = new Set(catalog.historicalMetricRegistry.map((entry) => entry.family));
  const missingMetricFamilies = HISTORICAL_METRIC_FAMILIES.filter((family) => !metricFamilies.has(family));
  const expectedMetricByFamily = new Map(HISTORICAL_METRIC_CONTRACTS.map((entry) => [entry.family, entry]));
  const metricContractMismatches = [];
  for (const metric of catalog.historicalMetricRegistry) {
    const expected = expectedMetricByFamily.get(metric.family);
    if (expected === undefined || metric.metricId !== expected.metricId || metric.ownerId !== expected.ownerId
        || metric.unit !== expected.unit || JSON.stringify(metric.statistics) !== JSON.stringify(expected.statistics)
        || metric.maximumSeriesPoints !== expected.maximumSeriesPoints
        || metric.retentionWindowMs !== expected.retentionWindowMs) {
      metricContractMismatches.push(metric.family);
    }
  }
  const metricById = new Map(catalog.historicalMetricRegistry.map((entry) => [entry.metricId, entry]));
  const metricBindingMismatches = [];
  for (const slo of catalog.slos) {
    for (const binding of slo.historicalMetricBindings) {
      const metric = metricById.get(binding.metricId);
      if (metric === undefined || metric.family !== binding.family) {
        metricBindingMismatches.push(`${catalogSloKey(slo)}|${binding.metricId}|${binding.family}`);
      }
    }
  }
  return {
    derivedCatalogSha256: deriveSloCatalogSha256(catalog),
    missingCategories,
    missingSubobjectiveIds: sortedUniqueStrings(missingSubobjectiveIds),
    unexpectedSubobjectiveIds: sortedUniqueStrings(unexpectedSubobjectiveIds),
    sloContractMismatches: sortedUniqueStrings(sloContractMismatches),
    missingMetricFamilies,
    metricContractMismatches: sortedUniqueStrings(metricContractMismatches),
    metricBindingMismatches: sortedUniqueStrings(metricBindingMismatches),
  };
}
