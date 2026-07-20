import {
  SYSTEM_COMPONENT_IDS,
  type SystemComponentId,
} from '../../systemIntegration/contracts/constants.js';
import {
  I00_MANAGED_COMPONENT_IDENTITIES,
  PRODUCT_RUNTIME_MANAGED_INVENTORY_SCHEMA,
  type I00ManagedComponentIdentity,
  type ProductRuntimeComponentProjection,
  type ProductRuntimeIncidentAvailability,
  type ProductRuntimeManagedInventoryProjection,
  type ProductRuntimeManagedInventoryState,
} from './types.js';

type UnmappedInventoryState = Exclude<ProductRuntimeManagedInventoryState, 'EVIDENCE_PRESENT'>;

interface ManagedInventoryDescriptor {
  readonly identity: I00ManagedComponentIdentity;
  readonly owner: string;
  readonly componentIds: readonly SystemComponentId[];
  readonly unavailableState: UnmappedInventoryState | null;
  readonly unavailableReason: string | null;
}

function mapped(
  identity: I00ManagedComponentIdentity,
  owner: string,
  ...componentIds: SystemComponentId[]
): Readonly<ManagedInventoryDescriptor> {
  return Object.freeze({
    identity,
    owner,
    componentIds: Object.freeze(componentIds),
    unavailableState: null,
    unavailableReason: null,
  });
}

function unavailable(
  identity: I00ManagedComponentIdentity,
  owner: string,
  unavailableState: UnmappedInventoryState,
  unavailableReason: string,
): Readonly<ManagedInventoryDescriptor> {
  return Object.freeze({
    identity,
    owner,
    componentIds: Object.freeze([]),
    unavailableState,
    unavailableReason,
  });
}

/**
 * Directional I00 role mapping. Repeated references do not create components:
 * the System Integration 14-ID graph remains the sole topology owner.
 */
