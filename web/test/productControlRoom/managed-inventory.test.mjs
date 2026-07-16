import assert from 'node:assert/strict';
import test from 'node:test';

import { I00_MANAGED_COMPONENT_IDENTITIES as SERVER_MANAGED_IDENTITIES } from '../../../server/src/productIntegration/runtime/types.ts';
import { SYSTEM_COMPONENT_IDS } from '../../../server/src/systemIntegration/contracts/constants.ts';
import { buildProductControlRoomFixture } from '../../src/features/productControlRoom/fixtureBinding.ts';
import {
  I00_MANAGED_COMPONENT_IDENTITIES as BROWSER_MANAGED_IDENTITIES,
  PRODUCT_MANAGED_INVENTORY_SCHEMA,
  buildFixtureManagedInventory,
  createFixtureSession,
  validateProductSupervisorEnvelope,
} from '../../src/lib/productIntegration/model.ts';
import {
  ProductBindingError,
  createProductIntegrationClient,
} from '../../src/lib/productIntegration/client.ts';

const NOW_MS = 1_800_000_000_000;

function healthyFixture() {
  return buildProductControlRoomFixture(
    createFixtureSession('HEALTHY_OBSERVE', 'managed-inventory-regression', NOW_MS),
  );
}

function cloneFixture() {
  return structuredClone(healthyFixture());
}

function assertHasCode(value, expectedCode) {
  assert.ok(
    validateProductSupervisorEnvelope(value).includes(expectedCode),
    `expected ${expectedCode}`,
  );
}

test('browser fixture carries the exact server-owned 33-role inventory over all 14 canonical components', () => {
  const snapshot = healthyFixture();
  const inventory = snapshot.managedInventory;

  assert.equal(inventory.schemaVersion, PRODUCT_MANAGED_INVENTORY_SCHEMA);
  assert.deepEqual(BROWSER_MANAGED_IDENTITIES, SERVER_MANAGED_IDENTITIES);
  assert.equal(new Set(BROWSER_MANAGED_IDENTITIES).size, 33);
  assert.deepEqual(inventory.entries.map((entry) => entry.identity), SERVER_MANAGED_IDENTITIES);
  assert.deepEqual({
    expected: inventory.expectedIdentityCount,
    mapped: inventory.mappedIdentityCount,
    evidencePresent: inventory.evidencePresentCount,
    ownerGated: inventory.ownerGatedCount,
    notConfigured: inventory.notConfiguredCount,
    missing: inventory.missingCount,
    canonical: inventory.canonicalComponentCount,
    referenced: inventory.referencedCanonicalComponentCount,
    observed: inventory.observedCanonicalComponentCount,
  }, {
    expected: 33,
    mapped: 14,
    evidencePresent: 14,
    ownerGated: 13,
    notConfigured: 3,
    missing: 3,
    canonical: 14,
    referenced: 14,
    observed: 14,
  });

  const referenced = new Set(inventory.entries.flatMap((entry) => entry.canonicalComponentIds));
  assert.deepEqual([...referenced].sort(), [...SYSTEM_COMPONENT_IDS].sort());
  for (const entry of inventory.entries) {
    for (const evidence of entry.evidence ?? []) {
      assert.equal(evidence.source, 'PRODUCT_RUNTIME_COMPONENT_PROJECTION');
      assert.equal(snapshot.components[evidence.componentProjectionIndex].componentId, evidence.componentId);
    }
  }
  assert.deepEqual(validateProductSupervisorEnvelope(snapshot), []);
});

test('browser decoder and client reject a server envelope that omits managed inventory', async () => {
  const withoutInventory = cloneFixture();
  delete withoutInventory.managedInventory;
  assertHasCode(withoutInventory, 'MANAGED_INVENTORY_MISSING');

  const client = createProductIntegrationClient({
    readSupervisor: async () => withoutInventory,
  });
  await assert.rejects(
    client.readSupervisor(),
    (error) => error instanceof ProductBindingError
      && error.codes.includes('MANAGED_INVENTORY_MISSING'),
  );
});

