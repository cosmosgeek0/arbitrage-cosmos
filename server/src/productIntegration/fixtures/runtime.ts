import type { ProductComponentEvidence } from '../contracts/index.js';
import {
  EDGE_PROTOCOL_SCHEMA_SHA256,
  type QAssessmentProtocolProjection,
  type QSchemaValidationReceipt,
} from '../adapters/index.js';
import { canonicalProductJson } from '../contracts/index.js';
import type { ProductOperatorEvent } from '../supervisor/index.js';

export const PRODUCT_FIXTURE_NOW_MS = 1_783_948_900_000;

type ComponentFixtureInput = Pick<ProductComponentEvidence, 'componentId' | 'ownerId' | 'ownerPath' | 'roles'>
  & Partial<Omit<ProductComponentEvidence, 'componentId' | 'ownerId' | 'ownerPath' | 'roles'>>;

export function createComponentFixture(input: ComponentFixtureInput): Readonly<ProductComponentEvidence> {
  return Object.freeze({
    componentId: input.componentId,
    ownerId: input.ownerId,
    ownerPath: input.ownerPath,
    desiredState: input.desiredState ?? 'RUNNING',
    observedLifecycle: input.observedLifecycle ?? 'READY',
    capability: input.capability ?? 'SYNTHETIC',
    authority: input.authority ?? 'SYNTHETIC_TEST',
    completeness: input.completeness ?? 'COMPLETE',
    roles: Object.freeze([...input.roles]),
    requiredDependencies: Object.freeze([...(input.requiredDependencies ?? [])]),
    optionalDependencies: Object.freeze([...(input.optionalDependencies ?? [])]),
    timing: Object.freeze(input.timing ?? {
      heartbeatAtMs: PRODUCT_FIXTURE_NOW_MS - 100,
      lastInputEventAtMs: PRODUCT_FIXTURE_NOW_MS - 200,
      lastReceiveAtMs: PRODUCT_FIXTURE_NOW_MS - 150,
      lastProcessedAtMs: PRODUCT_FIXTURE_NOW_MS - 100,
      lastMeaningfulAdvanceAtMs: PRODUCT_FIXTURE_NOW_MS - 100,
      heartbeatMaxAgeMs: 5_000,
      sourceMaxAgeMs: 5_000,
      processingMaxAgeMs: 5_000,
      meaningfulAdvanceMaxAgeMs: 5_000,
    }),
    queue: input.queue === undefined ? Object.freeze({
      depth: 0,
      capacity: 100,
      dropped: 0,
      coalesced: 0,
      backpressure: 'NONE' as const,
      observedAtMs: PRODUCT_FIXTURE_NOW_MS,
      maxAgeMs: 5_000,
    }) : input.queue === null ? null : Object.freeze({ ...input.queue }),
    blockerCodes: Object.freeze([...(input.blockerCodes ?? [])]),
    queueRequired: input.queueRequired ?? true,
    lastFailure: input.lastFailure ?? null,
    supportedCommandIds: Object.freeze([...(input.supportedCommandIds ?? ['component.start', 'component.pause', 'component.drain', 'component.stop', 'component.restart'])]),
    revisions: Object.freeze(input.revisions ?? { build: 'fixture-build-1', config: 'fixture-config-1', schema: 'fixture-schema-1', model: null }),
    restartGeneration: input.restartGeneration ?? 1,
    restartCount: input.restartCount ?? 0,
    capitalExposed: input.capitalExposed ?? false,
    operatorAttentionRequired: input.operatorAttentionRequired ?? false,
    tradeCritical: input.tradeCritical ?? false,
    requiredForProductReadiness: input.requiredForProductReadiness ?? true,
  });
}

