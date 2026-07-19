import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { scanProductionConsumers } from '../../../test/i00/baseline-route-consumers.mjs';
import {
  generateBaselineRouteMigration,
  renderBaselineRouteMigration,
} from '../../../test/i00/generate-baseline-route-migration.mjs';
import { verifySealedOwnerClaim } from '../../../test/i00/sealed-owner-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ARTIFACT_PATH = 'fixtures/i00/baseline-route-migration.json';
const DIRECTIVE_PATH = 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md';
const TOP_LEVEL_KEYS = Object.freeze([
  'authority',
  'classificationVocabulary',
  'consumerScan',
  'migrationResponseVocabulary',
  'routes',
  'schemaVersion',
].sort());
const ROUTE_KEYS = Object.freeze([
  'canonicalOwner',
  'classification',
  'consumerRequirement',
  'methods',
  'migrationResponse',
  'productionConsumers',
  'reasonCode',
  'registrations',
  'replacement',
  'route',
  'sourceFacts',
].sort());
const CLASSIFICATIONS = Object.freeze([
  'KEEP_CANONICAL',
  'ADAPT_TO_NEW_AUTHORITY',
  'COMPATIBILITY_ALIAS',
  'RESTRICT',
  'RETIRE',
]);
const MIGRATION_RESPONSES = Object.freeze([
  'ALREADY_FIXED',
  'ADAPTED_IN_I00',
  'RETIRED',
  'INTENTIONALLY_BLOCKED',
]);
function loadArtifact() {
  return JSON.parse(readFileSync(resolve(ROOT, ARTIFACT_PATH), 'utf8'));
}

function directiveRoutes() {
  const claim = verifySealedOwnerClaim(ROOT, DIRECTIVE_PATH, 'I00_BASELINE_ROUTES');
  assert.equal(claim.ownerSha256, '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5');
  assert.equal(claim.claimSha256, '6094f2eb554d601e0938344adcb20c60e4df83bd6c881ed7108972b5d1db3823');
  return [...claim.value];
}

function countNeedle(path, needle) {
  const source = readFileSync(resolve(ROOT, path), 'utf8');
  return source.split(needle).length - 1;
}