const MANAGED_INVENTORY_DESCRIPTORS: readonly Readonly<ManagedInventoryDescriptor>[] = Object.freeze([
  unavailable('operator-auth', 'AUDITED_BACKEND_SECURITY', 'OWNER_GATED', 'REMOTE_OPERATOR_IDENTITY_OWNER_GATED'),
  unavailable('configuration-authority', 'SYSTEM_CONTROL_CONFIGURATION_OWNER', 'OWNER_GATED', 'CANONICAL_CONFIGURATION_VERSION_OWNER_REQUIRED'),
  mapped('ledger-persistence', 'EXISTING_LEDGER', 'ledger-persistence'),
  unavailable('database', 'EXISTING_LEDGER_DATABASE', 'OWNER_GATED', 'DATABASE_LIFECYCLE_EVIDENCE_NOT_BOUND'),
  unavailable('clock-sync', 'CANONICAL_CLOCK_SYNC_OWNER', 'OWNER_GATED', 'CLOCK_SYNCHRONIZATION_OWNER_NOT_BOUND'),
  mapped('spot-public-source', 'AUDITED_APP_PUBLIC_SOURCE', 'public-spot-source'),
  mapped('usdm-public-source', 'AUDITED_APP_PUBLIC_SOURCE', 'public-usdm-source'),
  unavailable('spot-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  unavailable('usdm-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  unavailable('margin-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  mapped('instrument-filter-registry', 'CANONICAL_MARKET_UNIVERSE', 'market-universe'),
  mapped('universe', 'CANONICAL_MARKET_UNIVERSE', 'market-universe'),
  mapped('evidence-attention-runtime', 'INTELLIGENCE_RUNTIME_AND_MARKET_INTELLIGENCE', 'intelligence-runtime', 'market-intelligence'),
  mapped('q-inference', 'Q_INFERENCE', 'q-inference'),
  mapped('basis-engine', 'BASIS_ENGINE', 'basis-engine'),
  mapped('volume-engine', 'VOLUME_ENGINE', 'volume-engine'),
  unavailable('opportunity-authority', 'FOUNDATION_CANONICAL_OPPORTUNITY', 'OWNER_GATED', 'OPPORTUNITY_AUTHORITY_COMPONENT_EVIDENCE_NOT_BOUND'),
  mapped('capital-supervision', 'CAPITAL_SUPERVISION', 'capital-supervision'),
  mapped('risk-gate', 'BACKEND_FOUNDATION_RISK', 'multileg-risk'),
  mapped('execution-hand', 'BACKEND_FOUNDATION_EXECUTION', 'execution-coordinator-validate-only'),
  unavailable('normal-basis-coordinator', 'LIVE_EDGE_NORMAL_BASIS_COORDINATOR', 'OWNER_GATED', 'NORMAL_BASIS_COORDINATOR_COMPONENT_EVIDENCE_NOT_BOUND'),
  unavailable('reverse-basis-coordinator', 'LIVE_EDGE_REVERSE_BASIS_COORDINATOR', 'OWNER_GATED', 'REVERSE_BASIS_COORDINATOR_COMPONENT_EVIDENCE_NOT_BOUND'),
  unavailable('volume-position-lifecycle', 'LIVE_EDGE_VOLUME_POSITION_LIFECYCLE', 'OWNER_GATED', 'VOLUME_POSITION_LIFECYCLE_COMPONENT_EVIDENCE_NOT_BOUND'),
  mapped('reconciliation', 'BACKEND_FOUNDATION_RECONCILIATION', 'reconciliation'),
  unavailable('exposure-position-recovery', 'LIVE_EDGE_EXPOSURE_RECOVERY', 'OWNER_GATED', 'PRIVATE_ACCOUNT_TRUTH_OWNER_GATED'),
  unavailable('outcome-feedback', 'Q_OUTCOME_FEEDBACK_OWNER', 'OWNER_GATED', 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED'),
  mapped('machine-supervisor', 'BACKEND_FOUNDATION_CONTROL_AND_SYSTEM_INTEGRATION', 'engine-supervisor'),
  unavailable('api-read-model', 'PRODUCT_INTEGRATION_READ_MODEL', 'NOT_CONFIGURED', 'API_READ_MODEL_NOT_LIFECYCLE_MANAGED'),
  unavailable('notification-incident-router', 'NOTIFICATION_INCIDENT_ROUTER', 'NOT_CONFIGURED', 'INCIDENT_OWNER_NOT_CONFIGURED'),
  unavailable('web-cockpit', 'PRODUCT_CONTROL_WEB', 'NOT_CONFIGURED', 'WEB_COCKPIT_NOT_LIFECYCLE_MANAGED'),
  unavailable('backup-restore', 'OPS_BACKUP_RESTORE', 'MISSING', 'BACKUP_RESTORE_MANAGED_COMPONENT_MISSING'),
  unavailable('external-watchdog', 'OPS_EXTERNAL_WATCHDOG', 'MISSING', 'EXTERNAL_WATCHDOG_MANAGED_COMPONENT_MISSING'),
  unavailable('cloudflare-tunnel-access', 'OPS_CLOUDFLARE_ACCESS', 'MISSING', 'CLOUDFLARE_TUNNEL_ACCESS_MANAGED_COMPONENT_MISSING'),
]);

function validateDescriptorInventory(): void {
  if (I00_MANAGED_COMPONENT_IDENTITIES.length !== 33
      || MANAGED_INVENTORY_DESCRIPTORS.length !== I00_MANAGED_COMPONENT_IDENTITIES.length
      || new Set(I00_MANAGED_COMPONENT_IDENTITIES).size !== I00_MANAGED_COMPONENT_IDENTITIES.length) {
    throw new TypeError('I00 managed identity inventory must contain 33 unique entries');
  }
  for (let index = 0; index < I00_MANAGED_COMPONENT_IDENTITIES.length; index += 1) {
    const descriptor = MANAGED_INVENTORY_DESCRIPTORS[index]!;
    if (descriptor.identity !== I00_MANAGED_COMPONENT_IDENTITIES[index]) {
      throw new TypeError('I00 managed identity mapping is missing, duplicated, or out of order');
    }
    if (descriptor.componentIds.length === 0
        ? descriptor.unavailableState === null || descriptor.unavailableReason === null
        : descriptor.unavailableState !== null || descriptor.unavailableReason !== null) {
      throw new TypeError(`${descriptor.identity} has contradictory managed-inventory disposition`);
    }
    if (descriptor.componentIds.some((componentId) => (
      !(SYSTEM_COMPONENT_IDS as readonly string[]).includes(componentId)
    ))) {
      throw new TypeError(`${descriptor.identity} references a non-canonical component`);
    }
  }
  const referenced = new Set(MANAGED_INVENTORY_DESCRIPTORS.flatMap((entry) => entry.componentIds));
  if (referenced.size !== SYSTEM_COMPONENT_IDS.length
      || SYSTEM_COMPONENT_IDS.some((componentId) => !referenced.has(componentId))) {
    throw new TypeError('I00 role mapping must reference every canonical component without widening the graph');
  }
}

export function buildProductRuntimeManagedInventory(
  components: readonly Readonly<ProductRuntimeComponentProjection>[],
  incidentAvailability: Readonly<ProductRuntimeIncidentAvailability> = Object.freeze({
    state: 'NOT_CONFIGURED', truthLabel: 'NOT_CONFIGURED', blocker: 'INCIDENT_OWNER_NOT_CONFIGURED',
  }),
): Readonly<ProductRuntimeManagedInventoryProjection> {
  validateDescriptorInventory();
  if (!Array.isArray(components) || components.length > 128) {
    throw new TypeError('managed inventory requires a bounded canonical component projection');
  }

  const evidenceById = new Map<string, Readonly<{
    component: Readonly<ProductRuntimeComponentProjection>;
    index: number;
  }>[]>();
  for (const [index, component] of components.entries()) {
    const existing = evidenceById.get(component.componentId) ?? [];
    existing.push(Object.freeze({ component, index }));
    evidenceById.set(component.componentId, existing);
  }

  const entries = Object.freeze(MANAGED_INVENTORY_DESCRIPTORS.map((descriptor) => {
    const canonicalComponentIds = Object.freeze([...descriptor.componentIds]);
    if (descriptor.identity === 'notification-incident-router'
      && incidentAvailability.state === 'AVAILABLE'
      && incidentAvailability.truthLabel === 'BUILT_AND_TESTED'
      && incidentAvailability.blocker === null) {
      return Object.freeze({
        identity: descriptor.identity,
        owner: 'PRODUCT_INTEGRATION_INCIDENT_ROUTER',
        canonicalComponentIds,
        inventoryState: 'EVIDENCE_PRESENT' as const,
        evidence: Object.freeze([Object.freeze({
          source: 'PRODUCT_RUNTIME_OWNER_PROJECTION' as const,
          ownerId: 'productIntegration.incident-router' as const,
          truthLabel: 'BUILT_AND_TESTED' as const,
        })]),
        reasonCode: null,
      });
    }
    if (descriptor.identity === 'notification-incident-router'
      && incidentAvailability.state === 'UNAVAILABLE') {
      return Object.freeze({
        identity: descriptor.identity,
        owner: 'PRODUCT_INTEGRATION_INCIDENT_ROUTER',
        canonicalComponentIds,
        inventoryState: 'MISSING' as const,
        evidence: null,
        reasonCode: incidentAvailability.blocker ?? 'INCIDENT_OWNER_UNAVAILABLE',
      });
    }
    if (canonicalComponentIds.length === 0) {
      return Object.freeze({
        identity: descriptor.identity,
        owner: descriptor.owner,
        canonicalComponentIds,
        inventoryState: descriptor.unavailableState!,
        evidence: null,
        reasonCode: descriptor.unavailableReason!,
      });
    }

    const observations = canonicalComponentIds.map((componentId) => evidenceById.get(componentId) ?? []);
    if (observations.some((matches) => matches.length !== 1)) {
      const duplicated = observations.some((matches) => matches.length > 1);
      return Object.freeze({
        identity: descriptor.identity,
        owner: descriptor.owner,
        canonicalComponentIds,
        inventoryState: 'MISSING' as const,
        evidence: null,
        reasonCode: duplicated
          ? 'CANONICAL_COMPONENT_EVIDENCE_DUPLICATED'
          : 'CANONICAL_COMPONENT_EVIDENCE_MISSING',
      });
    }
    return Object.freeze({
      identity: descriptor.identity,
      owner: descriptor.owner,
      canonicalComponentIds,
      inventoryState: 'EVIDENCE_PRESENT' as const,
      evidence: Object.freeze(observations.map((matches) => Object.freeze({
        source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION' as const,
        componentId: matches[0]!.component.componentId,
        componentProjectionIndex: matches[0]!.index,
        serviceReadiness: matches[0]!.component.serviceReadiness,
      }))),
      reasonCode: null,
    });
  }));

  const count = (state: ProductRuntimeManagedInventoryState): number => (
    entries.filter((entry) => entry.inventoryState === state).length
  );
  const evidencePresentCount = count('EVIDENCE_PRESENT');
  const ownerGatedCount = count('OWNER_GATED');
  const notConfiguredCount = count('NOT_CONFIGURED');
  const missingCount = count('MISSING');
  if (evidencePresentCount + ownerGatedCount + notConfiguredCount + missingCount !== 33) {
    throw new TypeError('I00 managed inventory denominator diverged from 33 expected identities');
  }

  const referenced = new Set(MANAGED_INVENTORY_DESCRIPTORS.flatMap((entry) => entry.componentIds));
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_MANAGED_INVENTORY_SCHEMA,
    expectedIdentityCount: 33,
    mappedIdentityCount: MANAGED_INVENTORY_DESCRIPTORS.filter((entry) => entry.componentIds.length > 0).length
      + (incidentAvailability.state === 'AVAILABLE' ? 1 : 0),
    evidencePresentCount,
    ownerGatedCount,
    notConfiguredCount,
    missingCount,
    canonicalComponentCount: SYSTEM_COMPONENT_IDS.length,
    referencedCanonicalComponentCount: referenced.size,
    observedCanonicalComponentCount: SYSTEM_COMPONENT_IDS.filter((componentId) => (
      (evidenceById.get(componentId)?.length ?? 0) === 1
    )).length,
    entries,
  });
}