export function createRuntimeComponentFixture(): readonly Readonly<ProductComponentEvidence>[] {
  const ledger = createComponentFixture({
    componentId: 'ledger-persistence', ownerId: 'existing-ledger', ownerPath: 'server/src/ledger.ts', roles: ['SHELL', 'PERSISTENCE'],
    timing: {
      heartbeatAtMs: PRODUCT_FIXTURE_NOW_MS - 50, lastInputEventAtMs: null, lastReceiveAtMs: null,
      lastProcessedAtMs: PRODUCT_FIXTURE_NOW_MS - 50, lastMeaningfulAdvanceAtMs: PRODUCT_FIXTURE_NOW_MS - 50,
      heartbeatMaxAgeMs: 5_000, sourceMaxAgeMs: null, processingMaxAgeMs: 5_000, meaningfulAdvanceMaxAgeMs: 5_000,
    }, supportedCommandIds: ['component.start', 'component.stop', 'component.restart', 'ledger.checkpoint'],
  });
  const spot = createComponentFixture({
    componentId: 'spot-public-source', ownerId: 'intelligence-runtime', ownerPath: 'server/src/intelligenceRuntime/**', roles: ['SOURCE'],
    requiredDependencies: ['ledger-persistence'], capability: 'SYNTHETIC', authority: 'SYNTHETIC_TEST',
  });
  const q = createComponentFixture({
    componentId: 'q-inference', ownerId: 'q-lane', ownerPath: 'quant/** (accepted runtime adapter unavailable)', roles: ['ANALYTICAL'],
    requiredDependencies: ['spot-public-source'], observedLifecycle: 'DEGRADED', capability: 'UNAVAILABLE', authority: 'UNAVAILABLE', completeness: 'UNAVAILABLE',
    timing: {
      heartbeatAtMs: null, lastInputEventAtMs: null, lastReceiveAtMs: null, lastProcessedAtMs: null, lastMeaningfulAdvanceAtMs: null,
      heartbeatMaxAgeMs: 5_000, sourceMaxAgeMs: 5_000, processingMaxAgeMs: 5_000, meaningfulAdvanceMaxAgeMs: 5_000,
    },
    blockerCodes: ['Q_RUNTIME_NOT_ACCEPTED'], supportedCommandIds: [], revisions: { build: null, config: null, schema: 'edge-protocol-v1', model: null }, requiredForProductReadiness: false,
  });
  const basis = createComponentFixture({
    componentId: 'basis-engine', ownerId: 'basis-engine', ownerPath: 'server/src/engine/basis/**', roles: ['ANALYTICAL', 'OPPORTUNITY', 'INTAKE'],
    requiredDependencies: ['spot-public-source'], optionalDependencies: ['q-inference'], capability: 'DRY_RUN', authority: 'SYNTHETIC_TEST',
  });
  const volume = createComponentFixture({
    componentId: 'volume-engine', ownerId: 'volume-engine', ownerPath: 'server/src/engine/volume/**', roles: ['ANALYTICAL', 'OPPORTUNITY', 'INTAKE'],
    requiredDependencies: ['spot-public-source'], optionalDependencies: ['q-inference'], capability: 'SYNTHETIC', authority: 'SYNTHETIC_TEST',
  });
  const capital = createComponentFixture({
    componentId: 'capital-supervision', ownerId: 'capital-foundation', ownerPath: 'server/src/capitalFoundation/**', roles: ['CAPITAL'],
    requiredDependencies: ['basis-engine'], capability: 'DRY_RUN', tradeCritical: true,
  });
  const risk = createComponentFixture({
    componentId: 'risk-gate', ownerId: 'foundation-risk', ownerPath: 'server/src/foundation/risk/**', roles: ['RISK'],
    requiredDependencies: ['capital-supervision'], capability: 'DRY_RUN', tradeCritical: true,
  });
  const execution = createComponentFixture({
    componentId: 'execution-hand', ownerId: 'foundation-execution', ownerPath: 'server/src/foundation/execution/**', roles: ['EXECUTION', 'INTAKE'],
    requiredDependencies: ['risk-gate'], capability: 'DRY_RUN', tradeCritical: true,
  });
  const reconciliation = createComponentFixture({
    componentId: 'reconciliation', ownerId: 'foundation-reconciliation', ownerPath: 'server/src/foundation/reconciliation/**', roles: ['RECONCILIATION'],
    requiredDependencies: ['ledger-persistence'], capability: 'DRY_RUN',
    supportedCommandIds: ['component.start', 'component.stop', 'component.restart', 'component.reconcile'],
  });
  const recovery = createComponentFixture({
    componentId: 'recovery', ownerId: 'foundation-execution', ownerPath: 'server/src/foundation/execution/recovery.ts', roles: ['RECOVERY'],
    requiredDependencies: ['ledger-persistence', 'reconciliation'], capability: 'DRY_RUN',
  });
  const supervisor = createComponentFixture({
    componentId: 'machine-supervisor', ownerId: 'system-integration', ownerPath: 'server/src/systemIntegration/supervisor/**', roles: ['SHELL', 'COCKPIT'],
    requiredDependencies: ['ledger-persistence'], optionalDependencies: ['spot-public-source', 'q-inference', 'basis-engine', 'capital-supervision', 'risk-gate', 'execution-hand', 'reconciliation', 'recovery'],
  });
  return Object.freeze([ledger, spot, q, basis, volume, capital, risk, execution, reconciliation, recovery, supervisor]);
}