test('browser decoder rejects forged inventory schema, identity order, owner, mapping, and counts', () => {
  const schema = cloneFixture();
  schema.managedInventory.schemaVersion = 'i00-managed-inventory.v0';
  assertHasCode(schema, 'MANAGED_INVENTORY_SCHEMA_UNSUPPORTED');

  const order = cloneFixture();
  [order.managedInventory.entries[0], order.managedInventory.entries[1]] = [
    order.managedInventory.entries[1],
    order.managedInventory.entries[0],
  ];
  assertHasCode(order, 'MANAGED_INVENTORY_IDENTITY_ORDER_INVALID');

  const owner = cloneFixture();
  owner.managedInventory.entries[2].owner = 'FORGED_OWNER';
  assertHasCode(owner, 'MANAGED_INVENTORY_OWNER_MISMATCH');

  const mapping = cloneFixture();
  mapping.managedInventory.entries[2].canonicalComponentIds = ['q-inference'];
  assertHasCode(mapping, 'MANAGED_INVENTORY_COMPONENT_MAPPING_INVALID');

  const count = cloneFixture();
  count.managedInventory.evidencePresentCount -= 1;
  assertHasCode(count, 'MANAGED_INVENTORY_COUNT_MISMATCH:evidencePresentCount');
  assertHasCode(count, 'MANAGED_INVENTORY_DENOMINATOR_INVALID');
});

test('browser decoder rejects forged evidence references and contradictory dispositions', () => {
  const source = cloneFixture();
  source.managedInventory.entries[2].evidence[0].source = 'FORGED_SOURCE';
  assertHasCode(source, 'MANAGED_INVENTORY_EVIDENCE_SOURCE_INVALID');

  const component = cloneFixture();
  component.managedInventory.entries[2].evidence[0].componentId = 'q-inference';
  assertHasCode(component, 'MANAGED_INVENTORY_EVIDENCE_COMPONENT_INVALID');

  const index = cloneFixture();
  index.managedInventory.entries[2].evidence[0].componentProjectionIndex = 13;
  assertHasCode(index, 'MANAGED_INVENTORY_EVIDENCE_INDEX_INVALID');

  const mappedDisposition = cloneFixture();
  mappedDisposition.managedInventory.entries[2].inventoryState = 'MISSING';
  mappedDisposition.managedInventory.entries[2].evidence = null;
  mappedDisposition.managedInventory.entries[2].reasonCode = 'CANONICAL_COMPONENT_EVIDENCE_MISSING';
  assertHasCode(mappedDisposition, 'MANAGED_INVENTORY_DISPOSITION_INVALID');

  const unavailableDisposition = cloneFixture();
  unavailableDisposition.managedInventory.entries[0].evidence = [{
    source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION',
    componentId: 'ledger-persistence',
    componentProjectionIndex: 0,
  }];
  assertHasCode(unavailableDisposition, 'MANAGED_INVENTORY_DISPOSITION_INVALID');
});

test('fixture inventory evidence indexes bind to the final projected component array', () => {
  const snapshot = cloneFixture();
  snapshot.components.reverse();
  snapshot.managedInventory = structuredClone(buildFixtureManagedInventory(snapshot.components));

  for (const entry of snapshot.managedInventory.entries) {
    for (const evidence of entry.evidence ?? []) {
      assert.equal(snapshot.components[evidence.componentProjectionIndex].componentId, evidence.componentId);
    }
  }
  assert.deepEqual(validateProductSupervisorEnvelope(snapshot), []);
});

test('managed inventory prevents a ready envelope from hiding a missing or unknown canonical component', () => {
  const missing = cloneFixture();
  missing.components = missing.components.filter((component) => component.componentId !== 'q-inference');
  missing.dashboard.components = missing.dashboard.components.filter((component) => component.componentId !== 'q-inference');
  missing.managedInventory = structuredClone(buildFixtureManagedInventory(missing.components));
  assertHasCode(missing, 'MANAGED_INVENTORY_GREEN_WITH_MISSING_COMPONENT');

  const unknown = cloneFixture();
  unknown.components.push({
    ...structuredClone(unknown.components[0]),
    componentId: 'forged-component',
  });
  assertHasCode(unknown, 'MANAGED_INVENTORY_COMPONENT_UNKNOWN');
});
