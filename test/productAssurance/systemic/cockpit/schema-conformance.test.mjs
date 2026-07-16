import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCockpitViewModel,
} from '../../../../fixtures/productAssurance/systemic/cockpit/reference/cockpit-view-model.mjs';
import {
  evaluateReleaseBoundPanel,
} from '../../../../fixtures/productAssurance/systemic/cockpit/reference/release-bound-panel-evaluator.mjs';
import {
  SchemaSubsetError,
  assertJsonSchemaValid,
  assertSchemaSubsetSupported,
  validateJsonSchema,
} from './support/json-schema-2020-12-subset.mjs';
import { allObservations, observationFor } from './support/cockpit-fixture-builder.mjs';

function json(relativePath) {
  return JSON.parse(readFileSync(new URL(
    `../../../../fixtures/productAssurance/systemic/cockpit/${relativePath}`,
    import.meta.url,
  ), 'utf8'));
}

const contractSchema = json('schemas/cockpit-contract-set.v1.schema.json');
const viewModelSchema = json('schemas/cockpit-view-model.v1.schema.json');
const insertionDraftSchema = json('schemas/insertion-request-draft.v1.schema.json');
const generatedRowsSchema = json('schemas/generated-row-drafts.v1.schema.json');
const projectionSchema = json('schemas/surface-projection-matrix.v1.schema.json');
const releaseBoundSchema = json('schemas/release-bound-panel-evaluation.v1.schema.json');

const contractSet = json('fixtures/panel-contracts.v1.json');
const projectionMatrix = json('fixtures/surface-projection-matrix.v1.json');
const observationFixture = json('fixtures/panel-observations.v1.json');
const releaseManifestFixture = json('../observability/cases/release-manifest-healthy.json');

function composedReleaseBoundSchema() {
  const schema = structuredClone(releaseBoundSchema);
  schema.$defs = {
    ...structuredClone(viewModelSchema.$defs),
    ...schema.$defs,
  };
  schema.properties.panel = { $ref: '#/$defs/panel' };
  return schema;
}

function buildFixtureViewModel() {
  return buildCockpitViewModel({
    schemaVersion: 1,
    viewModelId: 'S5_SCHEMA_CONFORMANCE_VIEW_MODEL_V1',
    evaluatedAtMs: observationFixture.evaluatedAtMs,
    fixtureProvenance: {
      truthLabel: observationFixture.fixtureTruthLabel,
      authority: observationFixture.fixtureAuthority,
      wiringState: observationFixture.wiringState,
      note: observationFixture.fixtureNote,
    },
    contractSet,
    projectionMatrix,
    observations: allObservations(contractSet),
  });
}

test('the packet validator recognizes every keyword used by the cockpit schemas', () => {
  for (const schema of [
    contractSchema,
    viewModelSchema,
    insertionDraftSchema,
    generatedRowsSchema,
    projectionSchema,
    composedReleaseBoundSchema(),
  ]) assert.equal(assertSchemaSubsetSupported(schema), true, schema.$id);
});

test('all cockpit JSON artifacts with declared schemas conform to those schemas', () => {
  const cases = [
    ['panel-contracts.v1.json', contractSchema, contractSet],
    ['surface-projection-matrix.v1.json', projectionSchema, projectionMatrix],
    [
      'INSERTION_REQUEST_ROWS_DRAFT.v1.json',
      insertionDraftSchema,
      json('drafts/INSERTION_REQUEST_ROWS_DRAFT.v1.json'),
    ],
    [
      'TELEMETRY_COVERAGE_ROWS_DRAFT.v1.json',
      generatedRowsSchema,
      json('drafts/TELEMETRY_COVERAGE_ROWS_DRAFT.v1.json'),
    ],
    [
      'RESOURCE_BACKPRESSURE_ROWS_DRAFT.v1.json',
      generatedRowsSchema,
      json('drafts/RESOURCE_BACKPRESSURE_ROWS_DRAFT.v1.json'),
    ],
  ];
  for (const [label, schema, instance] of cases) {
    assert.equal(assertJsonSchemaValid(schema, instance, label), true);
  }
});

test('the render-neutral cockpit view-model output conforms to its closed schema', () => {
  const viewModel = buildFixtureViewModel();
  assert.equal(assertJsonSchemaValid(viewModelSchema, viewModel, 'cockpit view model'), true);
});