export const Q_ABSTAIN_ASSESSMENT_FIXTURE: Readonly<QAssessmentProtocolProjection> = Object.freeze({
  revision: 0,
  assessmentId: 'as_0001',
  traceId: 'tr_0001',
  strategyFamily: 'BASIS_CONVERGENCE',
  hypothesisId: 'hyp_basis_v1',
  symbol: 'ABCUSDT',
  parentEvidenceIds: Object.freeze(['ev_0001']),
  eventTimeMs: 1_783_948_800_000,
  receiveTimeMs: 1_783_948_800_120,
  generationTimeMs: 1_783_948_801_000,
  expiryTimeMs: 1_783_948_861_000,
  predictionTargets: Object.freeze(['fwd_return_60s']),
  uncertainty: Object.freeze({ epistemic: 'HIGH', model: 'MEDIUM', data: 'HIGH' }),
  oodState: 'UNKNOWN',
  driftState: 'UNKNOWN',
  advisoryAction: 'ABSTAIN_UNKNOWN',
  abstentionReasonCodes: Object.freeze(['BORROW_TRUTH_MISSING', 'DEPTH_EVIDENCE_INSUFFICIENT']),
  sourceQuality: Object.freeze({ freshness: 'FRESH', completeness: 'PARTIAL', gapCount: 1, duplicate: false, reconstructed: false }),
  lineage: Object.freeze({ datasetVersion: 'ds_v1', featureVersion: 'ft_v1', labelVersion: 'lb_v1', modelVersion: 'md_v1', calibrationVersion: 'cal_v1' }),
  configVersion: null,
  economicAssumptionState: 'HYPOTHETICAL',
  economicAssumptionExpiresAtMs: 1_783_948_860_500,
  missingEconomicFields: Object.freeze(['funding.rate', 'borrow']),
});

export const Q_ABSTAIN_VALIDATION_RECEIPT: Readonly<QSchemaValidationReceipt> = Object.freeze({
  schema: 'EdgeAssessmentEnvelopeV1',
  version: 1,
  schemaSha256: EDGE_PROTOCOL_SCHEMA_SHA256,
  envelopeHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  envelopeId: 'as_0001',
  byteLength: 4_096,
  accepted: true,
  issueCodes: Object.freeze([]),
  validatedProjectionJson: canonicalProductJson(Q_ABSTAIN_ASSESSMENT_FIXTURE),
});

export const OPERATOR_EVENT_FIXTURE: readonly Readonly<ProductOperatorEvent>[] = Object.freeze([
  Object.freeze({ cursor: 41, eventId: 'event-41', occurredAtMs: PRODUCT_FIXTURE_NOW_MS - 1_000, persistedAtMs: PRODUCT_FIXTURE_NOW_MS - 900, componentId: 'spot-public-source', correlationId: 'trace-1', material: true, payload: Object.freeze({ state: 'READY' }) }),
  Object.freeze({ cursor: 42, eventId: 'event-42', occurredAtMs: PRODUCT_FIXTURE_NOW_MS - 1_000, persistedAtMs: PRODUCT_FIXTURE_NOW_MS - 800, componentId: 'basis-engine', correlationId: 'trace-1', material: true, payload: Object.freeze({ verdict: 'REJECTED' }) }),
  Object.freeze({ cursor: 43, eventId: 'event-43', occurredAtMs: PRODUCT_FIXTURE_NOW_MS - 1_000, persistedAtMs: PRODUCT_FIXTURE_NOW_MS - 700, componentId: 'risk-gate', correlationId: 'trace-1', material: true, payload: Object.freeze({ verdict: 'UNAVAILABLE' }) }),
]);