function routeBlock(method, route) {
  const source = readFileSync(resolve(ROOT, 'server/src/index.ts'), 'utf8');
  const declaration = `app.${method.toLowerCase()}('${route}'`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${method} ${route} declaration is absent`);
  const next = source.indexOf('\napp.', start + declaration.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function exactMethods(registrations) {
  return [...new Set(registrations.map((row) => row.method))].sort();
}

function validateArtifact(artifact) {
  assert.deepEqual(Object.keys(artifact).sort(), TOP_LEVEL_KEYS);
  assert.equal(artifact.schemaVersion, 'i00.baseline-route-migration.v1');
  assert.deepEqual(artifact.classificationVocabulary, CLASSIFICATIONS);
  assert.deepEqual(artifact.migrationResponseVocabulary, MIGRATION_RESPONSES);
  assert.equal(artifact.authority.directivePath, DIRECTIVE_PATH);
  assert.equal(artifact.authority.directiveSection, '2A. July-11 baseline-specific migration checklist');
  assert.equal(artifact.authority.registrationOwnerPath, 'server/src/index.ts');
  assert.deepEqual(Object.keys(artifact.consumerScan).sort(), ['extensions', 'mode', 'registrationExclusion', 'roots']);
  assert.equal(artifact.consumerScan.mode, 'CONSERVATIVE_STATIC_ROUTE_LITERAL_REFERENCES');
  assert.deepEqual(artifact.consumerScan.roots, ['server/src', 'web/src']);
  assert.deepEqual(artifact.consumerScan.extensions, ['.cjs', '.js', '.mjs', '.ts', '.tsx']);
  assert.equal(artifact.consumerScan.registrationExclusion, 'EXPRESS_DECLARATION_LINE_ONLY');

  const expectedRoutes = directiveRoutes();
  assert.deepEqual(artifact.routes.map((row) => row.route), expectedRoutes);
  assert.equal(new Set(artifact.routes.map((row) => row.route)).size, expectedRoutes.length);

  for (const route of artifact.routes) {
    assert.deepEqual(Object.keys(route).sort(), ROUTE_KEYS, route.route);
    assert(CLASSIFICATIONS.includes(route.classification), route.route);
    assert(MIGRATION_RESPONSES.includes(route.migrationResponse), route.route);
    assert.match(route.canonicalOwner, /^[A-Z][A-Z0-9_]*$/, route.route);
    assert.match(route.reasonCode, /^[A-Z][A-Z0-9_]*$/, route.route);
    assert(route.registrations.length > 0, route.route);
    assert(route.sourceFacts.length > 0, route.route);
    assert.deepEqual([...route.methods].sort(), exactMethods(route.registrations), route.route);
    assert.deepEqual(
      [...route.productionConsumers].sort((left, right) => left.path.localeCompare(right.path)),
      route.productionConsumers,
      `${route.route} consumer rows must be sorted`,
    );

    for (const evidence of [...route.registrations, ...route.sourceFacts]) {
      assert.deepEqual(
        Object.keys(evidence).sort(),
        evidence.method === undefined
          ? ['expectedOccurrences', 'needle', 'path']
          : ['expectedOccurrences', 'method', 'needle', 'path'],
        `${route.route}: ${evidence.needle}`,
      );
      assert.equal(countNeedle(evidence.path, evidence.needle), evidence.expectedOccurrences, `${route.route}: ${evidence.needle}`);
    }

    const discoveredConsumers = scanProductionConsumers(ROOT, artifact.consumerScan, route.route);
    assert.deepEqual(discoveredConsumers, route.productionConsumers, `${route.route} consumer inventory drifted`);

    if (route.classification === 'KEEP_CANONICAL') assert.equal(route.replacement, null, route.route);
    if (route.classification === 'ADAPT_TO_NEW_AUTHORITY') assert.match(route.replacement, /^\/api\//, route.route);
    if (route.classification === 'COMPATIBILITY_ALIAS') assert.match(route.replacement, /^\/api\//, route.route);
    if (route.classification === 'RETIRE') {
      assert.equal(route.migrationResponse, 'RETIRED', route.route);
      assert.equal(route.consumerRequirement, 'ZERO_PRODUCTION_CONSUMERS', route.route);
      assert.deepEqual(route.productionConsumers, [], route.route);
      const directTombstone = routeBlock(route.registrations[0].method, route.route);
      assert(
        route.sourceFacts.some((fact) => fact.needle.includes('LiveExecutionNotImplemented'))
          || (/status\(410\)/.test(directTombstone) && /code: 'RETIRED'/.test(directTombstone)),
        `${route.route} is not a tombstone`,
      );
    } else if (route.consumerRequirement === 'ZERO_PRODUCTION_CONSUMERS') {
      assert.deepEqual(route.productionConsumers, [], route.route);
    } else {
      assert.equal(route.consumerRequirement, 'PINNED_PRODUCTION_CONSUMERS', route.route);
    }
  }
}

test('§2A classifies the exact baseline route set and pins live registrations and consumers', () => {
  validateArtifact(loadArtifact());
});

test('§2A route inventory rejects missing routes, aliases without replacements and retired-route consumers', () => {
  const artifact = loadArtifact();

  const missing = structuredClone(artifact);
  missing.routes.pop();
  assert.throws(() => validateArtifact(missing));

  const alias = structuredClone(artifact);
  alias.routes[0].classification = 'COMPATIBILITY_ALIAS';
  alias.routes[0].replacement = null;
  assert.throws(() => validateArtifact(alias));

  const retired = structuredClone(artifact);
  const live = retired.routes.find((row) => row.route === '/api/live');
  live.productionConsumers = [{ path: 'web/src/store.tsx', occurrences: 1 }];
  assert.throws(() => validateArtifact(retired));

  const registration = structuredClone(artifact);
  registration.routes[0].registrations[0].needle = "app.get('/api/not-state'";
  assert.throws(() => validateArtifact(registration));
});

test('§2A consumer inventory generator is deterministic and repairs only derived route consumers', () => {
  const artifact = loadArtifact();
  const generated = generateBaselineRouteMigration(artifact, ROOT);
  const repeated = generateBaselineRouteMigration(generated, ROOT);
  assert.equal(renderBaselineRouteMigration(generated), renderBaselineRouteMigration(repeated));
  assert.equal(
    readFileSync(resolve(ROOT, ARTIFACT_PATH), 'utf8'),
    renderBaselineRouteMigration(generated),
    'committed route inventory must be canonical generator output',
  );
  assert.deepEqual(
    generated.routes.find((row) => row.route === '/api/markets').productionConsumers,
    [
      { path: 'server/src/engine/marketApiProjection.ts', occurrences: 1 },
      { path: 'web/src/store.tsx', occurrences: 2 },
    ],
  );

  const drifted = structuredClone(generated);
  drifted.routes.find((row) => row.route === '/api/markets').productionConsumers = [];
  assert.equal(
    renderBaselineRouteMigration(generateBaselineRouteMigration(drifted, ROOT)),
    renderBaselineRouteMigration(generated),
  );

  const withoutDerived = (document) => ({
    ...document,
    routes: document.routes.map(({ productionConsumers: _ignored, ...row }) => row),
  });
  assert.deepEqual(withoutDerived(generated), withoutDerived(artifact));
});

test('§2A consumer inventory generator rejects scan, route, and duplicate identity drift', () => {
  const artifact = loadArtifact();
  const wrongRoot = structuredClone(artifact);
  wrongRoot.consumerScan.roots = ['server/src'];
  assert.throws(
    () => generateBaselineRouteMigration(wrongRoot, ROOT),
    /BASELINE_ROUTE_CONSUMER_SCAN_INVALID/,
  );

  const wrongRoute = structuredClone(artifact);
  wrongRoute.routes[0].route = '/not-api/state';
  assert.throws(
    () => generateBaselineRouteMigration(wrongRoute, ROOT),
    /BASELINE_ROUTE_MIGRATION_GENERATOR_ROUTE_INVALID/,
  );

  const duplicate = structuredClone(artifact);
  duplicate.routes[1].route = duplicate.routes[0].route;
  assert.throws(
    () => generateBaselineRouteMigration(duplicate, ROOT),
    /BASELINE_ROUTE_MIGRATION_GENERATOR_ROUTE_INVALID/,
  );
});

test('§2A legacy authority migrations are structurally fail-closed', () => {
  const state = routeBlock('GET', '/api/state');
  assert.match(state, /const stateSupervisor = await systemIntegration\.supervisor\(\)/);
  assert.match(state, /res\.json\(buildState\(stateSupervisor\)\)/);
  assert.match(state, /CANONICAL_SUPERVISOR_UNAVAILABLE/);

  const system = routeBlock('GET', '/api/system');
  assert.match(system, /systemSupervisor = await systemIntegration\.supervisor\(\)/);
  assert.match(system, /okSemantics: 'TRANSPORT_ONLY'/);
  assert.match(system, /readinessSemantics: 'NOT_EVALUATED'/);
  assert.match(system, /canonicalSupervisor: systemSupervisor/);

  const config = routeBlock('POST', '/api/config');
  assert.match(config, /field !== 'profile' && field !== 'watchlist'/);
  assert.match(config, /status\(409\)/);
  assert.match(config, /code: 'CONTROL_PREVIEW_REQUIRED'/);
  assert.match(config, /canonicalPreviewEndpoint: '\/api\/product-integration\/v1\/commands\/preview'/);
  assert.match(config, /ledger\.logEvent\('display_config_change'/);
  assert.doesNotMatch(config, /financialArmingFields|Financial controls cannot be armed/);

  const preview = routeBlock('POST', '/api/trade/preview');
  assert.match(preview, /status\(503\)/);
  assert.match(preview, /code: 'NOT_CONFIGURED'/);
  assert.match(preview, /CANONICAL_CAPITAL_POLICY/);
  assert.match(preview, /CANONICAL_RISK_POLICY/);
  assert.match(preview, /CANONICAL_EXECUTION_TICKET/);
  assert.doesNotMatch(preview, /orders\.preview|parseIntent|risk\.evaluate|ledger\./);

  const kill = routeBlock('POST', '/api/kill');
  assert.match(kill, /status\(410\)/);
  assert.match(kill, /code: 'RETIRED'/);
  assert.match(kill, /KILL_SWITCH_ENGAGE_ONLY/);
  assert.match(kill, /\/api\/product-integration\/v1\/commands\/preview/);
  assert.doesNotMatch(kill, /saveConfig|Object\.assign|ledger\.|controls\.mutate|systemIntegration\.controls/);
});
