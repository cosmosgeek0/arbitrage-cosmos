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
  compareAscii,
  deepFreeze,
  roundedPercent,
  sortedUniqueStrings,
  strongestResult,
} from './reference-helpers.mjs';
import {
  sha256CanonicalJson,
  sha256CanonicalJsonExcluding,
} from './canonical-sha256.mjs';

const SCHEMA_VERSION = 'release-bound-expected-manifest.v1';
const ITEM_KINDS = ['COMPONENT', 'DEPENDENCY', 'SOURCE', 'COMMAND_PATH', 'CAPITAL_PATH', 'RECOVERY_PATH', 'SENTINEL', 'COCKPIT_PROJECTION'];
const SUPPORT_STATES = ['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN'];
const CONFIGURATION_STATES = ['CONFIGURED', 'NOT_CONFIGURED', 'OWNER_GATED', 'UNKNOWN'];
const RELEASE_STATUSES = ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'LIVE_PUBLIC', 'SYNTHETIC_ONLY', 'BLOCKED', 'NOT_CONFIGURED', 'MISSING'];
const DATA_MODES = ['LIVE', 'SYNTHETIC', 'SHADOW', 'UNAVAILABLE', 'UNKNOWN'];
const IDENTITIES = ['DISCOVERED', 'MISSING', 'UNKNOWN'];
const TELEMETRY_STATES = ['INSTRUMENTED', 'UNINSTRUMENTED', 'UNKNOWN'];
const FRESHNESS_STATES = ['CURRENT', 'STALE', 'SILENT', 'UNAVAILABLE', 'UNKNOWN'];
const COHERENCE_STATES = ['COHERENT', 'INCOHERENT', 'UNKNOWN'];
const READINESS_STATES = ['STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED'];
const TRUTH_LABELS = ['LIVE_PUBLIC', 'DRY_RUN', 'SYNTHETIC_ONLY', 'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN'];
const AUTHORITIES = ['LIVE_PUBLIC', 'LIVE_PRIVATE', 'DERIVED_LIVE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'UNAVAILABLE'];
const PROBE_STATES = ['PASS', 'FAIL', 'UNKNOWN', 'NOT_REQUIRED'];
const RECONCILIATION_STATES = ['RECONCILED', 'UNRECONCILED', 'UNKNOWN', 'NOT_APPLICABLE'];
const CONTROL_STATES = ['LIVE', 'DISABLED', 'UNIMPLEMENTED', 'NOT_APPLICABLE', 'UNKNOWN'];
const COMPATIBILITY_STATES = ['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN'];
const SEMANTIC_STREAMS = [
  'MARKET_UNIVERSE', 'SPOT_MINI_TICKER', 'SPOT_AGGREGATE_TRADE',
  'SPOT_BEST_BID_ASK', 'USD_M_BEST_BID_ASK', 'USD_M_MARK_FUNDING', 'USD_M_LIQUIDATION',
];
const SOURCE_PRODUCER_KINDS = ['EXISTING_AUDITED', 'MANUAL_ACCEPTANCE_ONLY', 'NONE'];
const SOURCE_TRANSPORTS = ['INJECTED_EXISTING', 'MANUAL_PUBLIC_SMOKE', 'NONE'];
export const RELEASE_MANIFEST_DIGEST_PROFILE = 'release-bound-expected-manifest.canonical-json-sha256.v1';

export const RELEASE_COMPONENT_CATALOG = deepFreeze([
  { componentId: 'public-spot-source', expectedId: 'component:public-spot-source', ownerId: 'INTELLIGENCE_RUNTIME' },
  { componentId: 'public-usdm-source', expectedId: 'component:public-usdm-source', ownerId: 'INTELLIGENCE_RUNTIME' },
  { componentId: 'market-universe', expectedId: 'component:market-universe', ownerId: 'AUDITED_APP' },
  { componentId: 'intelligence-runtime', expectedId: 'component:intelligence-runtime', ownerId: 'INTELLIGENCE_RUNTIME' },
  { componentId: 'market-intelligence', expectedId: 'component:market-intelligence', ownerId: 'MARKET_INTELLIGENCE' },
  { componentId: 'basis-engine', expectedId: 'component:basis-engine', ownerId: 'BASIS_ENGINE' },
  { componentId: 'volume-engine', expectedId: 'component:volume-engine', ownerId: 'VOLUME_ENGINE' },
  { componentId: 'capital-supervision', expectedId: 'component:capital-supervision', ownerId: 'CAPITAL_SUPERVISION' },
  { componentId: 'multileg-risk', expectedId: 'component:multileg-risk', ownerId: 'BACKEND_FOUNDATION_RISK' },
  { componentId: 'execution-coordinator-validate-only', expectedId: 'component:execution-coordinator-validate-only', ownerId: 'BACKEND_FOUNDATION_EXECUTION' },
  { componentId: 'reconciliation', expectedId: 'component:reconciliation', ownerId: 'BACKEND_FOUNDATION_RECONCILIATION' },
  { componentId: 'ledger-persistence', expectedId: 'component:ledger-persistence', ownerId: 'EXISTING_LEDGER' },
  { componentId: 'engine-supervisor', expectedId: 'component:engine-supervisor', ownerId: 'SYSTEM_INTEGRATION' },
]);

export const RELEASE_SOURCE_CATALOG = deepFreeze([
  {
    semanticStream: 'MARKET_UNIVERSE', expectedId: 'source:MARKET_UNIVERSE', ownerId: 'INTELLIGENCE_RUNTIME',
    dependentCapabilityIds: ['component:market-universe', 'semantic-stream:MARKET_UNIVERSE'],
    physicalProducer: { kind: 'EXISTING_AUDITED', producerId: 'market-engine', ownerPath: 'server/src/engine/marketData.ts', transport: 'INJECTED_EXISTING' },
    semanticPublisher: 'intelligence-runtime',
  },
  {
    semanticStream: 'SPOT_MINI_TICKER', expectedId: 'source:SPOT_MINI_TICKER', ownerId: 'INTELLIGENCE_RUNTIME',
    dependentCapabilityIds: ['component:public-spot-source', 'semantic-stream:SPOT_MINI_TICKER'],
    physicalProducer: { kind: 'EXISTING_AUDITED', producerId: 'market-engine', ownerPath: 'server/src/engine/marketData.ts', transport: 'INJECTED_EXISTING' },
    semanticPublisher: 'intelligence-runtime',
  },
  {
    semanticStream: 'SPOT_AGGREGATE_TRADE', expectedId: 'source:SPOT_AGGREGATE_TRADE', ownerId: 'INTELLIGENCE_RUNTIME',
    dependentCapabilityIds: ['component:public-spot-source', 'semantic-stream:SPOT_AGGREGATE_TRADE'],
    physicalProducer: { kind: 'EXISTING_AUDITED', producerId: 'volume-runtime', ownerPath: 'server/src/services/volumeRuntime.ts', transport: 'INJECTED_EXISTING' },
    semanticPublisher: 'intelligence-runtime',
  },
  {
    semanticStream: 'SPOT_BEST_BID_ASK', expectedId: 'source:SPOT_BEST_BID_ASK', ownerId: 'INTELLIGENCE_RUNTIME',
    dependentCapabilityIds: ['component:public-spot-source', 'semantic-stream:SPOT_BEST_BID_ASK'],
    physicalProducer: { kind: 'EXISTING_AUDITED', producerId: 'basis-runtime', ownerPath: 'server/src/services/basisRuntime.ts', transport: 'INJECTED_EXISTING' },
    semanticPublisher: 'intelligence-runtime',
  },
  {
    semanticStream: 'USD_M_BEST_BID_ASK', expectedId: 'source:USD_M_BEST_BID_ASK', ownerId: 'INTELLIGENCE_RUNTIME',
    dependentCapabilityIds: ['component:public-usdm-source', 'semantic-stream:USD_M_BEST_BID_ASK'],
    physicalProducer: { kind: 'EXISTING_AUDITED', producerId: 'basis-runtime', ownerPath: 'server/src/services/basisRuntime.ts', transport: 'INJECTED_EXISTING' },
    semanticPublisher: 'intelligence-runtime',
  },
  {
    semanticStream: 'USD_M_MARK_FUNDING', expectedId: 'source:USD_M_MARK_FUNDING', ownerId: 'INTELLIGENCE_RUNTIME',
    dependentCapabilityIds: ['component:public-usdm-source', 'semantic-stream:USD_M_MARK_FUNDING'],
    physicalProducer: { kind: 'EXISTING_AUDITED', producerId: 'market-engine', ownerPath: 'server/src/engine/marketData.ts', transport: 'INJECTED_EXISTING' },
    semanticPublisher: 'intelligence-runtime',
  },
  {
    semanticStream: 'USD_M_LIQUIDATION', expectedId: 'source:USD_M_LIQUIDATION', ownerId: 'INTELLIGENCE_RUNTIME',
    dependentCapabilityIds: ['component:public-usdm-source', 'semantic-stream:USD_M_LIQUIDATION'],
    physicalProducer: { kind: 'EXISTING_AUDITED', producerId: 'market-engine', ownerPath: 'server/src/engine/marketData.ts', transport: 'INJECTED_EXISTING' },
    semanticPublisher: 'intelligence-runtime',
  },
]);

export const RELEASE_DEPENDENCY_CATALOG = deepFreeze([
  ['ledger-persistence', 'public-spot-source', true],
  ['ledger-persistence', 'public-usdm-source', true],
  ['ledger-persistence', 'engine-supervisor', true],
  ['public-spot-source', 'market-universe', true],
  ['public-usdm-source', 'market-universe', false],
  ['market-universe', 'intelligence-runtime', true],
  ['public-spot-source', 'intelligence-runtime', true],
  ['public-usdm-source', 'intelligence-runtime', false],
  ['intelligence-runtime', 'market-intelligence', true],
  ['market-intelligence', 'basis-engine', true],
  ['public-spot-source', 'basis-engine', true],
  ['public-usdm-source', 'basis-engine', true],
  ['market-intelligence', 'volume-engine', true],
  ['public-spot-source', 'volume-engine', true],
  ['market-intelligence', 'capital-supervision', true],
  ['basis-engine', 'capital-supervision', false],
  ['volume-engine', 'capital-supervision', false],
  ['capital-supervision', 'multileg-risk', true],
  ['multileg-risk', 'execution-coordinator-validate-only', true],
  ['ledger-persistence', 'execution-coordinator-validate-only', true],
  ['execution-coordinator-validate-only', 'reconciliation', true],
  ['ledger-persistence', 'reconciliation', true],
].map(([from, to, required]) => ({
  from,
  to,
  required,
  expectedId: `dependency:${from}:${to}`,
  ownerId: 'SYSTEM_INTEGRATION',
})));

export const RELEASE_CAPITAL_PATH_CATALOG = deepFreeze([
  { expectedId: 'capital-path:evidence-proposal-to-capital-mandate', ownerId: 'CAPITAL_SUPERVISION', dependentCapabilityIds: ['component:market-intelligence', 'component:capital-supervision'] },
  { expectedId: 'capital-path:capital-mandate-to-risk', ownerId: 'BACKEND_FOUNDATION_RISK', dependentCapabilityIds: ['component:capital-supervision', 'component:multileg-risk'] },
  { expectedId: 'capital-path:accepted-risk-to-validate-only-plan', ownerId: 'BACKEND_FOUNDATION_EXECUTION', dependentCapabilityIds: ['component:multileg-risk', 'component:execution-coordinator-validate-only'] },
  { expectedId: 'capital-path:reconciliation-to-ledger-outcome', ownerId: 'BACKEND_FOUNDATION_RECONCILIATION', dependentCapabilityIds: ['component:reconciliation', 'component:ledger-persistence'] },
]);

export const RELEASE_RECOVERY_PATH_CATALOG = deepFreeze([
  { expectedId: 'recovery-path:kill-switch-risk-reduction', ownerId: 'SYSTEM_INTEGRATION', dependentCapabilityIds: ['command-path:SET_KILL_SWITCH', 'component:multileg-risk'] },
  { expectedId: 'recovery-path:reconciliation-divergence', ownerId: 'BACKEND_FOUNDATION_RECONCILIATION', dependentCapabilityIds: ['component:reconciliation', 'component:ledger-persistence'] },
  { expectedId: 'recovery-path:managed-restart-restore', ownerId: 'SYSTEM_INTEGRATION', dependentCapabilityIds: ['component:engine-supervisor', 'component:ledger-persistence'] },
  { expectedId: 'recovery-path:graceful-drain', ownerId: 'SYSTEM_INTEGRATION', dependentCapabilityIds: ['component:engine-supervisor', 'component:ledger-persistence'] },
]);

export const RELEASE_COMMAND_PATH_CATALOG = deepFreeze([
  { command: 'SET_SAFE_MODE', contractId: 'CONTROL_SAFE_MODE_V1', backendMutationId: 'SYSTEM_INTEGRATION.SET_SAFE_MODE' },
  { command: 'SET_KILL_SWITCH', contractId: 'CONTROL_KILL_SWITCH_V1', backendMutationId: 'SYSTEM_INTEGRATION.SET_KILL_SWITCH' },
  { command: 'SET_INTAKE_PAUSED', contractId: 'CONTROL_INTAKE_PAUSE_V1', backendMutationId: 'SYSTEM_INTEGRATION.SET_INTAKE_PAUSED' },
  { command: 'SET_COMPONENT_STATE', contractId: 'CONTROL_COMPONENT_DESIRED_STATE_V1', backendMutationId: 'SYSTEM_INTEGRATION.SET_COMPONENT_STATE' },
  { command: 'REVOKE_APPROVAL', contractId: 'CONTROL_APPROVAL_REVOKE_V1', backendMutationId: 'SYSTEM_INTEGRATION.REVOKE_APPROVAL' },
  { command: 'APPLY_CONFIGURATION', contractId: 'CONTROL_BOUNDED_CONFIG_REVISION_V1', backendMutationId: 'SYSTEM_INTEGRATION.APPLY_CONFIGURATION' },
  { command: 'REVOKE_RESERVATION', contractId: null, backendMutationId: 'SYSTEM_INTEGRATION.REVOKE_RESERVATION' },
  { command: 'RESTART_COMPONENT', contractId: null, backendMutationId: 'SYSTEM_INTEGRATION.RESTART_COMPONENT' },
].map((entry) => ({ ...entry, expectedId: `command-path:${entry.command}` })));

export const RELEASE_COCKPIT_PROJECTION_IDS = deepFreeze([
  'PANEL_DASHBOARD_TRUTH_V1',
  'PANEL_CONTROL_ROOM_TRUTH_V1',
  'CONTROL_KILL_SWITCH_V1',
  'CONTROL_SAFE_MODE_V1',
  'CONTROL_INTAKE_PAUSE_V1',
  'CONTROL_COMPONENT_DESIRED_STATE_V1',
  'CONTROL_APPROVAL_REVOKE_V1',
  'CONTROL_BOUNDED_CONFIG_REVISION_V1',
  'PANEL_ACCOUNT_TRUTH_V1',
  'PANEL_MARKETS_TRUTH_V1',
  'PANEL_TOKEN_TRUTH_V1',
  'PANEL_BASIS_TRUTH_V1',
  'PANEL_VOLUME_TRUTH_V1',
  'PANEL_OPPORTUNITIES_TRUTH_V1',
  'PANEL_BORROW_TRUTH_V1',
  'PANEL_EXECUTION_TRUTH_V1',
  'PANEL_ORDERS_TRUTH_V1',
  'PANEL_POSITIONS_TRUTH_V1',
  'PANEL_FILLS_TRUTH_V1',
  'PANEL_PNL_TRUTH_V1',
  'PANEL_RISK_TRUTH_V1',
  'PANEL_HEALTH_TRUTH_V1',
  'PANEL_LOGS_LEDGER_TRUTH_V1',
  'PANEL_NOTIFICATIONS_TRUTH_V1',
  'PANEL_HEALTH_OUT_OF_BAND_LIVENESS_V1',
].map((contractId) => `cockpit-projection:${contractId}`));

const RELEASE_INVENTORY_SETS = deepFreeze([
  {
    outputKey: 'components',
    source: 'releaseBoundExpectedManifest.components',
    kind: 'COMPONENT',
    idPrefix: 'component:',
    canonicalItems: RELEASE_COMPONENT_CATALOG.map((entry) => ({
      expectedId: entry.expectedId,
      required: true,
      ownerId: entry.ownerId,
      dependentCapabilityIds: entry.componentId === 'ledger-persistence'
        ? ['durable-evidence', 'reconciliation']
        : [`managed-component:${entry.componentId}`],
    })),
  },
  {
    outputKey: 'sources',
    source: 'releaseBoundExpectedManifest.sources',
    kind: 'SOURCE',
    idPrefix: 'source:',
    canonicalItems: RELEASE_SOURCE_CATALOG.map((entry) => ({
      expectedId: entry.expectedId,
      required: true,
      ownerId: entry.ownerId,
      dependentCapabilityIds: entry.dependentCapabilityIds,
      observedContract: {
        observedOwnerId: entry.ownerId,
        semanticStream: entry.semanticStream,
        physicalProducer: entry.physicalProducer,
        semanticPublisher: entry.semanticPublisher,
      },
    })),
  },
  {
    outputKey: 'dependencies',
    source: 'releaseBoundExpectedManifest.dependencies',
    kind: 'DEPENDENCY',
    idPrefix: 'dependency:',
    canonicalItems: RELEASE_DEPENDENCY_CATALOG.map((entry) => ({
      expectedId: entry.expectedId,
      required: entry.required,
      ownerId: entry.ownerId,
      dependentCapabilityIds: [`component:${entry.from}`, `component:${entry.to}`],
    })),
  },
  {
    outputKey: 'capitalPaths',
    source: 'releaseBoundExpectedManifest.capitalPaths',
    kind: 'CAPITAL_PATH',
    idPrefix: 'capital-path:',
    canonicalItems: RELEASE_CAPITAL_PATH_CATALOG.map((entry) => ({ ...entry, required: true })),
  },
  {
    outputKey: 'recoveryPaths',
    source: 'releaseBoundExpectedManifest.recoveryPaths',
    kind: 'RECOVERY_PATH',
    idPrefix: 'recovery-path:',
    canonicalItems: RELEASE_RECOVERY_PATH_CATALOG.map((entry) => ({ ...entry, required: true })),
  },
  {
    outputKey: 'commandPaths',
    source: 'releaseBoundExpectedManifest.commandPaths',
    kind: 'COMMAND_PATH',
    idPrefix: 'command-path:',
    canonicalItems: RELEASE_COMMAND_PATH_CATALOG.map((entry) => ({
      expectedId: entry.expectedId,
      required: true,
      ownerId: 'SYSTEM_INTEGRATION',
      dependentCapabilityIds: [
        entry.contractId === null
          ? `system-control-command:${entry.command}`
          : `control-contract:${entry.contractId}`,
        `backend-mutation:${entry.backendMutationId}`,
      ],
    })),
  },
  {
    outputKey: 'cockpitCommandProjections',
    source: 'releaseBoundExpectedManifest.cockpitCommandProjections',
    kind: 'COMMAND_PATH',
    idPrefix: 'command-path:',
    subset: true,
    canonicalItems: RELEASE_COMMAND_PATH_CATALOG
      .filter((entry) => entry.contractId !== null)
      .map((entry) => ({
        expectedId: entry.expectedId,
        required: true,
        ownerId: 'SYSTEM_INTEGRATION',
        dependentCapabilityIds: [
          `control-contract:${entry.contractId}`,
          `backend-mutation:${entry.backendMutationId}`,
        ],
      })),
  },
  {
    outputKey: 'cockpitProjections',
    source: 'releaseBoundExpectedManifest.cockpitProjections',
    kind: 'COCKPIT_PROJECTION',
    idPrefix: 'cockpit-projection:',
    canonicalItems: RELEASE_COCKPIT_PROJECTION_IDS.map((expectedId) => ({
      expectedId,
      required: true,
      ownerId: 'IP_CONTROL',
      dependentCapabilityIds: [`cockpit-contract:${expectedId.slice('cockpit-projection:'.length)}`],
    })),
  },
  {
    outputKey: 'sentinels',
    source: 'releaseBoundExpectedManifest.sentinels',
    kind: 'SENTINEL',
    idPrefix: null,
    canonicalItems: [{
      expectedId: 'independent-sentinel',
      required: true,
      ownerId: 'I08_SUPERVISOR',
      dependentCapabilityIds: ['trade-readiness'],
    }],
  },
]);

export function deriveManifestSha256(manifest) {
  return sha256CanonicalJsonExcluding(manifest, 'manifestSha256');
}

function assertIdentifier(value, path) {
  assertBoundedString(value, path, 1, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) throw new TypeError(`${path} is not a stable identifier`);
}

function assertNullableTimestamp(value, path) {
  if (value !== null) assertSafeInteger(value, path);
}

function validateExpectedItem(item, index) {
  const path = `manifest.expectedItems[${index}]`;
  assertClosedRecord(item, path, [
    'expectedId', 'kind', 'ownerId', 'required', 'enabled', 'capitalCritical',
    'dependentCapabilityIds', 'supportState', 'configurationState', 'expectedReleaseStatuses',
    'expectedTelemetrySchemaVersion', 'expectedDataMode', 'independentProbeRequired', 'reconciliationRequired',
  ]);
  assertIdentifier(item.expectedId, `${path}.expectedId`);
  assertEnum(item.kind, ITEM_KINDS, `${path}.kind`);
  assertIdentifier(item.ownerId, `${path}.ownerId`);
  assertBoolean(item.required, `${path}.required`);
  assertBoolean(item.enabled, `${path}.enabled`);
  assertBoolean(item.capitalCritical, `${path}.capitalCritical`);
  assertArray(item.dependentCapabilityIds, `${path}.dependentCapabilityIds`, 32);
  item.dependentCapabilityIds.forEach((value, child) => assertIdentifier(value, `${path}.dependentCapabilityIds[${child}]`));
  assertUnique(item.dependentCapabilityIds, (value) => value, `${path}.dependentCapabilityIds`);
  assertEnum(item.supportState, SUPPORT_STATES, `${path}.supportState`);
  assertEnum(item.configurationState, CONFIGURATION_STATES, `${path}.configurationState`);
  assertArray(item.expectedReleaseStatuses, `${path}.expectedReleaseStatuses`, RELEASE_STATUSES.length);
  if (item.expectedReleaseStatuses.length === 0) throw new TypeError(`${path}.expectedReleaseStatuses must not be empty`);
  item.expectedReleaseStatuses.forEach((value, child) => assertEnum(value, RELEASE_STATUSES, `${path}.expectedReleaseStatuses[${child}]`));
  assertUnique(item.expectedReleaseStatuses, (value) => value, `${path}.expectedReleaseStatuses`);
  assertBoundedString(item.expectedTelemetrySchemaVersion, `${path}.expectedTelemetrySchemaVersion`, 1, 80);
  assertEnum(item.expectedDataMode, DATA_MODES.slice(0, 4), `${path}.expectedDataMode`);
  assertBoolean(item.independentProbeRequired, `${path}.independentProbeRequired`);
  assertBoolean(item.reconciliationRequired, `${path}.reconciliationRequired`);
}

function validateLifecycleAuthority(value, path) {
  assertClosedRecord(value, path, ['ownerState', 'readiness', 'releaseStatuses', 'truthLabel', 'authority']);
  assertBoundedString(value.ownerState, `${path}.ownerState`, 1, 80);
  assertEnum(value.readiness, READINESS_STATES, `${path}.readiness`);
  assertArray(value.releaseStatuses, `${path}.releaseStatuses`, RELEASE_STATUSES.length);
  if (value.releaseStatuses.length === 0) throw new TypeError(`${path}.releaseStatuses must not be empty`);
  value.releaseStatuses.forEach((entry, index) => assertEnum(entry, RELEASE_STATUSES, `${path}.releaseStatuses[${index}]`));
  assertUnique(value.releaseStatuses, (entry) => entry, `${path}.releaseStatuses`);
  assertEnum(value.truthLabel, TRUTH_LABELS, `${path}.truthLabel`);
  assertEnum(value.authority, AUTHORITIES, `${path}.authority`);
}

function validateObservedItem(item, index) {
  const path = `observation.items[${index}]`;
  assertClosedRecord(item, path, [
    'expectedId', 'identityState', 'telemetryState', 'freshnessState', 'temporalCoherenceState',
    'lifecycleAuthority', 'dataMode', 'independentProbeState', 'reconciliationState',
    'controlState', 'telemetrySchemaVersion', 'lastTelemetryAtMs', 'lastIndependentProbeAtMs', 'reasonCodes',
  ], ['observedOwnerId', 'semanticStream', 'physicalProducer', 'semanticPublisher']);
  assertIdentifier(item.expectedId, `${path}.expectedId`);
  assertEnum(item.identityState, IDENTITIES, `${path}.identityState`);
  assertEnum(item.telemetryState, TELEMETRY_STATES, `${path}.telemetryState`);
  assertEnum(item.freshnessState, FRESHNESS_STATES, `${path}.freshnessState`);
  assertEnum(item.temporalCoherenceState, COHERENCE_STATES, `${path}.temporalCoherenceState`);
  validateLifecycleAuthority(item.lifecycleAuthority, `${path}.lifecycleAuthority`);
  assertEnum(item.dataMode, DATA_MODES, `${path}.dataMode`);
  assertEnum(item.independentProbeState, PROBE_STATES, `${path}.independentProbeState`);
  assertEnum(item.reconciliationState, RECONCILIATION_STATES, `${path}.reconciliationState`);
  assertEnum(item.controlState, CONTROL_STATES, `${path}.controlState`);
  if (item.telemetrySchemaVersion !== null) assertBoundedString(item.telemetrySchemaVersion, `${path}.telemetrySchemaVersion`, 1, 80);
  assertNullableTimestamp(item.lastTelemetryAtMs, `${path}.lastTelemetryAtMs`);
  assertNullableTimestamp(item.lastIndependentProbeAtMs, `${path}.lastIndependentProbeAtMs`);
  assertArray(item.reasonCodes, `${path}.reasonCodes`, 32);
  item.reasonCodes.forEach((value, child) => assertIdentifier(value, `${path}.reasonCodes[${child}]`));
  assertUnique(item.reasonCodes, (value) => value, `${path}.reasonCodes`);
  if (Object.hasOwn(item, 'observedOwnerId')) assertIdentifier(item.observedOwnerId, `${path}.observedOwnerId`);
  if (Object.hasOwn(item, 'semanticStream')) assertEnum(item.semanticStream, SEMANTIC_STREAMS, `${path}.semanticStream`);
  if (Object.hasOwn(item, 'semanticPublisher')) assertIdentifier(item.semanticPublisher, `${path}.semanticPublisher`);
  if (Object.hasOwn(item, 'physicalProducer')) {
    const producer = assertClosedRecord(item.physicalProducer, `${path}.physicalProducer`, [
      'kind', 'producerId', 'ownerPath', 'transport',
    ]);
    assertEnum(producer.kind, SOURCE_PRODUCER_KINDS, `${path}.physicalProducer.kind`);
    if (producer.producerId !== null) assertIdentifier(producer.producerId, `${path}.physicalProducer.producerId`);
    if (producer.ownerPath !== null) assertBoundedString(producer.ownerPath, `${path}.physicalProducer.ownerPath`, 1, 512);
    assertEnum(producer.transport, SOURCE_TRANSPORTS, `${path}.physicalProducer.transport`);
  }
}

function validateTrace(value, path) {
  if (value === null) return;
  assertClosedRecord(value, path, ['correlationId', 'completedAtMs', 'releaseSha']);
  assertIdentifier(value.correlationId, `${path}.correlationId`);
  assertSafeInteger(value.completedAtMs, `${path}.completedAtMs`);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
}

function validateProbe(value, path) {
  if (value === null) return;
  assertClosedRecord(value, path, ['probeId', 'result', 'observedAtMs', 'releaseSha']);
  assertIdentifier(value.probeId, `${path}.probeId`);
  assertEnum(value.result, ['PASS', 'FAIL', 'UNKNOWN'], `${path}.result`);
  assertSafeInteger(value.observedAtMs, `${path}.observedAtMs`);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
}

function validateManifestDigestVerification(value, path) {
  assertClosedRecord(value, path, [
    'result', 'verifiedManifestSha256', 'verifierOwnerId', 'verifierReferenceId', 'verifiedAtMs',
    'verifiedMissionCoverageSha256', 'verifiedAuthorityRegistrySha256',
    'verifiedComponentRegistrySha256', 'verifiedDeploymentTopologySha256',
  ]);
  assertEnum(value.result, ['PASS', 'FAIL', 'UNKNOWN'], `${path}.result`);
  assertSha256(value.verifiedManifestSha256, `${path}.verifiedManifestSha256`);
  for (const key of [
    'verifiedMissionCoverageSha256', 'verifiedAuthorityRegistrySha256',
    'verifiedComponentRegistrySha256', 'verifiedDeploymentTopologySha256',
  ]) assertSha256(value[key], `${path}.${key}`);
  assertIdentifier(value.verifierOwnerId, `${path}.verifierOwnerId`);
  assertIdentifier(value.verifierReferenceId, `${path}.verifierReferenceId`);
  assertNullableTimestamp(value.verifiedAtMs, `${path}.verifiedAtMs`);
}

function validateInput(input) {
  assertClosedRecord(input, 'input', ['schemaVersion', 'nowMs', 'manifest', 'observation']);
  assertEnum(input.schemaVersion, [SCHEMA_VERSION], 'input.schemaVersion');
  assertSafeInteger(input.nowMs, 'input.nowMs');

  const manifest = assertClosedRecord(input.manifest, 'manifest', [
    'manifestId', 'manifestSha256', 'manifestRevision', 'binding', 'review',
    'observationMaximumAgeMs', 'expectedItems',
  ]);
  assertIdentifier(manifest.manifestId, 'manifest.manifestId');
  assertSha256(manifest.manifestSha256, 'manifest.manifestSha256');
  assertSafeInteger(manifest.manifestRevision, 'manifest.manifestRevision', 1, 1_000_000);
  const binding = assertClosedRecord(manifest.binding, 'manifest.binding', [
    'acceptedReleaseSha', 'missionCoverageSha256', 'authorityRegistrySha256',
    'componentRegistrySha256', 'deploymentTopologySha256',
  ]);
  assertGitSha(binding.acceptedReleaseSha, 'manifest.binding.acceptedReleaseSha');
  for (const key of ['missionCoverageSha256', 'authorityRegistrySha256', 'componentRegistrySha256', 'deploymentTopologySha256']) {
    assertSha256(binding[key], `manifest.binding.${key}`);
  }
  const review = assertClosedRecord(manifest.review, 'manifest.review', [
    'reviewerOwnerId', 'reviewEvidenceId', 'reviewedAtMs',
  ]);
  assertIdentifier(review.reviewerOwnerId, 'manifest.review.reviewerOwnerId');
  assertIdentifier(review.reviewEvidenceId, 'manifest.review.reviewEvidenceId');
  assertSafeInteger(review.reviewedAtMs, 'manifest.review.reviewedAtMs');
  assertSafeInteger(manifest.observationMaximumAgeMs, 'manifest.observationMaximumAgeMs', 1, 604_800_000);
  assertArray(manifest.expectedItems, 'manifest.expectedItems', 512);
  if (manifest.expectedItems.length === 0) throw new TypeError('manifest.expectedItems must not be empty');
  manifest.expectedItems.forEach(validateExpectedItem);
  assertUnique(manifest.expectedItems, (item) => item.expectedId, 'manifest.expectedItems');

  const observation = assertClosedRecord(input.observation, 'observation', [
    'manifestId', 'manifestSha256', 'testedReleaseSha', 'runningReleaseSha', 'deployedReleaseSha',
    'observedAtMs', 'telemetrySchemaCompatibility', 'manifestDigestVerification', 'lastCompleteCorrelationTrace',
    'lastIndependentBlackBoxProbe', 'items',
  ]);
  assertIdentifier(observation.manifestId, 'observation.manifestId');
  assertSha256(observation.manifestSha256, 'observation.manifestSha256');
  for (const key of ['testedReleaseSha', 'runningReleaseSha', 'deployedReleaseSha']) {
    assertGitSha(observation[key], `observation.${key}`);
  }
  assertSafeInteger(observation.observedAtMs, 'observation.observedAtMs');
  assertEnum(observation.telemetrySchemaCompatibility, COMPATIBILITY_STATES, 'observation.telemetrySchemaCompatibility');
  validateManifestDigestVerification(observation.manifestDigestVerification, 'observation.manifestDigestVerification');
  validateTrace(observation.lastCompleteCorrelationTrace, 'observation.lastCompleteCorrelationTrace');
  validateProbe(observation.lastIndependentBlackBoxProbe, 'observation.lastIndependentBlackBoxProbe');
  assertArray(observation.items, 'observation.items', 512);
  observation.items.forEach(validateObservedItem);
  assertUnique(observation.items, (item) => item.expectedId, 'observation.items');
}

function axisResult(actual, passValue, failValues, unknownValues, failCode, unknownCode, reasons) {
  if (actual === passValue) return 'PASS';
  if (failValues.includes(actual)) {
    reasons.push(failCode);
    return 'FAIL';
  }
  if (unknownValues.includes(actual)) {
    reasons.push(unknownCode);
    return 'UNKNOWN';
  }
  reasons.push(unknownCode);
  return 'UNKNOWN';
}

function evaluateItem(expected, observed, nowMs, maximumAgeMs) {
  const blocking = expected.required && expected.enabled;
  const reasons = [];
  const results = [];
  if (expected.supportState === 'UNSUPPORTED') {
    reasons.push('REQUIRED_ITEM_UNSUPPORTED');
    results.push('FAIL');
  } else if (expected.supportState === 'UNKNOWN') {
    reasons.push('REQUIRED_ITEM_SUPPORT_UNKNOWN');
    results.push('UNKNOWN');
  }
  if (expected.configurationState !== 'CONFIGURED') {
    reasons.push(expected.configurationState === 'UNKNOWN' ? 'REQUIRED_ITEM_CONFIGURATION_UNKNOWN' : 'REQUIRED_ITEM_NOT_CONFIGURED');
    results.push(expected.configurationState === 'UNKNOWN' ? 'UNKNOWN' : 'FAIL');
  }
  if (expected.expectedDataMode === 'UNAVAILABLE') {
    reasons.push('EXPECTED_DATA_MODE_UNAVAILABLE');
    results.push('FAIL');
  }
  if (expected.expectedReleaseStatuses.some((status) => ['BLOCKED', 'NOT_CONFIGURED', 'MISSING'].includes(status))) {
    reasons.push('EXPECTED_RELEASE_POSTURE_NON_GREEN');
    results.push('FAIL');
  }
  if (observed === undefined) {
    reasons.push('EXPECTED_ITEM_MISSING');
    return {
      expectedId: expected.expectedId,
      blocking,
      result: 'FAIL',
      liveEligible: false,
      truthReasonCodes: ['EXPECTED_ITEM_NOT_OBSERVED_LIVE'],
      reasonCodes: sortedUniqueStrings(reasons),
      dependentCapabilityIds: [...expected.dependentCapabilityIds].sort(compareAscii),
    };
  }

  results.push(axisResult(observed.identityState, 'DISCOVERED', ['MISSING'], ['UNKNOWN'], 'EXPECTED_IDENTITY_MISSING', 'IDENTITY_UNKNOWN', reasons));
  results.push(axisResult(observed.telemetryState, 'INSTRUMENTED', ['UNINSTRUMENTED'], ['UNKNOWN'], 'EXPECTED_TELEMETRY_UNINSTRUMENTED', 'TELEMETRY_UNKNOWN', reasons));
  results.push(axisResult(observed.freshnessState, 'CURRENT', ['STALE', 'SILENT', 'UNAVAILABLE'], ['UNKNOWN'], `EXPECTED_TELEMETRY_${observed.freshnessState}`, 'FRESHNESS_UNKNOWN', reasons));
  results.push(axisResult(observed.temporalCoherenceState, 'COHERENT', ['INCOHERENT'], ['UNKNOWN'], 'TEMPORAL_COHERENCE_FAILED', 'TEMPORAL_COHERENCE_UNKNOWN', reasons));

  if (observed.lifecycleAuthority.readiness !== 'READY') {
    reasons.push(`READINESS_${observed.lifecycleAuthority.readiness}`);
    results.push(observed.lifecycleAuthority.readiness === 'WARMING' ? 'UNKNOWN' : 'FAIL');
  }
  if (observed.lifecycleAuthority.truthLabel === 'UNKNOWN') {
    reasons.push('TRUTH_UNKNOWN');
    results.push('UNKNOWN');
  } else if (observed.lifecycleAuthority.truthLabel === 'UNAVAILABLE') {
    reasons.push('TRUTH_UNAVAILABLE');
    results.push('FAIL');
  }
  if (observed.lifecycleAuthority.authority === 'UNAVAILABLE') {
    reasons.push('AUTHORITY_UNAVAILABLE');
    results.push('FAIL');
  }
  if (observed.lifecycleAuthority.releaseStatuses.some((status) => ['BLOCKED', 'NOT_CONFIGURED', 'MISSING'].includes(status))) {
    reasons.push('OBSERVED_RELEASE_POSTURE_NON_GREEN');
    results.push('FAIL');
  }
  const missingReleaseStatuses = expected.expectedReleaseStatuses.filter((status) => !observed.lifecycleAuthority.releaseStatuses.includes(status));
  if (missingReleaseStatuses.length > 0) {
    reasons.push('EXPECTED_RELEASE_STATUS_MISSING');
    results.push('FAIL');
  }
  if (observed.dataMode !== expected.expectedDataMode) {
    reasons.push('EXPECTED_DATA_MODE_MISMATCH');
    results.push(observed.dataMode === 'UNKNOWN' ? 'UNKNOWN' : 'FAIL');
  }
  if (expected.independentProbeRequired) {
    results.push(axisResult(observed.independentProbeState, 'PASS', ['FAIL', 'NOT_REQUIRED'], ['UNKNOWN'], 'INDEPENDENT_PROBE_FAILED', 'INDEPENDENT_PROBE_UNKNOWN', reasons));
    if (observed.lastIndependentProbeAtMs === null) {
      reasons.push('INDEPENDENT_PROBE_TIMESTAMP_MISSING');
      results.push('UNKNOWN');
    } else if (observed.lastIndependentProbeAtMs > nowMs) {
      reasons.push('INDEPENDENT_PROBE_TIMESTAMP_FROM_FUTURE');
      results.push('UNKNOWN');
    } else if (nowMs - observed.lastIndependentProbeAtMs > maximumAgeMs) {
      reasons.push('INDEPENDENT_PROBE_EVIDENCE_EXPIRED');
      results.push('UNKNOWN');
    }
  }
  if (expected.reconciliationRequired) {
    results.push(axisResult(observed.reconciliationState, 'RECONCILED', ['UNRECONCILED', 'NOT_APPLICABLE'], ['UNKNOWN'], 'RECONCILIATION_NOT_COMPLETE', 'RECONCILIATION_UNKNOWN', reasons));
  }
  if (expected.kind === 'COMMAND_PATH') {
    results.push(axisResult(observed.controlState, 'LIVE', ['DISABLED', 'UNIMPLEMENTED', 'NOT_APPLICABLE'], ['UNKNOWN'], `CONTROL_${observed.controlState}`, 'CONTROL_UNKNOWN', reasons));
  }
  if (observed.telemetryState === 'INSTRUMENTED' && observed.telemetrySchemaVersion === null) {
    reasons.push('TELEMETRY_SCHEMA_VERSION_MISSING');
    results.push('FAIL');
  }
  if (observed.telemetryState === 'INSTRUMENTED'
      && observed.telemetrySchemaVersion !== expected.expectedTelemetrySchemaVersion) {
    reasons.push('TELEMETRY_SCHEMA_VERSION_MISMATCH');
    results.push('FAIL');
  }
  if (observed.telemetryState === 'INSTRUMENTED' && observed.lastTelemetryAtMs === null) {
    reasons.push('TELEMETRY_TIMESTAMP_MISSING');
    results.push('FAIL');
  } else if (observed.lastTelemetryAtMs !== null && observed.lastTelemetryAtMs > nowMs) {
    reasons.push('TELEMETRY_TIMESTAMP_FROM_FUTURE');
    results.push('UNKNOWN');
  } else if (observed.lastTelemetryAtMs !== null && nowMs - observed.lastTelemetryAtMs > maximumAgeMs) {
    reasons.push('TELEMETRY_AGE_EXCEEDS_POLICY');
    results.push('FAIL');
  }
  reasons.push(...observed.reasonCodes);

  const liveEligible = expected.expectedDataMode === 'LIVE'
    && observed.dataMode === 'LIVE'
    && observed.lifecycleAuthority.truthLabel === 'LIVE_PUBLIC'
    && observed.lifecycleAuthority.releaseStatuses.includes('LIVE_PUBLIC')
    && ['LIVE_PUBLIC', 'LIVE_PRIVATE', 'DERIVED_LIVE'].includes(observed.lifecycleAuthority.authority);
  return {
    expectedId: expected.expectedId,
    blocking,
    result: strongestResult(results),
    liveEligible,
    truthReasonCodes: liveEligible ? [] : ['EXPECTED_ITEM_NOT_LIVE_PUBLIC'],
    reasonCodes: sortedUniqueStrings(reasons),
    dependentCapabilityIds: [...expected.dependentCapabilityIds].sort(compareAscii),
  };
}

function evaluateExactInventorySet({
  definition,
  manifest,
  observation,
  itemEvaluationById,
  bindingResult,
  evaluationEvidenceSha256,
}) {
  const canonicalItems = definition.canonicalItems
    .map((item) => ({
      ...item,
      kind: definition.kind,
      enabled: true,
      dependentCapabilityIds: [...item.dependentCapabilityIds].sort(compareAscii),
    }))
    .sort((left, right) => compareAscii(left.expectedId, right.expectedId));
  const canonicalIds = canonicalItems.map((item) => item.expectedId);
  const canonicalRequiredEnabledIds = canonicalItems
    .filter((item) => item.required)
    .map((item) => item.expectedId);
  const manifestItems = manifest.expectedItems
    .filter((item) => item.kind === definition.kind)
    .filter((item) => definition.subset !== true || canonicalIds.includes(item.expectedId));
  const manifestIds = manifestItems
    .map((item) => item.expectedId)
    .sort(compareAscii);
  const manifestRequiredEnabledIds = manifestItems
    .filter((item) => item.required && item.enabled)
    .map((item) => item.expectedId)
    .sort(compareAscii);
  const observedIds = observation.items
    .filter((item) => definition.idPrefix === null
      ? canonicalIds.includes(item.expectedId)
      : item.expectedId.startsWith(definition.idPrefix)
        && (definition.subset !== true || canonicalIds.includes(item.expectedId)))
    .map((item) => item.expectedId)
    .sort(compareAscii);
  const missingManifestIds = canonicalIds.filter((id) => !manifestIds.includes(id));
  const unexpectedManifestIds = manifestIds.filter((id) => !canonicalIds.includes(id));
  const missingObservedIds = canonicalIds.filter((id) => !observedIds.includes(id));
  const missingRequiredObservedIds = canonicalRequiredEnabledIds
    .filter((id) => !observedIds.includes(id));
  const missingOptionalObservedIds = missingObservedIds
    .filter((id) => !canonicalRequiredEnabledIds.includes(id));
  const optionalIds = canonicalIds
    .filter((id) => !canonicalRequiredEnabledIds.includes(id));
  const unexpectedObservedIds = observedIds.filter((id) => !canonicalIds.includes(id));
  const matchedIds = canonicalIds.filter((id) => observedIds.includes(id));
  const observedById = new Map(observation.items.map((item) => [item.expectedId, item]));
  const observedContractMismatchIds = canonicalItems
    .filter((canonical) => canonical.observedContract !== undefined)
    .filter((canonical) => {
      const actual = observedById.get(canonical.expectedId);
      if (actual === undefined) return false;
      return actual.observedOwnerId !== canonical.observedContract.observedOwnerId
        || actual.semanticStream !== canonical.observedContract.semanticStream
        || actual.semanticPublisher !== canonical.observedContract.semanticPublisher
        || actual.physicalProducer === undefined
        || sha256CanonicalJson(actual.physicalProducer)
          !== sha256CanonicalJson(canonical.observedContract.physicalProducer);
    })
    .map((item) => item.expectedId);
  const flagMismatchIds = canonicalItems
    .filter((canonical) => {
      const actual = manifestItems.find((item) => item.expectedId === canonical.expectedId);
      return actual === undefined
        || actual.required !== canonical.required
        || actual.enabled !== canonical.enabled
        || actual.ownerId !== canonical.ownerId
        || JSON.stringify([...actual.dependentCapabilityIds].sort(compareAscii))
          !== JSON.stringify(canonical.dependentCapabilityIds);
    })
    .map((item) => item.expectedId);
  const reasons = [];
  if (missingManifestIds.length > 0) reasons.push('CANONICAL_EXPECTED_INVENTORY_MISSING');
  if (unexpectedManifestIds.length > 0) reasons.push('CANONICAL_EXPECTED_INVENTORY_UNEXPECTED');
  if (missingRequiredObservedIds.length > 0) reasons.push('CANONICAL_REQUIRED_REPORTER_INVENTORY_MISSING');
  if (unexpectedObservedIds.length > 0) reasons.push('CANONICAL_REPORTER_INVENTORY_UNEXPECTED');
  if (observedContractMismatchIds.length > 0) reasons.push('CANONICAL_REPORTER_SEMANTIC_BINDING_MISMATCH');
  if (flagMismatchIds.length > 0) reasons.push('CANONICAL_EXPECTED_INVENTORY_FLAG_MISMATCH');
  const itemResults = canonicalRequiredEnabledIds
    .map((id) => itemEvaluationById.get(id)?.result ?? 'FAIL');
  const optionalFailedIds = optionalIds
    .filter((id) => itemEvaluationById.get(id)?.result === 'FAIL');
  const optionalUnknownIds = optionalIds
    .filter((id) => itemEvaluationById.get(id)?.result === 'UNKNOWN');
  let result;
  if (reasons.length > 0 || bindingResult === 'FAIL') result = 'FAIL';
  else if (bindingResult !== 'PASS') result = 'UNKNOWN';
  else if (missingOptionalObservedIds.length > 0
      || optionalFailedIds.length > 0
      || optionalUnknownIds.length > 0) result = 'UNKNOWN';
  else result = strongestResult(itemResults);
  return {
    source: definition.source,
    result,
    evaluationEvidenceSha256,
    identitySetSha256: sha256CanonicalJson({
      source: definition.source,
      manifestId: manifest.manifestId,
      manifestRevision: manifest.manifestRevision,
      manifestSha256: manifest.manifestSha256,
      acceptedReleaseSha: manifest.binding.acceptedReleaseSha,
      expectedItems: canonicalItems,
    }),
    expectedCount: canonicalIds.length,
    expectedRequiredEnabledCount: canonicalRequiredEnabledIds.length,
    manifestCount: manifestIds.length,
    manifestRequiredEnabledCount: manifestRequiredEnabledIds.length,
    observedCount: observedIds.length,
    matchedCount: matchedIds.length,
    expectedIds: canonicalIds,
    expectedItemContracts: canonicalItems,
    expectedRequiredEnabledIds: canonicalRequiredEnabledIds,
    manifestIds,
    manifestRequiredEnabledIds,
    observedIds,
    matchedIds,
    missingManifestIds,
    unexpectedManifestIds,
    missingObservedIds,
    missingRequiredObservedIds,
    missingOptionalObservedIds,
    optionalFailedIds,
    optionalUnknownIds,
    unexpectedObservedIds,
    observedContractMismatchIds,
    flagMismatchIds,
    reasonCodes: sortedUniqueStrings(reasons),
    advisoryReasonCodes: sortedUniqueStrings([
      ...(missingOptionalObservedIds.length === 0 ? [] : ['CANONICAL_OPTIONAL_REPORTER_INVENTORY_MISSING']),
      ...(optionalFailedIds.length === 0 ? [] : ['CANONICAL_OPTIONAL_REPORTER_FAILED']),
      ...(optionalUnknownIds.length === 0 ? [] : ['CANONICAL_OPTIONAL_REPORTER_UNKNOWN']),
    ]),
  };
}

export function evaluateReleaseBoundExpectedManifest(input) {
  validateInput(input);
  const { nowMs, manifest, observation } = input;
  const expectedById = new Map(manifest.expectedItems.map((item) => [item.expectedId, item]));
  const observedById = new Map(observation.items.map((item) => [item.expectedId, item]));
  const acceptedReleaseSha = manifest.binding.acceptedReleaseSha;
  const bindingReasons = [];
  const derivedManifestSha256 = deriveManifestSha256(manifest);
  const canonicalManifestDigestResult = derivedManifestSha256 === manifest.manifestSha256 ? 'PASS' : 'FAIL';
  if (canonicalManifestDigestResult === 'FAIL') bindingReasons.push('MANIFEST_CANONICAL_DIGEST_MISMATCH');
  const manifestReviewResult = manifest.review.reviewedAtMs > nowMs ? 'FAIL' : 'PASS';
  if (manifestReviewResult === 'FAIL') bindingReasons.push('MANIFEST_REVIEW_TIME_FROM_FUTURE');
  if (observation.manifestId !== manifest.manifestId) bindingReasons.push('MANIFEST_ID_MISMATCH');
  if (observation.manifestSha256 !== manifest.manifestSha256) bindingReasons.push('MANIFEST_SHA_MISMATCH');
  if (observation.testedReleaseSha !== acceptedReleaseSha) bindingReasons.push('TESTED_RELEASE_MISMATCH');
  if (observation.runningReleaseSha !== acceptedReleaseSha) bindingReasons.push('RUNNING_RELEASE_MISMATCH');
  if (observation.deployedReleaseSha !== acceptedReleaseSha) bindingReasons.push('DEPLOYED_RELEASE_MISMATCH');
  if (observation.observedAtMs > nowMs) bindingReasons.push('OBSERVATION_FROM_FUTURE');
  else if (nowMs - observation.observedAtMs > manifest.observationMaximumAgeMs) bindingReasons.push('OBSERVATION_STALE');
  if (observation.lastCompleteCorrelationTrace?.releaseSha !== undefined
      && observation.lastCompleteCorrelationTrace.releaseSha !== acceptedReleaseSha) {
    bindingReasons.push('COMPLETE_TRACE_RELEASE_MISMATCH');
  }
  if (observation.lastIndependentBlackBoxProbe?.releaseSha !== undefined
      && observation.lastIndependentBlackBoxProbe.releaseSha !== acceptedReleaseSha) {
    bindingReasons.push('BLACK_BOX_PROBE_RELEASE_MISMATCH');
  }
  const digestEvidence = observation.manifestDigestVerification;
  const digestReasons = [];
  let digestResult = digestEvidence.result;
  if (digestEvidence.result === 'FAIL') digestReasons.push('MANIFEST_DIGEST_VERIFICATION_FAILED');
  else if (digestEvidence.result === 'UNKNOWN') digestReasons.push('MANIFEST_DIGEST_VERIFICATION_UNKNOWN');
  if (digestEvidence.verifiedManifestSha256 !== derivedManifestSha256) {
    digestReasons.push('MANIFEST_DIGEST_VERIFICATION_SHA_MISMATCH');
    digestResult = 'FAIL';
  }
  const verifiedBindingDigests = [
    ['verifiedMissionCoverageSha256', 'missionCoverageSha256', 'MISSION_COVERAGE_DIGEST_VERIFICATION_MISMATCH'],
    ['verifiedAuthorityRegistrySha256', 'authorityRegistrySha256', 'AUTHORITY_REGISTRY_DIGEST_VERIFICATION_MISMATCH'],
    ['verifiedComponentRegistrySha256', 'componentRegistrySha256', 'COMPONENT_REGISTRY_DIGEST_VERIFICATION_MISMATCH'],
    ['verifiedDeploymentTopologySha256', 'deploymentTopologySha256', 'DEPLOYMENT_TOPOLOGY_DIGEST_VERIFICATION_MISMATCH'],
  ];
  for (const [evidenceKey, bindingKey, reasonCode] of verifiedBindingDigests) {
    if (digestEvidence[evidenceKey] !== manifest.binding[bindingKey]) {
      digestReasons.push(reasonCode);
      digestResult = 'FAIL';
    }
  }
  if (digestEvidence.verifiedAtMs === null) {
    digestReasons.push('MANIFEST_DIGEST_VERIFICATION_TIME_MISSING');
    if (digestResult !== 'FAIL') digestResult = 'UNKNOWN';
  } else if (digestEvidence.verifiedAtMs > nowMs) {
    digestReasons.push('MANIFEST_DIGEST_VERIFICATION_TIME_FROM_FUTURE');
    if (digestResult !== 'FAIL') digestResult = 'UNKNOWN';
  } else if (nowMs - digestEvidence.verifiedAtMs > manifest.observationMaximumAgeMs) {
    digestReasons.push('MANIFEST_DIGEST_VERIFICATION_EXPIRED');
    if (digestResult !== 'FAIL') digestResult = 'UNKNOWN';
  }
  const bindingResult = digestResult === 'FAIL'
      || canonicalManifestDigestResult === 'FAIL'
      || manifestReviewResult === 'FAIL' ? 'FAIL'
    : bindingReasons.length > 0 || digestResult !== 'PASS' ? 'UNKNOWN'
      : 'PASS';

  const itemEvaluations = manifest.expectedItems
    .map((expected) => evaluateItem(expected, observedById.get(expected.expectedId), nowMs, manifest.observationMaximumAgeMs))
    .sort((left, right) => compareAscii(left.expectedId, right.expectedId));
  const itemEvaluationById = new Map(itemEvaluations.map((item) => [item.expectedId, item]));
  const blockingEvaluations = itemEvaluations.filter((item) => item.blocking);
  const evaluationEvidencePayload = {
    schemaVersion: 'release-bound-expected-manifest-evaluation-evidence.v1',
    evaluatedAtMs: nowMs,
    manifestId: manifest.manifestId,
    manifestRevision: manifest.manifestRevision,
    manifestSha256: manifest.manifestSha256,
    acceptedReleaseSha,
    verifierReferenceId: digestEvidence.verifierReferenceId,
    observationSha256: sha256CanonicalJson(observation),
  };
  const evaluationEvidenceSha256 = sha256CanonicalJson(evaluationEvidencePayload);
  const exactInventorySets = Object.fromEntries(RELEASE_INVENTORY_SETS.map((definition) => [
    definition.outputKey,
    evaluateExactInventorySet({
      definition,
      manifest,
      observation,
      itemEvaluationById,
      bindingResult,
      evaluationEvidenceSha256,
    }),
  ]));
  const exactInventoryResult = strongestResult(
    Object.values(exactInventorySets).map((set) => set.result),
  );

  let compatibilityResult = 'PASS';
  const compatibilityReasons = [];
  if (observation.telemetrySchemaCompatibility === 'INCOMPATIBLE') {
    compatibilityResult = 'FAIL';
    compatibilityReasons.push('TELEMETRY_SCHEMA_INCOMPATIBLE');
  } else if (observation.telemetrySchemaCompatibility === 'UNKNOWN') {
    compatibilityResult = 'UNKNOWN';
    compatibilityReasons.push('TELEMETRY_SCHEMA_COMPATIBILITY_UNKNOWN');
  }

  const denominator = manifest.expectedItems.filter((item) => item.required && item.enabled);
  const independentProbeRequired = denominator.some((item) => item.independentProbeRequired);
  const blackBoxReasons = [];
  let blackBoxResult = 'PASS';
  const blackBoxProbe = observation.lastIndependentBlackBoxProbe;
  if (independentProbeRequired && blackBoxProbe === null) {
    blackBoxReasons.push('BLACK_BOX_PROBE_MISSING');
    blackBoxResult = 'UNKNOWN';
  } else if (blackBoxProbe !== null) {
    if (blackBoxProbe.result === 'FAIL') {
      blackBoxReasons.push('BLACK_BOX_PROBE_FAILED');
      blackBoxResult = 'FAIL';
    } else if (blackBoxProbe.result === 'UNKNOWN') {
      blackBoxReasons.push('BLACK_BOX_PROBE_UNKNOWN');
      blackBoxResult = 'UNKNOWN';
    }
    if (blackBoxProbe.observedAtMs > nowMs) {
      blackBoxReasons.push('BLACK_BOX_PROBE_TIME_FROM_FUTURE');
      if (blackBoxResult !== 'FAIL') blackBoxResult = 'UNKNOWN';
    } else if (nowMs - blackBoxProbe.observedAtMs > manifest.observationMaximumAgeMs) {
      blackBoxReasons.push('BLACK_BOX_PROBE_EXPIRED');
      if (blackBoxResult !== 'FAIL') blackBoxResult = 'UNKNOWN';
    }
  }
  const coveredRequiredCount = denominator.filter((expected) => {
    const observed = observedById.get(expected.expectedId);
    return observed?.identityState === 'DISCOVERED' && observed.telemetryState === 'INSTRUMENTED';
  }).length;
  const idsFor = (predicate) => manifest.expectedItems
    .filter((expected) => predicate(expected, observedById.get(expected.expectedId)))
    .map((expected) => expected.expectedId)
    .sort(compareAscii);
  const unexpectedObservedIds = observation.items
    .filter((item) => !expectedById.has(item.expectedId))
    .map((item) => item.expectedId)
    .sort(compareAscii);
  const inventoryIntegrityResult = unexpectedObservedIds.length === 0 ? 'PASS' : 'FAIL';
  const inventoryIntegrityReasonCodes = unexpectedObservedIds.length === 0
    ? []
    : ['UNEXPECTED_OBSERVED_REPORTER'];
  const controls = manifest.expectedItems.filter((item) => item.kind === 'COMMAND_PATH');
  const controlCount = (state) => controls.filter((item) => observedById.get(item.expectedId)?.controlState === state).length;

  let overallResult;
  const denominatorResult = denominator.length === 0 ? 'UNKNOWN' : 'PASS';
  const denominatorReasonCodes = denominator.length === 0 ? ['EXPECTED_DENOMINATOR_EMPTY'] : [];
  if (bindingResult === 'FAIL') overallResult = 'FAIL';
  else if (bindingResult !== 'PASS' || denominatorResult !== 'PASS') overallResult = 'UNKNOWN';
  else overallResult = strongestResult([
    compatibilityResult,
    blackBoxResult,
    inventoryIntegrityResult,
    exactInventoryResult,
    ...blockingEvaluations.map((item) => item.result),
  ]);

  const output = {
    schemaVersion: 'release-bound-expected-manifest-evaluation.v1',
    evaluatedAtMs: nowMs,
    manifestId: manifest.manifestId,
    manifestRevision: manifest.manifestRevision,
    manifestSha256: manifest.manifestSha256,
    acceptedReleaseSha,
    evaluationEvidence: {
      ...evaluationEvidencePayload,
      evidenceSha256: evaluationEvidenceSha256,
    },
    canonicalManifestDigest: {
      result: canonicalManifestDigestResult,
      canonicalizationProfile: RELEASE_MANIFEST_DIGEST_PROFILE,
      claimedManifestSha256: manifest.manifestSha256,
      derivedManifestSha256,
      reasonCodes: canonicalManifestDigestResult === 'PASS' ? [] : ['MANIFEST_CANONICAL_DIGEST_MISMATCH'],
    },
    manifestReview: {
      result: manifestReviewResult,
      reviewerOwnerId: manifest.review.reviewerOwnerId,
      reviewEvidenceId: manifest.review.reviewEvidenceId,
      reviewedAtMs: manifest.review.reviewedAtMs,
      reasonCodes: manifestReviewResult === 'PASS' ? [] : ['MANIFEST_REVIEW_TIME_FROM_FUTURE'],
    },
    binding: {
      result: bindingResult,
      reasonCodes: sortedUniqueStrings(bindingReasons),
    },
    manifestDigestVerification: {
      result: digestResult,
      verificationMode: 'PACKET_LOCAL_CANONICAL_SHA256_WITH_EXTERNAL_OWNER_EVIDENCE',
      verifiedManifestSha256: digestEvidence.verifiedManifestSha256,
      verifiedMissionCoverageSha256: digestEvidence.verifiedMissionCoverageSha256,
      verifiedAuthorityRegistrySha256: digestEvidence.verifiedAuthorityRegistrySha256,
      verifiedComponentRegistrySha256: digestEvidence.verifiedComponentRegistrySha256,
      verifiedDeploymentTopologySha256: digestEvidence.verifiedDeploymentTopologySha256,
      verifierOwnerId: digestEvidence.verifierOwnerId,
      verifierReferenceId: digestEvidence.verifierReferenceId,
      verifiedAtMs: digestEvidence.verifiedAtMs,
      reasonCodes: sortedUniqueStrings(digestReasons),
    },
    independentBlackBoxProbe: {
      required: independentProbeRequired,
      result: blackBoxResult,
      reasonCodes: sortedUniqueStrings(blackBoxReasons),
    },
    telemetrySchemaCompatibility: {
      result: compatibilityResult,
      reasonCodes: compatibilityReasons,
    },
    denominator: {
      result: denominatorResult,
      reasonCodes: denominatorReasonCodes,
    },
    observedInventoryIntegrity: {
      result: inventoryIntegrityResult,
      reasonCodes: inventoryIntegrityReasonCodes,
    },
    exactInventory: {
      result: exactInventoryResult,
      reasonCodes: exactInventoryResult === 'PASS' ? [] : ['CANONICAL_RELEASE_INVENTORY_NOT_EXACT'],
    },
    ...exactInventorySets,
    overallResult,
    greenEligible: overallResult === 'PASS',
    liveGreenEligible: overallResult === 'PASS'
      && blockingEvaluations.every((item) => item.liveEligible),
    denominatorCount: denominator.length,
    observabilityCoveragePercent: roundedPercent(coveredRequiredCount, denominator.length),
    counts: {
      expected: manifest.expectedItems.length,
      requiredEnabled: denominator.length,
      discovered: idsFor((expected, observed) => observed?.identityState === 'DISCOVERED').length,
      instrumented: idsFor((expected, observed) => observed?.telemetryState === 'INSTRUMENTED').length,
      current: idsFor((expected, observed) => observed?.freshnessState === 'CURRENT').length,
      stale: idsFor((expected, observed) => observed?.freshnessState === 'STALE').length,
      silent: idsFor((expected, observed) => observed?.freshnessState === 'SILENT').length,
      unavailable: idsFor((expected, observed) => observed?.freshnessState === 'UNAVAILABLE' || observed?.lifecycleAuthority.truthLabel === 'UNAVAILABLE').length,
      missing: idsFor((expected, observed) => observed === undefined || observed.identityState === 'MISSING').length,
    },
    ids: {
      expected: manifest.expectedItems.map((item) => item.expectedId).sort(compareAscii),
      discovered: idsFor((expected, observed) => observed?.identityState === 'DISCOVERED'),
      instrumented: idsFor((expected, observed) => observed?.telemetryState === 'INSTRUMENTED'),
      current: idsFor((expected, observed) => observed?.freshnessState === 'CURRENT'),
      stale: idsFor((expected, observed) => observed?.freshnessState === 'STALE'),
      silent: idsFor((expected, observed) => observed?.freshnessState === 'SILENT'),
      unavailable: idsFor((expected, observed) => observed?.freshnessState === 'UNAVAILABLE' || observed?.lifecycleAuthority.truthLabel === 'UNAVAILABLE'),
      missing: idsFor((expected, observed) => observed === undefined || observed.identityState === 'MISSING'),
      unexpectedObserved: unexpectedObservedIds,
      unobservedCapitalCriticalDependencies: idsFor((expected, observed) => expected.capitalCritical
        && expected.required && expected.enabled
        && (observed === undefined || observed.identityState !== 'DISCOVERED' || observed.telemetryState !== 'INSTRUMENTED')),
    },
    controls: {
      expected: controls.length,
      live: controlCount('LIVE'),
      disabled: controlCount('DISABLED'),
      unimplemented: controlCount('UNIMPLEMENTED'),
      unknown: controlCount('UNKNOWN'),
    },
    lastCompleteCorrelationTrace: observation.lastCompleteCorrelationTrace === null
      ? null
      : { ...observation.lastCompleteCorrelationTrace },
    lastIndependentBlackBoxProbe: observation.lastIndependentBlackBoxProbe === null
      ? null
      : { ...observation.lastIndependentBlackBoxProbe },
    items: itemEvaluations,
  };
  return deepFreeze(output);
}
