import {
  canonicalize,
  cloneCanonical,
  contractError,
  deepFreeze,
} from './canonical.mjs';
import {
  validateExtensionDescriptor,
  validateModuleInventoryProjection,
} from './records.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

function normalizeInventory(inventory) {
  if (!Array.isArray(inventory)) fail('INVENTORY_INVALID', 'inventory must be an array');
  return inventory.map((record) => cloneCanonical(record));
}

export function registerExtension(inventory, descriptor) {
  validateExtensionDescriptor(descriptor);
  const current = normalizeInventory(inventory);
  if (current.some((record) => record.extensionId === descriptor.extensionId)) fail('DUPLICATE_EXTENSION_IDENTITY', 'extension identity is already registered');
  current.push({
    extensionId: descriptor.extensionId,
    extensionVersion: descriptor.extensionVersion,
    descriptorHash: descriptor.descriptorHash,
    status: 'INSTALLED_DISABLED',
    activeDependencyIds: [],
    authorityClass: 'NO_AUTHORITY',
  });
  return deepFreeze(current.sort((left, right) => left.extensionId < right.extensionId ? -1 : left.extensionId > right.extensionId ? 1 : 0));
}

export function disableExtension(inventory, extensionId) {
  const current = normalizeInventory(inventory);
  let found = false;
  const next = current.map((record) => {
    if (record.extensionId !== extensionId) return record;
    found = true;
    return { ...record, status: 'INSTALLED_DISABLED', activeDependencyIds: [] };
  });
  if (!found) fail('EXTENSION_NOT_FOUND', `extension ${extensionId} is not in fixture inventory`);
  return deepFreeze(next);
}

export function removalRequest(inventory, extensionId) {
  const current = normalizeInventory(inventory);
  const target = current.find((record) => record.extensionId === extensionId);
  if (!target) fail('EXTENSION_NOT_FOUND', `extension ${extensionId} is not in fixture inventory`);
  const dependents = current.filter((record) => record.activeDependencyIds.includes(extensionId));
  if (target.activeDependencyIds.length > 0 || dependents.length > 0) fail('ACTIVE_DEPENDENCY_REMAINS', 'extension removal is blocked by an active module-owned dependency');
  return deepFreeze({
    request: 'REMOVE_FIXTURE_EXTENSION',
    extensionId,
    canonicalMutationPerformed: false,
    authorityGranted: false,
    remaining: current.filter((record) => record.extensionId !== extensionId),
  });
}

export function rollbackRequest(descriptor, pinnedVersion) {
  validateExtensionDescriptor(descriptor);
  if (pinnedVersion !== descriptor.rollbackPlan.pinnedVersion) fail('ROLLBACK_VERSION_NOT_PINNED', 'rollback request must name the exact pinned version');
  return deepFreeze({
    request: 'ROLLBACK_EXTENSION',
    extensionId: descriptor.extensionId,
    pinnedVersion,
    canonicalOwnerRequired: true,
    mutationPerformed: false,
  });
}

export function uninstallRequest(descriptor) {
  validateExtensionDescriptor(descriptor);
  if (descriptor.uninstallPlan.deleteCanonicalEvidence !== false) fail('CANONICAL_EVIDENCE_DELETE_FORBIDDEN', 'uninstall cannot delete canonical evidence');
  return deepFreeze({
    request: 'UNINSTALL_EXTENSION',
    extensionId: descriptor.extensionId,
    deleteCanonicalEvidence: false,
    canonicalOwnerRequired: true,
    mutationPerformed: false,
  });
}

export function projectModuleInventory(inventory, generatedAt) {
  const current = normalizeInventory(inventory);
  const projection = {
    schema: 'ModuleInventoryProjectionV1',
    version: 1,
    readOnly: true,
    generatedAt,
    modules: current.map((record) => ({
      extensionId: record.extensionId,
      extensionVersion: record.extensionVersion,
      descriptorHash: record.descriptorHash,
      status: record.status,
      authorityClass: 'NO_AUTHORITY',
      controls: [],
    })),
  };
  validateModuleInventoryProjection(projection);
  return deepFreeze(projection);
}

export function inventoryEquivalent(left, right) {
  return canonicalize(left) === canonicalize(right);
}
