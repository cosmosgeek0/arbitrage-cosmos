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

export const HISTORICAL_METRIC_FAMILIES = Object.freeze([
  'SOURCE_AGE_PERCENTILES', 'PROCESSING_AGE_PERCENTILES', 'CROSS_SOURCE_SKEW',
  'QUEUE_DEPTH_BACKPRESSURE', 'DROPPED_COALESCED_EVENTS', 'RECONCILIATION_GAP',
  'AMBIGUITY_DURATION', 'AUTOMATIC_RECOVERY_RESULT_RATE', 'EXECUTION_COST', 'SLIPPAGE',
  'FUNDING', 'BORROW_INTEREST', 'MARKET_IMPACT', 'INCIDENT_FREQUENCY',
  'RECURRING_FAILED_INVARIANTS', 'CPU_BUDGET', 'MEMORY_BUDGET', 'DISK_BUDGET',
  'WAL_BUDGET', 'API_RATE_BUDGET', 'TELEMETRY_BUDGET', 'TOKEN_BUDGET', 'COST_BUDGET',
]);

const STATISTICS = ['P50', 'P95', 'P99', 'COUNT', 'RATE', 'SUM', 'UTILIZATION', 'BURN_RATE'];

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

function validateCatalogSlo(value, index) {
  const path = `catalog.slos[${index}]`;
  assertClosedRecord(value, path, [
    'sloId', 'version', 'category', 'ownerId', 'definitionSchemaVersion',
    'definitionSha256', 'historicalMetricBindings', 'syntheticWindow', 'truthLabel', 'authority', 'evidenceOnly',
  ]);
  assertIdentifier(value.sloId, `${path}.sloId`);
  assertSafeInteger(value.version, `${path}.version`, 1, 1_000_000);
  assertEnum(value.category, SLO_CATEGORIES, `${path}.category`);
  assertIdentifier(value.ownerId, `${path}.ownerId`);
  assertEnum(value.definitionSchemaVersion, ['slo-trend.v1'], `${path}.definitionSchemaVersion`);
  assertSha256(value.definitionSha256, `${path}.definitionSha256`);
  assertArray(value.historicalMetricBindings, `${path}.historicalMetricBindings`, 23);
  if (value.historicalMetricBindings.length === 0) {
    throw new TypeError(`${path}.historicalMetricBindings must not be empty`);
  }
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
  assertArray(value.statistics, `${path}.statistics`, 8);
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
  assertArray(catalog.slos, 'catalog.slos', SLO_CATEGORIES.length);
  if (catalog.slos.length !== SLO_CATEGORIES.length) throw new TypeError('catalog.slos must contain exactly 11 entries');
  catalog.slos.forEach(validateCatalogSlo);
  assertUnique(catalog.slos, catalogSloKey, 'catalog.slos');
  assertUnique(catalog.slos, (entry) => entry.category, 'catalog.slos categories');
  assertUnique(catalog.slos, (entry) => entry.syntheticWindow.windowId, 'catalog.slos synthetic windows');
  const categories = new Set(catalog.slos.map((entry) => entry.category));
  const missingCategories = SLO_CATEGORIES.filter((category) => !categories.has(category));

  assertArray(catalog.historicalMetricRegistry, 'catalog.historicalMetricRegistry', HISTORICAL_METRIC_FAMILIES.length);
  if (catalog.historicalMetricRegistry.length !== HISTORICAL_METRIC_FAMILIES.length) {
    throw new TypeError('catalog.historicalMetricRegistry must contain exactly 23 entries');
  }
  catalog.historicalMetricRegistry.forEach(validateMetric);
  assertUnique(catalog.historicalMetricRegistry, (entry) => entry.metricId, 'catalog.historicalMetricRegistry ids');
  assertUnique(catalog.historicalMetricRegistry, (entry) => entry.family, 'catalog.historicalMetricRegistry families');
  const metricFamilies = new Set(catalog.historicalMetricRegistry.map((entry) => entry.family));
  const missingMetricFamilies = HISTORICAL_METRIC_FAMILIES.filter((family) => !metricFamilies.has(family));
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
    missingMetricFamilies,
    metricBindingMismatches: sortedUniqueStrings(metricBindingMismatches),
  };
}
