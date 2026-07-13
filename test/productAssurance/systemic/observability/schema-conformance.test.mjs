import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertJsonSchemaValid,
  assertSchemaSubsetSupported,
  validateJsonSchema,
} from '../cockpit/support/json-schema-2020-12-subset.mjs';

function json(relativePath) {
  return JSON.parse(readFileSync(new URL(
    `../../../../fixtures/productAssurance/systemic/observability/${relativePath}`,
    import.meta.url,
  ), 'utf8'));
}

const cases = [
  {
    label: 'release-manifest-healthy.json',
    schema: json('release-bound-expected-manifest.schema.json'),
    instance: json('cases/release-manifest-healthy.json'),
  },
  {
    label: 'conservation-replay-balanced.json',
    schema: json('conservation-accounting.schema.json'),
    instance: json('cases/conservation-replay-balanced.json'),
  },
  {
    label: 'slo-catalog-complete.json',
    schema: json('slo-catalog.schema.json'),
    instance: json('cases/slo-catalog-complete.json'),
  },
  {
    label: 'slo-trend-history.json',
    schema: json('slo-trend.schema.json'),
    instance: json('cases/slo-trend-history.json'),
  },
  {
    label: 'reason-code-registry.v1.json',
    schema: json('reason-code-registry.schema.json'),
    instance: json('cases/reason-code-registry.v1.json'),
  },
  {
    label: 'historical-series-complete.json',
    schema: json('historical-series.schema.json'),
    instance: json('cases/historical-series-complete.json'),
  },
];

test('the packet validator recognizes every keyword used by observability schemas', () => {
  for (const entry of cases) {
    assert.equal(assertSchemaSubsetSupported(entry.schema), true, entry.schema.$id);
  }
});

test('every observability case conforms to its declared input schema', () => {
  for (const entry of cases) {
    assert.equal(assertJsonSchemaValid(entry.schema, entry.instance, entry.label), true);
  }
});

test('observability schemas reject hostile missing and out-of-range evidence', () => {
  const releaseCase = cases.find((entry) => entry.label === 'release-manifest-healthy.json');
  const missingRelease = structuredClone(releaseCase.instance);
  delete missingRelease.manifest.binding.acceptedReleaseSha;
  const missingResult = validateJsonSchema(releaseCase.schema, missingRelease);
  assert.equal(missingResult.valid, false);
  assert.ok(missingResult.errors.some((error) => (
    error.keyword === 'required'
      && error.instancePath === '#/manifest/binding'
      && error.message.includes('acceptedReleaseSha')
  )));

  const sloCase = cases.find((entry) => entry.label === 'slo-trend-history.json');
  const zeroObjective = structuredClone(sloCase.instance);
  zeroObjective.definitions[0].objectivePercent = 0;
  const zeroResult = validateJsonSchema(sloCase.schema, zeroObjective);
  assert.equal(zeroResult.valid, false);
  assert.ok(zeroResult.errors.some((error) => error.keyword === 'exclusiveMinimum'));

  const historicalCase = cases.find((entry) => entry.label === 'historical-series-complete.json');
  const unboundedHistorical = structuredClone(historicalCase.instance);
  unboundedHistorical.series[0].maximumSeriesPoints = 1025;
  const historicalResult = validateJsonSchema(historicalCase.schema, unboundedHistorical);
  assert.equal(historicalResult.valid, false);
  assert.ok(historicalResult.errors.some((error) => (
    error.keyword === 'maximum'
      && error.instancePath === '#/series/0/maximumSeriesPoints'
  )));
});