test('release-bound panel composition conforms after resolving the local cockpit panel schema', () => {
  const panelContract = contractSet.contracts.find((entry) => (
    entry.contractId === 'PANEL_DASHBOARD_TRUTH_V1'
  ));
  const stateRuleSet = contractSet.stateRuleSets.find((entry) => (
    entry.ruleSetId === panelContract.stateRuleSetId
  ));
  const observation = observationFor(panelContract);
  observation.evidence.observedAtMs = releaseManifestFixture.nowMs - 30;
  observation.evidence.lastIndependentProofAtMs = releaseManifestFixture.nowMs - 150;
  const output = evaluateReleaseBoundPanel({
    contract: panelContract,
    observation,
    stateRuleSet,
    evaluatedAtMs: releaseManifestFixture.nowMs,
    releaseManifestInput: releaseManifestFixture,
  });
  assert.equal(assertJsonSchemaValid(
    composedReleaseBoundSchema(),
    output,
    'release-bound panel evaluation',
  ), true);
});

test('closed schemas reject a hostile undeclared field and schema drift is not ignored', () => {
  const hostile = structuredClone(contractSet);
  hostile.decorativeGreenOverride = true;
  const result = validateJsonSchema(contractSchema, hostile);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => (
    error.keyword === 'additionalProperties'
      && error.instancePath === '#/decorativeGreenOverride'
  )));

  assert.throws(
    () => assertSchemaSubsetSupported({ type: 'object', unevaluatedProperties: false }),
    (error) => error instanceof SchemaSubsetError
      && error.code === 'UNSUPPORTED_SCHEMA_KEYWORD',
  );
});

test('the validator enforces the complete packet keyword subset', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:ip-assurance:s5:test:validator-keywords',
    $defs: {
      token: {
        type: 'string',
        minLength: 2,
        maxLength: 4,
        pattern: '^[A-Z]+$',
      },
      boundedInteger: {
        type: 'integer',
        minimum: 0,
        maximum: 10,
        exclusiveMinimum: -1,
      },
    },
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'mode', 'optional', 'labels', 'measure', 'ratio', 'extensions'],
    properties: {
      kind: { oneOf: [{ const: 'A' }, { enum: ['A', 'B'] }] },
      mode: { enum: ['SAFE', 'BLOCKED'] },
      optional: { type: ['string', 'null'] },
      labels: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: { $ref: '#/$defs/token' },
      },
      measure: { $ref: '#/$defs/boundedInteger' },
      ratio: { type: 'number', minimum: 0, maximum: 1 },
      extensions: {
        type: 'object',
        additionalProperties: { $ref: '#/$defs/token' },
      },
    },
  };
  const valid = {
    kind: 'B',
    mode: 'SAFE',
    optional: null,
    labels: ['AA', 'BB'],
    measure: 0,
    ratio: 0.5,
    extensions: { owner: 'OPS' },
  };
  assert.equal(assertJsonSchemaValid(schema, valid, 'keyword fixture'), true);

  for (const [keyword, mutate] of [
    ['oneOf', (value) => { value.kind = 'A'; }],
    ['type', (value) => { value.optional = 1; }],
    ['type', (value) => { value.measure = 0.5; }],
    ['enum', (value) => { value.mode = 'LIVE'; }],
    ['required', (value) => { delete value.ratio; }],
    ['minItems', (value) => { value.labels = []; }],
    ['maxItems', (value) => { value.labels = ['AA', 'BB', 'CC']; }],
    ['uniqueItems', (value) => { value.labels = ['AA', 'AA']; }],
    ['minLength', (value) => { value.labels = ['A']; }],
    ['maxLength', (value) => { value.labels = ['AAAAA']; }],
    ['pattern', (value) => { value.extensions.owner = 'lower'; }],
    ['minimum', (value) => { value.measure = -1; }],
    ['maximum', (value) => { value.ratio = 2; }],
    ['additionalProperties', (value) => { value.extra = true; }],
  ]) {
    const hostile = structuredClone(valid);
    mutate(hostile);
    const result = validateJsonSchema(schema, hostile);
    assert.equal(result.valid, false, keyword);
    assert.ok(result.errors.some((error) => error.keyword === keyword), keyword);
  }

  const exclusiveSchema = {
    type: 'number',
    exclusiveMinimum: 0,
  };
  assert.equal(validateJsonSchema(exclusiveSchema, 0).errors[0].keyword, 'exclusiveMinimum');
  assert.equal(validateJsonSchema({ const: 'LOCKED' }, 'OPEN').errors[0].keyword, 'const');
});
