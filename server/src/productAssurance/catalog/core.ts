import type {
  ExpectedComponent,
  ExpectedControl,
  ExpectedDependency,
  ExpectedInventoryManifest,
  ExpectedTelemetrySignal,
} from '../inventory/coverage.js';
import type {
  SafetyInvariantDefinition,
} from '../invariants/evaluator.js';
import type {
  OperationClass,
  OperationPolicy,
  OperationPriority,
  OperationWiringState,
} from '../operations/policy.js';
import type { AssuranceSeverity } from '../common.js';

/**
 * Canonical packet-local data only. This module intentionally does not import
 * quant, live-edge, sibling IP, process, filesystem, network, or clock owners.
 * Accepted donor paths and commits below are inert provenance metadata.
 */

export type AcceptedInterfaceStatus =
  | 'FROZEN_BASE'
  | 'ACCEPTED_ADVISORY_ONLY'
  | 'ACCEPTED_PARTIAL_FRONTIER'
  | 'ACCEPTED_PACKET_TIP';

export interface AcceptedImmutableInterfaceMetadata {
  readonly interfaceId: string;
  readonly authorityId: string;
  readonly acceptedCommit: string;
  readonly status: AcceptedInterfaceStatus;
  readonly protocolRevision: string;
  readonly schemaRevision: string;
  readonly sourcePaths: readonly string[];
  readonly receiptPaths: readonly string[];
  readonly consumptionLaw: string;
}

export interface OwnerQuestionCoverageEntry {
  readonly questionId: string;
  readonly sourceSection: 'I00_SECTION_3' | 'I00_FINAL_NO_SURPRISES';
  readonly question: string;
  readonly canonicalOwnerId: string;
  readonly evidenceIds: readonly string[];
  readonly metricId: string;
  readonly structuredLogId: string;
  readonly materialEventId: string;
  readonly traceId: string;
  readonly incidentId: string;
  readonly freshnessMs: number;
  readonly hysteresisMs: number;
  readonly missingDataLaw: 'UNKNOWN_BLOCKS_GREEN';
  readonly severity: AssuranceSeverity;
  readonly cockpitSurface: string;
  readonly repairControlId: string | null;
  readonly fixtureId: string;
  readonly proofId: string;
}

interface OperationPolicySeed {
  readonly operationId: string;
  readonly operationClass: OperationClass;
  readonly canonicalOwnerId: string;
  readonly implementationPaths: readonly string[];
  readonly wiringState: OperationWiringState;
  readonly deadlineMs: number;
  readonly maximumAttempts?: number;
  readonly transientErrorCodes?: readonly string[];
  readonly permanentErrorCodes?: readonly string[];
  readonly ambiguousErrorCodes?: readonly string[];
  readonly backoff?: OperationPolicy['backoff'];
  readonly priority?: OperationPriority;
  readonly reserveUnits?: number;
  readonly cooldownBehavior?: OperationPolicy['rateBudget']['cooldownBehavior'];
  readonly idempotency?: OperationPolicy['idempotency'];
  readonly authoritativeReconciliationLookup?: string | null;
  readonly circuit?: OperationPolicy['circuit'];
  readonly concurrencyLimit?: number;
  readonly cancellation?: OperationPolicy['cancellation'];
  readonly controlLoop?: OperationPolicy['controlLoop'];
  readonly costResourceEvidence?: OperationPolicy['costResourceEvidence'];
  readonly poisonEventQuarantine?: boolean;
  readonly fallbackEligibility?: OperationPolicy['fallbackEligibility'];
  readonly degradedResult: string;
  readonly blockedResult: string;
  readonly durableRestartCheckpoint?: string | null;
  readonly automaticRemediationAllowed?: boolean;
  readonly escalationControlId: string;
  readonly runbookId: string;
  readonly cockpitLocation: string;
  readonly faultTestIds: readonly string[];
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function operationPolicy(seed: Readonly<OperationPolicySeed>): Readonly<OperationPolicy> {
  const operationId = seed.operationId;
  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_OPERATION_POLICY_V1',
    revision: 1,
    operationId,
    operationClass: seed.operationClass,
    canonicalOwnerId: seed.canonicalOwnerId,
    implementationPaths: freezeStrings(seed.implementationPaths),
    wiringState: seed.wiringState,
    deadlineMs: seed.deadlineMs,
    transientErrorCodes: freezeStrings(seed.transientErrorCodes ?? ['TIMEOUT', 'UPSTREAM_UNAVAILABLE']),
    permanentErrorCodes: freezeStrings(seed.permanentErrorCodes ?? ['INVALID_REQUEST', 'AUTHORIZATION_DENIED']),
    ambiguousErrorCodes: freezeStrings(seed.ambiguousErrorCodes ?? ['UNKNOWN_SUBMISSION']),
    maximumAttempts: seed.maximumAttempts ?? 3,
    backoff: Object.freeze(seed.backoff ?? {
      baseDelayMs: 100,
      maximumDelayMs: 1_000,
      jitterRatio: 0.2,
      totalRetryBudgetMs: 2_500,
    }),
    rateBudget: Object.freeze({
      priority: seed.priority ?? 'NORMAL',
      reserveUnits: seed.reserveUnits ?? 0,
      cooldownBehavior: seed.cooldownBehavior ?? 'HONOR_OWNER_COOLDOWN',
    }),
    idempotency: Object.freeze(seed.idempotency ?? {
      required: false,
      identityField: null,
      lifetimeMs: null,
      durability: 'NOT_APPLICABLE',
    }),
    authoritativeReconciliationLookup: seed.authoritativeReconciliationLookup ?? null,
    circuit: Object.freeze(seed.circuit ?? {
      failureThreshold: 3,
      resetAfterMs: 30_000,
      halfOpenMaximumProbes: 1,
      healthyQuietWindowMs: 30_000,
    }),
    concurrencyLimit: seed.concurrencyLimit ?? 4,
    cancellation: Object.freeze(seed.cancellation ?? {
      mode: 'COOPERATIVE_ABORT',
      lateCompletionLaw: 'QUARANTINE',
      maximumCancellationWaitMs: seed.deadlineMs,
      cancellationEvidenceId: `${operationId}.cancellation`,
    }),
    controlLoop: Object.freeze(seed.controlLoop ?? {
      maximumConsecutiveRepairs: 1,
      maximumAmplificationFactor: 1,
      alternatingFingerprintWindowMs: 60_000,
      cooldownMs: 30_000,
    }),
    costResourceEvidence: Object.freeze(seed.costResourceEvidence ?? {
      required: false,
      budgetOwnerId: seed.canonicalOwnerId,
      metricId: `${operationId}.resource`,
      missingBehavior: 'NOT_APPLICABLE',
    }),
    poisonEventQuarantine: seed.poisonEventQuarantine ?? false,
    fallbackEligibility: seed.fallbackEligibility ?? 'NONE',
    degradedResult: seed.degradedResult,
    blockedResult: seed.blockedResult,
    durableRestartCheckpoint: seed.durableRestartCheckpoint ?? null,
    automaticRemediationAllowed: seed.automaticRemediationAllowed ?? false,
    escalationControlId: seed.escalationControlId,
    runbookId: seed.runbookId,
    metricId: `${operationId}.attempts`,
    traceId: `${operationId}.trace`,
    materialEventId: `${operationId}.material_event`,
    incidentId: `${operationId}.incident`,
    cockpitLocation: seed.cockpitLocation,
    faultTestIds: freezeStrings(seed.faultTestIds),
  });
}

export const ACCEPTED_IMMUTABLE_INTERFACE_METADATA: readonly Readonly<AcceptedImmutableInterfaceMetadata>[] = Object.freeze([
  Object.freeze({
    interfaceId: 'ASSURANCE_FROZEN_BASE',
    authorityId: 'CURRENT_MAIN_ACCEPTED_BASE',
    acceptedCommit: '9785c93102b00389847b77c2f9348c06abc4344b',
    status: 'FROZEN_BASE',
    protocolRevision: 'EDGE_PROTOCOL_V1',
    schemaRevision: 'SYSTEM_INTEGRATION_CONTRACTS_V1',
    sourcePaths: freezeStrings(['ARCHITECTURE.md', 'server/src/systemIntegration/contracts/constants.ts']),
    receiptPaths: freezeStrings(['docs/archive/SYSTEM_CONVERGENCE_RECEIPT.md']),
    consumptionLaw: 'Read canonical owners; never create a fourteenth supervisor component.',
  }),
  Object.freeze({
    interfaceId: 'Q_ACCEPTED_ADVISORY_INTERFACE',
    authorityId: 'Q_LANE',
    acceptedCommit: '02b4eccc8d2ef53b830cafae06e5175715fa6ebb',
    status: 'ACCEPTED_ADVISORY_ONLY',
    protocolRevision: 'EDGE_PROTOCOL_V1',
    schemaRevision: '229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c',
    sourcePaths: freezeStrings(['EDGE_PROTOCOL_V1.md', 'quant/RECEIPTS/Q17_ACCEPTANCE.md']),
    receiptPaths: freezeStrings(['quant/RECEIPTS/Q17.md', 'quant/RECEIPTS/Q17_ACCEPTANCE.md']),
    consumptionLaw: 'Metadata and accepted read contracts only; Q stays advisory and abstention preserves UNKNOWN.',
  }),
  Object.freeze({
    interfaceId: 'L_ACCEPTED_FRONTIER_INTERFACE',
    authorityId: 'L_LANE',
    acceptedCommit: 'c86c41d64b92a5c0399dabfdb3fa81816bd03d45',
    status: 'ACCEPTED_PARTIAL_FRONTIER',
    protocolRevision: 'EDGE_PROTOCOL_V1',
    schemaRevision: 'L08_2_L10_L14_ACCEPTED_FRONTIER',
    sourcePaths: freezeStrings(['EDGE_PROTOCOL_V1.md', 'live-edge-receipts/RECEIPTS/L08.2.md', 'live-edge-receipts/RECEIPTS/L10_ACCEPTANCE.md', 'live-edge-receipts/RECEIPTS/L14_ACCEPTANCE.md']),
    receiptPaths: freezeStrings(['live-edge-receipts/RECEIPTS/L08.2.md', 'live-edge-receipts/RECEIPTS/L10_ACCEPTANCE.md', 'live-edge-receipts/RECEIPTS/L14_ACCEPTANCE.md']),
    consumptionLaw: 'Consume accepted frontier metadata only; do not imply LANE_READY or consume active L09/L11 work.',
  }),
  Object.freeze({
    interfaceId: 'IP_RUNTIME_ACCEPTED_INTERFACE',
    authorityId: 'IP_RUNTIME',
    acceptedCommit: '8058ab8febb639839333d4e2c604068a0c7390ea',
    status: 'ACCEPTED_PACKET_TIP',
    protocolRevision: 'IP_RUNTIME_PACKET_V1',
    schemaRevision: 'IP_RUNTIME_ACCEPTED_AT_COMMIT',
    sourcePaths: freezeStrings(['IP_RUNTIME_STATE.md']),
    receiptPaths: freezeStrings(['IP_RUNTIME_RECEIPT.md']),
    consumptionLaw: 'Consume immutable public runtime interfaces without importing sibling packet implementation.',
  }),
  Object.freeze({
    interfaceId: 'IP_CONTROL_ACCEPTED_INTERFACE',
    authorityId: 'IP_CONTROL',
    acceptedCommit: '56c47dad398c485b6653036c8b90c53f11061b1e',
    status: 'ACCEPTED_PACKET_TIP',
    protocolRevision: 'IP_CONTROL_PACKET_V1',
    schemaRevision: 'IP_CONTROL_ACCEPTED_AT_COMMIT',
    sourcePaths: freezeStrings(['IP_CONTROL_STATE.md']),
    receiptPaths: freezeStrings(['IP_CONTROL_RECEIPT.md']),
    consumptionLaw: 'Return render-neutral contracts and insertion notes; do not mount or duplicate the cockpit.',
  }),
  Object.freeze({
    interfaceId: 'IP_OPS_ACCEPTED_INTERFACE',
    authorityId: 'IP_OPS',
    acceptedCommit: '6bfd543afb693ea18f4baf08e962e6d698f140fb',
    status: 'ACCEPTED_PACKET_TIP',
    protocolRevision: 'IP_OPS_PACKET_V1',
    schemaRevision: 'IP_OPS_ACCEPTED_AT_COMMIT',
    sourcePaths: freezeStrings(['IP_OPS_STATE.md']),
    receiptPaths: freezeStrings(['IP_OPS_RECEIPT.md']),
    consumptionLaw: 'Deployment remains owner-approved and artifact-only; this packet performs no external mutation.',
  }),
  Object.freeze({
    interfaceId: 'IP_PROOF_ACCEPTED_INTERFACE',
    authorityId: 'IP_PROOF',
    acceptedCommit: '23e985c17b9b860fee26be397fa05b26f3daf8f2',
    status: 'ACCEPTED_PACKET_TIP',
    protocolRevision: 'IP_PROOF_PACKET_V1',
    schemaRevision: 'IP_PROOF_ACCEPTED_AT_COMMIT',
    sourcePaths: freezeStrings(['IP_PROOF_STATE.md']),
    receiptPaths: freezeStrings(['IP_PROOF_RECEIPT.md']),
    consumptionLaw: 'Supply deterministic fixture contracts and exact insertion rows; IP-PROOF owns shared campaign execution.',
  }),
]);

export const OPERATION_POLICY_REGISTRY: readonly Readonly<OperationPolicy>[] = Object.freeze([
  operationPolicy({
    operationId: 'OP_PUBLIC_HTTP_READ',
    operationClass: 'PURE_READ',
    canonicalOwnerId: 'INTELLIGENCE_RUNTIME',
    implementationPaths: ['server/src/binance/rest.ts', 'server/src/binance/icons.ts', 'server/src/binance/profile.ts', 'server/src/binance/moneyflow.ts', 'server/src/index.ts', 'server/src/services/newsContext.ts', 'server/src/intelligenceRuntime/**'],
    wiringState: 'WIRED',
    deadlineMs: 5_000,
    transientErrorCodes: ['TIMEOUT', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE'],
    permanentErrorCodes: ['INVALID_RESPONSE', 'AUTHORIZATION_DENIED'],
    ambiguousErrorCodes: [],
    maximumAttempts: 3,
    priority: 'NORMAL',
    fallbackEligibility: 'ACCEPTED_OWNER_ONLY',
    degradedResult: 'PUBLIC_FACT_UNAVAILABLE',
    blockedResult: 'PUBLIC_SOURCE_BLOCKED',
    automaticRemediationAllowed: true,
    escalationControlId: 'CONTROL_PUBLIC_SOURCE_RESTART',
    runbookId: 'RUNBOOK_PUBLIC_HTTP_DEGRADATION',
    cockpitLocation: 'health.sources.public_http',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'IGNORE_READ_ONLY',
      maximumCancellationWaitMs: 1_000, cancellationEvidenceId: 'OP_PUBLIC_HTTP_READ.cancellation',
    },
    controlLoop: {
      maximumConsecutiveRepairs: 3, maximumAmplificationFactor: 1,
      alternatingFingerprintWindowMs: 120_000, cooldownMs: 30_000,
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'INTELLIGENCE_RUNTIME',
      metricId: 'OP_PUBLIC_HTTP_READ.rate_budget', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_HTTP_TIMEOUT', 'FAULT_THROTTLE_COOLDOWN'],
  }),
  operationPolicy({
    operationId: 'OP_PUBLIC_WEBSOCKET_STREAM',
    operationClass: 'REPLAYABLE_SUBSCRIPTION',
    canonicalOwnerId: 'INTELLIGENCE_RUNTIME',
    implementationPaths: ['server/src/binance/ws.ts', 'server/src/binance/liquidations.ts', 'server/src/intelligenceRuntime/**'],
    wiringState: 'WIRED',
    deadlineMs: 30_000,
    transientErrorCodes: ['TIMEOUT', 'PING_TIMEOUT', 'SERVER_SHUTDOWN', 'CONNECTION_ROTATION'],
    permanentErrorCodes: ['STREAM_SCHEMA_INCOMPATIBLE', 'AUTHORIZATION_DENIED'],
    ambiguousErrorCodes: ['SEQUENCE_CONTINUITY_UNKNOWN'],
    maximumAttempts: 8,
    backoff: { baseDelayMs: 250, maximumDelayMs: 15_000, jitterRatio: 0.35, totalRetryBudgetMs: 90_000 },
    idempotency: { required: true, identityField: 'subscriptionIdentity', lifetimeMs: 86_400_000, durability: 'DURABLE' },
    authoritativeReconciliationLookup: 'SOURCE_SEQUENCE_AND_SNAPSHOT',
    concurrencyLimit: 16,
    poisonEventQuarantine: true,
    fallbackEligibility: 'ACCEPTED_OWNER_ONLY',
    degradedResult: 'STREAM_STALE_OR_GAPPED',
    blockedResult: 'STREAM_UNAVAILABLE',
    durableRestartCheckpoint: 'SOURCE_SEQUENCE_CHECKPOINT',
    automaticRemediationAllowed: true,
    escalationControlId: 'CONTROL_PUBLIC_STREAM_RESTART',
    runbookId: 'RUNBOOK_STREAM_ROTATION_AND_RESNAPSHOT',
    cockpitLocation: 'health.sources.websocket',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'QUARANTINE',
      maximumCancellationWaitMs: 5_000, cancellationEvidenceId: 'OP_PUBLIC_WEBSOCKET_STREAM.cancellation',
    },
    controlLoop: {
      maximumConsecutiveRepairs: 5, maximumAmplificationFactor: 1,
      alternatingFingerprintWindowMs: 300_000, cooldownMs: 60_000,
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'INTELLIGENCE_RUNTIME',
      metricId: 'OP_PUBLIC_WEBSOCKET_STREAM.connection_budget', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_STREAM_ROTATION', 'FAULT_RECONNECT_STORM', 'FAULT_SEQUENCE_GAP'],
  }),
  operationPolicy({
    operationId: 'OP_RUNTIME_IN_MEMORY_QUEUE',
    operationClass: 'IDEMPOTENT_COMMAND',
    canonicalOwnerId: 'INTELLIGENCE_RUNTIME',
    implementationPaths: ['server/src/intelligenceRuntime/**', 'server/src/binance/icons.ts', 'server/src/foundation/replay/capture.ts'],
    wiringState: 'WIRED',
    deadlineMs: 2_000,
    transientErrorCodes: ['QUEUE_BACKPRESSURE', 'CONSUMER_UNAVAILABLE'],
    permanentErrorCodes: ['POISON_EVENT', 'EVENT_SCHEMA_INVALID'],
    ambiguousErrorCodes: [],
    idempotency: { required: true, identityField: 'eventIdentity', lifetimeMs: 300_000, durability: 'PROCESS_LOCAL' },
    authoritativeReconciliationLookup: 'QUEUE_ACK_AND_SEQUENCE_CHECKPOINT',
    concurrencyLimit: 8,
    poisonEventQuarantine: true,
    degradedResult: 'QUEUE_SHEDDING_OPTIONAL_WORK',
    blockedResult: 'CAPITAL_CRITICAL_QUEUE_BLOCKED',
    durableRestartCheckpoint: 'QUEUE_SEQUENCE_CHECKPOINT',
    automaticRemediationAllowed: true,
    escalationControlId: 'CONTROL_QUEUE_DRAIN',
    runbookId: 'RUNBOOK_QUEUE_BACKPRESSURE',
    cockpitLocation: 'health.runtime.queues',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'QUARANTINE',
      maximumCancellationWaitMs: 2_000, cancellationEvidenceId: 'OP_RUNTIME_IN_MEMORY_QUEUE.cancellation',
    },
    controlLoop: {
      maximumConsecutiveRepairs: 3, maximumAmplificationFactor: 1,
      alternatingFingerprintWindowMs: 120_000, cooldownMs: 30_000,
    },
    faultTestIds: ['FAULT_QUEUE_DUPLICATE', 'FAULT_QUEUE_REORDER', 'FAULT_QUEUE_POISON'],
  }),
  operationPolicy({
    operationId: 'OP_LEDGER_SQLITE',
    operationClass: 'IDEMPOTENT_COMMAND',
    canonicalOwnerId: 'EXISTING_LEDGER',
    implementationPaths: ['server/src/ledger.ts'],
    wiringState: 'WIRED',
    deadlineMs: 5_000,
    transientErrorCodes: ['DATABASE_BUSY', 'DATABASE_LOCKED', 'IO_TRANSIENT'],
    permanentErrorCodes: ['DATABASE_CORRUPT', 'SCHEMA_INCOMPATIBLE', 'DISK_FULL'],
    ambiguousErrorCodes: ['COMMIT_STATE_UNKNOWN'],
    maximumAttempts: 3,
    priority: 'RECONCILIATION',
    reserveUnits: 1,
    idempotency: { required: true, identityField: 'materialEventId', lifetimeMs: 31_536_000_000, durability: 'DURABLE' },
    authoritativeReconciliationLookup: 'LEDGER_MATERIAL_EVENT_ID_LOOKUP',
    concurrencyLimit: 1,
    poisonEventQuarantine: true,
    degradedResult: 'PERSISTENCE_DEGRADED_NEW_EXPOSURE_BLOCKED',
    blockedResult: 'PERSISTENCE_UNAVAILABLE',
    durableRestartCheckpoint: 'EXISTING_LEDGER_CHECKPOINT',
    escalationControlId: 'CONTROL_INTAKE_PAUSE',
    runbookId: 'RUNBOOK_LEDGER_RECOVERY',
    cockpitLocation: 'logs.ledger.persistence',
    cancellation: {
      mode: 'DEADLINE_ONLY', lateCompletionLaw: 'RECONCILE_BEFORE_RETRY',
      maximumCancellationWaitMs: 5_000, cancellationEvidenceId: 'OP_LEDGER_SQLITE.cancellation',
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'EXISTING_LEDGER',
      metricId: 'OP_LEDGER_SQLITE.storage_budget', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_DB_BEFORE_MUTATION', 'FAULT_DB_AFTER_MUTATION', 'FAULT_DISK_FULL'],
  }),
  operationPolicy({
    operationId: 'OP_AWS_RUNNER_CONTROL',
    operationClass: 'IDEMPOTENT_COMMAND',
    canonicalOwnerId: 'IP_OPS_DEPLOYMENT_OWNER',
    implementationPaths: ['server/src/services/awsRunnerControl.ts'],
    wiringState: 'NOT_CONFIGURED',
    deadlineMs: 15_000,
    transientErrorCodes: ['TIMEOUT', 'THROTTLED', 'SERVICE_UNAVAILABLE'],
    permanentErrorCodes: ['AUTHORIZATION_DENIED', 'TARGET_NOT_ALLOWED', 'INVALID_REQUEST'],
    ambiguousErrorCodes: ['CONTROL_RESULT_UNKNOWN'],
    maximumAttempts: 2,
    priority: 'NORMAL',
    cooldownBehavior: 'HONOR_OWNER_COOLDOWN',
    idempotency: { required: true, identityField: 'ownerApprovedRequestId', lifetimeMs: 86_400_000, durability: 'DURABLE' },
    authoritativeReconciliationLookup: 'AWS_OWNER_READBACK',
    concurrencyLimit: 1,
    degradedResult: 'DEPLOYMENT_CONTROL_UNAVAILABLE',
    blockedResult: 'OWNER_APPROVAL_OR_CONFIGURATION_MISSING',
    durableRestartCheckpoint: 'OWNER_CONTROL_RECEIPT',
    escalationControlId: 'OWNER_APPROVED_DEPLOYMENT_HANDOFF',
    runbookId: 'RUNBOOK_AWS_RUNNER_CONTROL',
    cockpitLocation: 'health.deployment.aws_runner',
    cancellation: {
      mode: 'DEADLINE_ONLY', lateCompletionLaw: 'RECONCILE_BEFORE_RETRY',
      maximumCancellationWaitMs: 15_000, cancellationEvidenceId: 'OP_AWS_RUNNER_CONTROL.cancellation',
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'IP_OPS_DEPLOYMENT_OWNER',
      metricId: 'OP_AWS_RUNNER_CONTROL.cloud_budget', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_AWS_PERMISSION', 'FAULT_AWS_CONTROL_RESPONSE_LOST'],
  }),
  operationPolicy({
    operationId: 'OP_SYSTEM_INTEGRATION_COMMAND',
    operationClass: 'IDEMPOTENT_COMMAND',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    implementationPaths: ['server/src/systemIntegration/**'],
    wiringState: 'WIRED',
    deadlineMs: 5_000,
    transientErrorCodes: ['CONTROL_BUSY', 'PERSISTENCE_TEMPORARILY_UNAVAILABLE'],
    permanentErrorCodes: ['CONTROL_REJECTED', 'REVISION_CONFLICT', 'AUTHORIZATION_DENIED'],
    ambiguousErrorCodes: ['CONTROL_COMMIT_UNKNOWN'],
    maximumAttempts: 1,
    priority: 'RISK_REDUCING',
    reserveUnits: 2,
    cooldownBehavior: 'NO_RETRY',
    idempotency: { required: true, identityField: 'requestDigest', lifetimeMs: 86_400_000, durability: 'DURABLE' },
    authoritativeReconciliationLookup: 'CONTROL_RECEIPT_AND_CHECKPOINT_LOOKUP',
    concurrencyLimit: 1,
    degradedResult: 'CONTROL_REJECTED_WITH_RECEIPT',
    blockedResult: 'CONTROL_AUTHORITY_UNAVAILABLE',
    durableRestartCheckpoint: 'SYSTEM_CONTROL_CHECKPOINT',
    escalationControlId: 'OWNER_CONTROL_REVIEW',
    runbookId: 'RUNBOOK_SYSTEM_CONTROL',
    cockpitLocation: 'health.controls.receipts',
    cancellation: {
      mode: 'DEADLINE_ONLY', lateCompletionLaw: 'RECONCILE_BEFORE_RETRY',
      maximumCancellationWaitMs: 5_000, cancellationEvidenceId: 'OP_SYSTEM_INTEGRATION_COMMAND.cancellation',
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'SYSTEM_INTEGRATION',
      metricId: 'OP_SYSTEM_INTEGRATION_COMMAND.command_budget', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_CONTROL_RESPONSE_LOST', 'FAULT_CONTROL_REVISION_CONFLICT'],
  }),
  operationPolicy({
    operationId: 'OP_HTTP_SERVER_SURFACE',
    operationClass: 'PURE_READ',
    canonicalOwnerId: 'AUDITED_APP',
    implementationPaths: ['server/src/index.ts', 'server/src/systemIntegration/routes/**'],
    wiringState: 'WIRED',
    deadlineMs: 10_000,
    transientErrorCodes: ['CLIENT_DISCONNECTED', 'SERVER_OVERLOADED'],
    permanentErrorCodes: ['REQUEST_SCHEMA_INVALID', 'AUTHORIZATION_DENIED'],
    ambiguousErrorCodes: [],
    maximumAttempts: 1,
    cooldownBehavior: 'NOT_APPLICABLE',
    degradedResult: 'HTTP_READ_UNAVAILABLE',
    blockedResult: 'HTTP_SURFACE_BLOCKED',
    escalationControlId: 'OWNER_HTTP_DIAGNOSTIC',
    runbookId: 'RUNBOOK_HTTP_SURFACE',
    cockpitLocation: 'health.api',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'IGNORE_READ_ONLY',
      maximumCancellationWaitMs: 1_000, cancellationEvidenceId: 'OP_HTTP_SERVER_SURFACE.cancellation',
    },
    faultTestIds: ['FAULT_DASHBOARD_DISCONNECT', 'FAULT_HTTP_OVERLOAD'],
  }),
  operationPolicy({
    operationId: 'OP_OUTBOUND_WEBSOCKET_FANOUT',
    operationClass: 'IDEMPOTENT_COMMAND',
    canonicalOwnerId: 'AUDITED_APP',
    implementationPaths: ['server/src/index.ts', 'server/src/services/bookStream.ts'],
    wiringState: 'WIRED',
    deadlineMs: 2_000,
    transientErrorCodes: ['CLIENT_BACKPRESSURE', 'CLIENT_DISCONNECTED'],
    permanentErrorCodes: ['MESSAGE_SCHEMA_INVALID'],
    ambiguousErrorCodes: [],
    maximumAttempts: 1,
    idempotency: { required: true, identityField: 'messageCursor', lifetimeMs: 300_000, durability: 'PROCESS_LOCAL' },
    authoritativeReconciliationLookup: 'CLIENT_CURSOR_RESUME',
    concurrencyLimit: 32,
    poisonEventQuarantine: true,
    degradedResult: 'CLIENT_FANOUT_DEGRADED',
    blockedResult: 'CLIENT_RECONNECT_AND_RESUME_REQUIRED',
    durableRestartCheckpoint: 'CLIENT_CURSOR_CHECKPOINT',
    escalationControlId: 'OWNER_CLIENT_SESSION_REVIEW',
    runbookId: 'RUNBOOK_WEBSOCKET_FANOUT',
    cockpitLocation: 'health.api.websocket_fanout',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'QUARANTINE',
      maximumCancellationWaitMs: 2_000, cancellationEvidenceId: 'OP_OUTBOUND_WEBSOCKET_FANOUT.cancellation',
    },
    faultTestIds: ['FAULT_CLIENT_BACKPRESSURE', 'FAULT_CURSOR_RESUME'],
  }),
  operationPolicy({
    operationId: 'OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED',
    operationClass: 'NON_IDEMPOTENT_MUTATION',
    canonicalOwnerId: 'LEGACY_SIGNED_PATH_OUTSIDE_CONVERGENCE',
    implementationPaths: ['server/src/binance/client.ts', 'server/src/binance/userStream.ts', 'server/src/services/orders.ts', 'server/src/services/loans.ts', 'server/src/foundation/exchange/binanceUsdM/client.ts', 'server/src/index.ts'],
    wiringState: 'DORMANT_BLOCKED',
    deadlineMs: 1,
    transientErrorCodes: [],
    permanentErrorCodes: ['LIVE_EXECUTION_NOT_IMPLEMENTED', 'SIGNED_CALL_FORBIDDEN'],
    ambiguousErrorCodes: ['UNKNOWN_SUBMISSION'],
    maximumAttempts: 1,
    backoff: { baseDelayMs: 0, maximumDelayMs: 0, jitterRatio: 0, totalRetryBudgetMs: 0 },
    priority: 'NORMAL',
    reserveUnits: 0,
    cooldownBehavior: 'NO_RETRY',
    idempotency: { required: true, identityField: 'clientOperationId', lifetimeMs: 86_400_000, durability: 'DURABLE' },
    authoritativeReconciliationLookup: 'PRIVATE_EXCHANGE_QUERY_NOT_COMPOSED',
    circuit: { failureThreshold: 1, resetAfterMs: 86_400_000, halfOpenMaximumProbes: 1, healthyQuietWindowMs: 86_400_000 },
    concurrencyLimit: 1,
    fallbackEligibility: 'NONE',
    degradedResult: 'DORMANT_BLOCKED',
    blockedResult: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
    automaticRemediationAllowed: false,
    escalationControlId: 'NO_RUNTIME_CONTROL',
    runbookId: 'RUNBOOK_SIGNED_PATH_MUST_REMAIN_UNWIRED',
    cockpitLocation: 'risk.execution_authority',
    cancellation: {
      mode: 'NOT_APPLICABLE', lateCompletionLaw: 'RECONCILE_BEFORE_RETRY',
      maximumCancellationWaitMs: 0, cancellationEvidenceId: 'OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED.cancellation',
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'LEGACY_SIGNED_PATH_OUTSIDE_CONVERGENCE',
      metricId: 'OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED.tripwire', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_SIGNED_EGRESS_TRIPWIRE', 'FAULT_DIAGNOSTIC_MONEY_MUTATION'],
  }),
  operationPolicy({
    operationId: 'OP_TELEMETRY_EXPORT',
    operationClass: 'IDEMPOTENT_COMMAND',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    implementationPaths: ['server/src/foundation/observability/**', 'server/src/productAssurance/projections/operationalTruth.ts'],
    wiringState: 'NOT_CONFIGURED',
    deadlineMs: 5_000,
    transientErrorCodes: ['EXPORTER_UNAVAILABLE', 'EXPORT_QUEUE_FULL'],
    permanentErrorCodes: ['TELEMETRY_SCHEMA_INCOMPATIBLE'],
    ambiguousErrorCodes: ['EXPORT_DELIVERY_UNKNOWN'],
    maximumAttempts: 3,
    priority: 'RECONCILIATION',
    reserveUnits: 1,
    idempotency: { required: true, identityField: 'telemetryRecordId', lifetimeMs: 86_400_000, durability: 'DURABLE' },
    authoritativeReconciliationLookup: 'INDEPENDENT_TELEMETRY_DELIVERY_RECEIPT',
    concurrencyLimit: 4,
    poisonEventQuarantine: true,
    degradedResult: 'TELEMETRY_PIPELINE_DEGRADED',
    blockedResult: 'TELEMETRY_PIPELINE_UNAVAILABLE',
    durableRestartCheckpoint: 'TELEMETRY_EXPORT_CURSOR',
    escalationControlId: 'OWNER_TELEMETRY_REVIEW',
    runbookId: 'RUNBOOK_TELEMETRY_EXPORT',
    cockpitLocation: 'health.assurance.telemetry',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'QUARANTINE',
      maximumCancellationWaitMs: 5_000, cancellationEvidenceId: 'OP_TELEMETRY_EXPORT.cancellation',
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'SYSTEM_INTEGRATION',
      metricId: 'OP_TELEMETRY_EXPORT.queue_budget', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_TELEMETRY_EXPORTER', 'FAULT_TELEMETRY_DROP', 'FAULT_COMMON_MODE_FALSE_GREEN'],
  }),
  operationPolicy({
    operationId: 'OP_DIAGNOSTIC_PROVIDER',
    operationClass: 'PURE_READ',
    canonicalOwnerId: 'PRODUCT_ASSURANCE_DIAGNOSTIC_BOUNDARY',
    implementationPaths: ['server/src/productAssurance/diagnostics/boundary.ts'],
    wiringState: 'NOT_CONFIGURED',
    deadlineMs: 15_000,
    transientErrorCodes: ['PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'COST_BUDGET_EXHAUSTED'],
    permanentErrorCodes: ['OUTPUT_SCHEMA_INVALID', 'TOOL_CAPABILITY_FORBIDDEN'],
    ambiguousErrorCodes: [],
    maximumAttempts: 1,
    priority: 'OPTIONAL',
    cooldownBehavior: 'NO_RETRY',
    poisonEventQuarantine: true,
    degradedResult: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
    blockedResult: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
    escalationControlId: 'OWNER_DIAGNOSTIC_REVIEW',
    runbookId: 'RUNBOOK_DIAGNOSTIC_PROVIDER',
    cockpitLocation: 'health.assurance.diagnostics',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'QUARANTINE',
      maximumCancellationWaitMs: 2_000, cancellationEvidenceId: 'OP_DIAGNOSTIC_PROVIDER.cancellation',
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'PRODUCT_ASSURANCE_DIAGNOSTIC_BOUNDARY',
      metricId: 'OP_DIAGNOSTIC_PROVIDER.cost_budget', missingBehavior: 'SHED_OPTIONAL',
    },
    faultTestIds: ['FAULT_PROMPT_INJECTION', 'FAULT_TOOL_ESCALATION', 'FAULT_PROVIDER_OUTAGE'],
  }),
  operationPolicy({
    operationId: 'OP_LOCAL_REMEDIATION_CAMPAIGN',
    operationClass: 'RISK_REDUCING_RECOVERY',
    canonicalOwnerId: 'BACKEND_FOUNDATION_CONTROL',
    implementationPaths: ['server/src/productAssurance/remediation/campaign.ts', 'server/src/foundation/control/**'],
    wiringState: 'NOT_CONFIGURED',
    deadlineMs: 30_000,
    transientErrorCodes: ['PRECONDITION_TEMPORARILY_FALSE', 'LEASE_BUSY'],
    permanentErrorCodes: ['ACTION_NOT_REGISTERED', 'BUDGET_EXHAUSTED', 'FENCE_REJECTED'],
    ambiguousErrorCodes: ['REPAIR_COMPLETION_UNKNOWN'],
    maximumAttempts: 1,
    priority: 'RISK_REDUCING',
    reserveUnits: 2,
    cooldownBehavior: 'NO_RETRY',
    idempotency: { required: true, identityField: 'campaignActionIdentity', lifetimeMs: 604_800_000, durability: 'DURABLE' },
    authoritativeReconciliationLookup: 'INDEPENDENT_POSTCONDITION_AND_CAMPAIGN_LEDGER',
    concurrencyLimit: 1,
    poisonEventQuarantine: true,
    degradedResult: 'RECOVERY_CONTINUES_WITH_NEW_EXPOSURE_BLOCKED',
    blockedResult: 'REMEDIATION_ESCALATED_OR_QUARANTINED',
    durableRestartCheckpoint: 'I04_CAMPAIGN_CHECKPOINT_INSERTION_REQUIRED',
    automaticRemediationAllowed: false,
    escalationControlId: 'OWNER_APPROVED_REMEDIATION',
    runbookId: 'RUNBOOK_BOUNDED_REMEDIATION',
    cockpitLocation: 'health.assurance.remediation',
    cancellation: {
      mode: 'DEADLINE_ONLY', lateCompletionLaw: 'RECONCILE_BEFORE_RETRY',
      maximumCancellationWaitMs: 30_000, cancellationEvidenceId: 'OP_LOCAL_REMEDIATION_CAMPAIGN.cancellation',
    },
    controlLoop: {
      maximumConsecutiveRepairs: 3, maximumAmplificationFactor: 1,
      alternatingFingerprintWindowMs: 300_000, cooldownMs: 120_000,
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'BACKEND_FOUNDATION_CONTROL',
      metricId: 'OP_LOCAL_REMEDIATION_CAMPAIGN.resource_budget', missingBehavior: 'BLOCK_OPERATION',
    },
    faultTestIds: ['FAULT_REPAIR_CONFLICT', 'FAULT_REPAIR_ALTERNATING_LOOP', 'FAULT_STALE_REPAIR_COMPLETION'],
  }),
  operationPolicy({
    operationId: 'OP_Q_ADVISORY_INFERENCE_CONTRACT',
    operationClass: 'PURE_READ',
    canonicalOwnerId: 'Q_ACCEPTED_ADVISORY_INTERFACE',
    implementationPaths: ['quant/src/quant_edge/inference/service.py', 'quant/src/quant_edge/inference/protocol.py'],
    wiringState: 'NOT_CONFIGURED',
    deadlineMs: 2_000,
    transientErrorCodes: ['Q_UNAVAILABLE', 'Q_DATA_INSUFFICIENT'],
    permanentErrorCodes: ['Q_PROTOCOL_INCOMPATIBLE', 'Q_SCHEMA_INCOMPATIBLE'],
    ambiguousErrorCodes: [],
    maximumAttempts: 1,
    priority: 'OPTIONAL',
    cooldownBehavior: 'NO_RETRY',
    poisonEventQuarantine: true,
    degradedResult: 'ABSTAIN_UNKNOWN',
    blockedResult: 'ABSTAIN_UNKNOWN',
    escalationControlId: 'NO_Q_RUNTIME_CONTROL_IN_PACKET',
    runbookId: 'RUNBOOK_Q_ADVISORY_ABSTENTION',
    cockpitLocation: 'health.intelligence.q',
    cancellation: {
      mode: 'COOPERATIVE_ABORT', lateCompletionLaw: 'QUARANTINE',
      maximumCancellationWaitMs: 1_000, cancellationEvidenceId: 'OP_Q_ADVISORY_INFERENCE_CONTRACT.cancellation',
    },
    costResourceEvidence: {
      required: true, budgetOwnerId: 'Q_ACCEPTED_ADVISORY_INTERFACE',
      metricId: 'OP_Q_ADVISORY_INFERENCE_CONTRACT.resource_budget', missingBehavior: 'SHED_OPTIONAL',
    },
    faultTestIds: ['FAULT_Q_UNAVAILABLE', 'FAULT_Q_STALE', 'FAULT_Q_HOLDOUT_UNKNOWN'],
  }),
]);

export const CORE_OPERATION_POLICIES = OPERATION_POLICY_REGISTRY;

interface InvariantSeed {
  readonly invariantId: string;
  readonly family: SafetyInvariantDefinition['family'];
  readonly ownerId: string;
  readonly expression: string;
  readonly factIds: readonly string[];
  readonly rule: SafetyInvariantDefinition['rule'];
  readonly severity?: AssuranceSeverity;
  readonly failSafeAction: string;
  readonly incidentId: string;
  readonly cockpitSurface: string;
  readonly repairControlId: string | null;
  readonly runbookId: string;
  readonly adversarialTestIds: readonly string[];
}

function invariantDefinition(seed: Readonly<InvariantSeed>): Readonly<SafetyInvariantDefinition> {
  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_INVARIANT_V1',
    revision: 1,
    invariantId: seed.invariantId,
    family: seed.family,
    ownerId: seed.ownerId,
    expression: seed.expression,
    factIds: freezeStrings(seed.factIds),
    factOwnerIds: Object.freeze(Object.fromEntries(seed.factIds.map((factId) => [factId, seed.ownerId]))),
    rule: Object.freeze({ ...seed.rule }),
    cadenceMs: 5_000,
    severity: seed.severity ?? 'CRITICAL',
    capitalRelevant: true,
    missingDataBehavior: 'UNKNOWN_BLOCKS_TRADE_READINESS',
    failSafeAction: seed.failSafeAction,
    incidentId: seed.incidentId,
    cockpitSurface: seed.cockpitSurface,
    repairControlId: seed.repairControlId,
    runbookId: seed.runbookId,
    adversarialTestIds: freezeStrings(seed.adversarialTestIds),
    independentVerificationRequired: true,
  });
}

export const SAFETY_INVARIANT_CATALOG: readonly Readonly<SafetyInvariantDefinition>[] = Object.freeze([
  invariantDefinition({
    invariantId: 'INV_DURABLE_INTENT_AND_MUTATION_IDENTITY',
    family: 'DURABLE_INTENT_AND_MUTATION_IDENTITY',
    ownerId: 'EXISTING_LEDGER',
    expression: 'Every mutation has durable intent, a stable identity, and an authoritative lookup before submission.',
    factIds: ['intent.persisted_before_submission', 'mutation.identity_bound', 'mutation.authoritative_lookup_available'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_NEW_EXPOSURE_AND_RECONCILE',
    incidentId: 'INCIDENT_MUTATION_IDENTITY',
    cockpitSurface: 'risk.assurance.intent',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
    runbookId: 'RUNBOOK_DURABLE_INTENT',
    adversarialTestIds: ['FAULT_RESPONSE_LOST_AFTER_ACCEPTANCE', 'FAULT_DB_BEFORE_MUTATION', 'FAULT_DB_AFTER_MUTATION'],
  }),
  invariantDefinition({
    invariantId: 'INV_EXECUTION_FENCING_EPOCH',
    family: 'EXECUTION_FENCING_EPOCH',
    ownerId: 'BACKEND_FOUNDATION_EXECUTION',
    expression: 'Every execution-capable action presents the current lease epoch and stale epochs are rejected.',
    factIds: ['execution.fence_epoch_current', 'execution.stale_epoch_rejected', 'execution.lease_identity_durable'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_EXECUTION_AUTHORITY',
    incidentId: 'INCIDENT_EXECUTION_FENCE',
    cockpitSurface: 'risk.assurance.execution_fence',
    repairControlId: 'CONTROL_KILL_SWITCH',
    runbookId: 'RUNBOOK_EXECUTION_FENCING',
    adversarialTestIds: ['FAULT_DUAL_EXECUTOR', 'FAULT_LEASE_EXPIRY_HANDOFF', 'FAULT_STALE_COMPLETION'],
  }),
  invariantDefinition({
    invariantId: 'INV_RECONCILIATION_BEFORE_NEW_EXPOSURE',
    family: 'RECONCILIATION_BEFORE_NEW_EXPOSURE',
    ownerId: 'BACKEND_FOUNDATION_RECONCILIATION',
    expression: 'No new or increasing exposure is admitted while external truth is ambiguous, divergent, stale, or unavailable.',
    factIds: ['reconciliation.complete_before_new_exposure', 'reconciliation.ambiguity_blocks_exposure'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_NEW_EXPOSURE_PRESERVE_RISK_REDUCTION',
    incidentId: 'INCIDENT_RECONCILIATION_BARRIER',
    cockpitSurface: 'risk.assurance.reconciliation',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
    runbookId: 'RUNBOOK_RECONCILIATION_BARRIER',
    adversarialTestIds: ['FAULT_LOST_MUTATION_RESPONSE', 'FAULT_PARTIAL_FILL', 'FAULT_PROCESS_DEATH_TRANSITION'],
  }),
  invariantDefinition({
    invariantId: 'INV_SOURCE_FRESHNESS_COMPLETENESS_CONTINUITY',
    family: 'SOURCE_FRESHNESS_COMPLETENESS_CONTINUITY',
    ownerId: 'INTELLIGENCE_RUNTIME',
    expression: 'Required public and private facts are fresh, complete, sequence-continuous, and temporally coherent.',
    factIds: ['source.public_fresh', 'source.private_fresh', 'source.sequence_continuous', 'source.temporal_coherence_valid'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'DEGRADE_OR_BLOCK_DEPENDENT_DECISIONS',
    incidentId: 'INCIDENT_SOURCE_TRUTH_GAP',
    cockpitSurface: 'health.assurance.source_truth',
    repairControlId: 'CONTROL_PUBLIC_SOURCE_RESTART',
    runbookId: 'RUNBOOK_SOURCE_TRUTH',
    adversarialTestIds: ['FAULT_SEQUENCE_GAP', 'FAULT_SPOT_USDM_SKEW', 'FAULT_CLOCK_STALE'],
  }),
  invariantDefinition({
    invariantId: 'INV_LOCAL_EXCHANGE_TRUTH',
    family: 'LOCAL_EXCHANGE_TRUTH',
    ownerId: 'BACKEND_FOUNDATION_RECONCILIATION',
    expression: 'Local orders, fills, positions, and liabilities agree with authoritative exchange observations.',
    factIds: ['truth.orders_reconciled', 'truth.fills_reconciled', 'truth.positions_reconciled', 'truth.liabilities_reconciled'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'ENTER_RECOVERY_REQUIRED',
    incidentId: 'INCIDENT_LOCAL_EXCHANGE_DIVERGENCE',
    cockpitSurface: 'account.assurance.exchange_truth',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
    runbookId: 'RUNBOOK_EXCHANGE_RECONCILIATION',
    adversarialTestIds: ['FAULT_LOST_BORROW_RESPONSE', 'FAULT_LOST_CANCEL_ACK', 'FAULT_PARTIAL_FILL'],
  }),
  invariantDefinition({
    invariantId: 'INV_CAPITAL_EXPOSURE_LIMITS',
    family: 'CAPITAL_EXPOSURE_LIMITS',
    ownerId: 'CAPITAL_SUPERVISION',
    expression: 'Reservations, exposure, loss, leverage, concentration, liabilities, and recovery reserve remain within owner limits.',
    factIds: ['capital.reservations_within_limit', 'capital.exposure_within_limit', 'capital.loss_within_limit', 'capital.leverage_within_limit', 'capital.concentration_within_limit', 'capital.recovery_reserve_sufficient'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'REJECT_NEW_CAPITAL_AND_PRESERVE_RECOVERY_RESERVE',
    incidentId: 'INCIDENT_CAPITAL_LIMIT',
    cockpitSurface: 'risk.assurance.capital_limits',
    repairControlId: 'CONTROL_REVOKE_RESERVATION',
    runbookId: 'RUNBOOK_CAPITAL_LIMITS',
    adversarialTestIds: ['FAULT_RESERVATION_OVERRUN', 'FAULT_LEVERAGE_CHANGE', 'FAULT_LIABILITY_UNKNOWN'],
  }),
  invariantDefinition({
    invariantId: 'INV_HALT_KILL_COVERAGE',
    family: 'HALT_KILL_COVERAGE',
    ownerId: 'BACKEND_FOUNDATION_CONTROL',
    expression: 'Halt and kill state gates every risk-increasing route including legacy signed boundaries.',
    factIds: ['control.kill_switch_fail_closed', 'control.all_risk_increasing_routes_covered', 'control.legacy_signed_route_blocked'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_ALL_RISK_INCREASING_ROUTES',
    incidentId: 'INCIDENT_KILL_COVERAGE',
    cockpitSurface: 'risk.assurance.kill_coverage',
    repairControlId: 'CONTROL_KILL_SWITCH',
    runbookId: 'RUNBOOK_KILL_COVERAGE',
    adversarialTestIds: ['FAULT_ROUTE_BYPASS', 'FAULT_SIGNED_EGRESS_TRIPWIRE', 'FAULT_STALE_CONTROL_STATE'],
  }),
  invariantDefinition({
    invariantId: 'INV_RISK_REDUCING_AVAILABILITY',
    family: 'RISK_REDUCING_AVAILABILITY',
    ownerId: 'BACKEND_FOUNDATION_EXECUTION',
    expression: 'Cancel, close, recovery, reconciliation, and repay capability remain independently available during intake halt.',
    factIds: ['recovery.cancel_available', 'recovery.close_available', 'recovery.reconciliation_available', 'recovery.repay_available'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'ESCALATE_WITH_EXPOSURE_VISIBLE',
    incidentId: 'INCIDENT_RISK_REDUCTION_UNAVAILABLE',
    cockpitSurface: 'risk.assurance.recovery_availability',
    repairControlId: 'OWNER_APPROVED_REMEDIATION',
    runbookId: 'RUNBOOK_RISK_REDUCTION',
    adversarialTestIds: ['FAULT_RATE_LIMIT_DURING_RECOVERY', 'FAULT_REPAY_UNAVAILABLE', 'FAULT_CANCEL_UNAVAILABLE'],
  }),
  invariantDefinition({
    invariantId: 'INV_ONE_EXCHANGE_HAND_AND_LEASE',
    family: 'ONE_EXCHANGE_HAND_AND_LEASE',
    ownerId: 'BACKEND_FOUNDATION_EXECUTION',
    expression: 'Exactly one canonical exchange hand and one current execution lease can act.',
    factIds: ['execution.one_exchange_hand', 'execution.one_active_lease'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'FENCE_ALL_EXECUTORS',
    incidentId: 'INCIDENT_DUPLICATE_EXECUTOR',
    cockpitSurface: 'risk.assurance.execution_authority',
    repairControlId: 'CONTROL_KILL_SWITCH',
    runbookId: 'RUNBOOK_SINGLE_EXECUTOR',
    adversarialTestIds: ['FAULT_DUAL_EXECUTOR', 'FAULT_EXECUTOR_SPLIT_BRAIN'],
  }),
  invariantDefinition({
    invariantId: 'INV_WITHDRAWAL_TRANSFER_IMPOSSIBILITY',
    family: 'WITHDRAWAL_TRANSFER_IMPOSSIBILITY',
    ownerId: 'SYSTEM_INTEGRATION',
    expression: 'Withdrawal and transfer-out capabilities, routes, commands, and diagnostic tools are absent.',
    factIds: ['authority.withdrawal_absent', 'authority.transfer_out_absent', 'authority.diagnostic_money_tools_absent'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_STARTUP_AND_RAISE_SECURITY_INCIDENT',
    incidentId: 'INCIDENT_FORBIDDEN_MONEY_CAPABILITY',
    cockpitSurface: 'risk.assurance.forbidden_capabilities',
    repairControlId: null,
    runbookId: 'RUNBOOK_FORBIDDEN_CAPABILITY',
    adversarialTestIds: ['FAULT_WITHDRAW_ROUTE_SCAN', 'FAULT_DIAGNOSTIC_MONEY_MUTATION'],
  }),
  invariantDefinition({
    invariantId: 'INV_TRUTH_REALM_SEPARATION',
    family: 'TRUTH_REALM_SEPARATION',
    ownerId: 'SYSTEM_INTEGRATION',
    expression: 'Live public, live private, dry-run, replay, synthetic, unavailable, and unknown realms never promote one another.',
    factIds: ['truth.labels_canonical', 'truth.synthetic_never_live', 'truth.unknown_never_zero'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'DOWNGRADE_TO_UNKNOWN_AND_BLOCK_GREEN',
    incidentId: 'INCIDENT_TRUTH_REALM_MIX',
    cockpitSurface: 'health.assurance.truth_realms',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
    runbookId: 'RUNBOOK_TRUTH_REALMS',
    adversarialTestIds: ['FAULT_SYNTHETIC_LIVE_FORGERY', 'FAULT_UNKNOWN_ZERO_COERCION'],
  }),
  invariantDefinition({
    invariantId: 'INV_INSTRUMENT_ACCOUNT_COMPATIBILITY',
    family: 'INSTRUMENT_ACCOUNT_COMPATIBILITY',
    ownerId: 'CAPITAL_SUPERVISION',
    expression: 'Filters, clock, permissions, account mode, leverage, and margin mode match the proposed action.',
    factIds: ['compatibility.filters_current', 'compatibility.clock_valid', 'compatibility.permissions_valid', 'compatibility.account_mode_valid', 'compatibility.leverage_valid', 'compatibility.margin_mode_valid'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'REJECT_ACTION_AS_INCOMPATIBLE',
    incidentId: 'INCIDENT_INSTRUMENT_ACCOUNT_INCOMPATIBLE',
    cockpitSurface: 'account.assurance.compatibility',
    repairControlId: 'OWNER_ACCOUNT_REVIEW',
    runbookId: 'RUNBOOK_ACCOUNT_COMPATIBILITY',
    adversarialTestIds: ['FAULT_STALE_FILTER', 'FAULT_ACCOUNT_MODE_CHANGE', 'FAULT_CLOCK_OFFSET'],
  }),
  invariantDefinition({
    invariantId: 'INV_RISK_REDUCTION_RATE_RESERVE',
    family: 'RISK_REDUCTION_RATE_RESERVE',
    ownerId: 'BACKEND_FOUNDATION_EXECUTION',
    expression: 'Rate capacity reserved for reconciliation and risk reduction remains available before normal or optional work.',
    factIds: ['rate.reconciliation_reserve_available', 'rate.risk_reduction_reserve_available', 'rate.priority_order_enforced'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'SHED_OPTIONAL_AND_NORMAL_WORK',
    incidentId: 'INCIDENT_RATE_RESERVE',
    cockpitSurface: 'health.assurance.rate_budget',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
    runbookId: 'RUNBOOK_RATE_RESERVE',
    adversarialTestIds: ['FAULT_THROTTLE_COOLDOWN', 'FAULT_RETRY_AMPLIFICATION'],
  }),
  invariantDefinition({
    invariantId: 'INV_DURABLE_ADVANCEMENT',
    family: 'DURABLE_ADVANCEMENT',
    ownerId: 'EXISTING_LEDGER',
    expression: 'Ledger, database, material events, supervisor, and telemetry independently advance within their freshness windows.',
    factIds: ['advancement.ledger', 'advancement.database', 'advancement.material_event', 'advancement.supervisor', 'advancement.telemetry'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_GREEN_AND_PRESERVE_LEDGER',
    incidentId: 'INCIDENT_ADVANCEMENT_STALLED',
    cockpitSurface: 'logs.assurance.advancement',
    repairControlId: 'OWNER_TELEMETRY_REVIEW',
    runbookId: 'RUNBOOK_ADVANCEMENT_STALL',
    adversarialTestIds: ['FAULT_LEDGER_STALL', 'FAULT_SUPERVISOR_STALL', 'FAULT_TELEMETRY_EXPORTER'],
  }),
  invariantDefinition({
    invariantId: 'INV_REVISION_COMPATIBILITY',
    family: 'REVISION_COMPATIBILITY',
    ownerId: 'SYSTEM_INTEGRATION',
    expression: 'Build, config, schema, model, and protocol revisions are explicit and mutually compatible.',
    factIds: ['revision.build_compatible', 'revision.config_compatible', 'revision.schema_compatible', 'revision.model_compatible', 'revision.protocol_compatible'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_INCOMPATIBLE_CAPABILITY',
    incidentId: 'INCIDENT_REVISION_INCOMPATIBLE',
    cockpitSurface: 'health.assurance.revisions',
    repairControlId: 'OWNER_CONFIGURATION_REVIEW',
    runbookId: 'RUNBOOK_REVISION_COMPATIBILITY',
    adversarialTestIds: ['FAULT_SCHEMA_DRIFT', 'FAULT_MODEL_REVISION_MISSING', 'FAULT_PROTOCOL_MISMATCH'],
  }),
  invariantDefinition({
    invariantId: 'INV_EXPECTED_INVENTORY_TELEMETRY',
    family: 'EXPECTED_INVENTORY_TELEMETRY',
    ownerId: 'SYSTEM_INTEGRATION',
    expression: 'Every expected component, dependency, control, invariant, telemetry signal, and owner question is accounted for.',
    factIds: ['inventory.expected_components_complete', 'inventory.expected_dependencies_complete', 'inventory.expected_controls_complete', 'inventory.expected_telemetry_complete', 'inventory.owner_questions_complete'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_OVERALL_GREEN',
    incidentId: 'INCIDENT_EXPECTED_INVENTORY_GAP',
    cockpitSurface: 'health.assurance.coverage',
    repairControlId: 'OWNER_INVENTORY_REVIEW',
    runbookId: 'RUNBOOK_EXPECTED_INVENTORY',
    adversarialTestIds: ['FAULT_MISSING_EXPECTED_COMPONENT', 'FAULT_SILENT_EXPECTED_COMPONENT', 'FAULT_SCHEMA_INCOMPATIBLE_TELEMETRY'],
  }),
  invariantDefinition({
    invariantId: 'INV_BACKUP_WATCHDOG_PROBE_FRESHNESS',
    family: 'BACKUP_WATCHDOG_PROBE_FRESHNESS',
    ownerId: 'IP_OPS_DEPLOYMENT_OWNER',
    expression: 'Backup proof, external watchdog, and independent black-box probe are fresh and independently retained.',
    factIds: ['recovery.backup_proof_fresh', 'recovery.watchdog_fresh', 'recovery.independent_probe_fresh', 'recovery.probe_independently_retained'],
    rule: { kind: 'ALL_TRUE' },
    failSafeAction: 'BLOCK_CONTINUOUS_OPERATION_GREEN',
    incidentId: 'INCIDENT_EXTERNAL_RECOVERY_PROOF_STALE',
    cockpitSurface: 'health.assurance.out_of_band',
    repairControlId: 'OWNER_OPS_REVIEW',
    runbookId: 'RUNBOOK_OUT_OF_BAND_RECOVERY',
    adversarialTestIds: ['FAULT_WATCHDOG_LOSS', 'FAULT_BACKUP_RESTORE_INCOMPLETE', 'FAULT_COMMON_MODE_PROBE'],
  }),
]);

export const CORE_SAFETY_INVARIANTS = SAFETY_INVARIANT_CATALOG;

interface OwnerQuestionSeed {
  readonly questionId: string;
  readonly sourceSection?: OwnerQuestionCoverageEntry['sourceSection'];
  readonly question: string;
  readonly canonicalOwnerId: string;
  readonly evidenceIds: readonly string[];
  readonly cockpitSurface: string;
  readonly repairControlId: string | null;
  readonly severity?: AssuranceSeverity;
  readonly freshnessMs?: number;
  readonly hysteresisMs?: number;
}

function ownerQuestion(seed: Readonly<OwnerQuestionSeed>): Readonly<OwnerQuestionCoverageEntry> {
  return Object.freeze({
    questionId: seed.questionId,
    sourceSection: seed.sourceSection ?? 'I00_SECTION_3',
    question: seed.question,
    canonicalOwnerId: seed.canonicalOwnerId,
    evidenceIds: freezeStrings(seed.evidenceIds),
    metricId: `${seed.questionId}.metric`,
    structuredLogId: `${seed.questionId}.structured_log`,
    materialEventId: `${seed.questionId}.material_event`,
    traceId: `${seed.questionId}.trace`,
    incidentId: `${seed.questionId}.incident`,
    freshnessMs: seed.freshnessMs ?? 15_000,
    hysteresisMs: seed.hysteresisMs ?? 5_000,
    missingDataLaw: 'UNKNOWN_BLOCKS_GREEN',
    severity: seed.severity ?? 'CRITICAL',
    cockpitSurface: seed.cockpitSurface,
    repairControlId: seed.repairControlId,
    fixtureId: `${seed.questionId}.fixture`,
    proofId: `${seed.questionId}.proof`,
  });
}

export const OWNER_QUESTION_COVERAGE: readonly Readonly<OwnerQuestionCoverageEntry>[] = Object.freeze([
  ownerQuestion({
    questionId: 'OWNER_Q01_PROCESS_ALIVE',
    question: 'Is the product process alive?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['engine_supervisor.heartbeat', 'external_watchdog.process_probe'],
    cockpitSurface: 'dashboard.system_process',
    repairControlId: 'OWNER_OPS_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q02_READY_TO_SENSE',
    question: 'Is the product ready to sense markets?',
    canonicalOwnerId: 'INTELLIGENCE_RUNTIME',
    evidenceIds: ['public_spot.freshness', 'public_usdm.freshness', 'market_universe.advancement'],
    cockpitSurface: 'dashboard.market_sensing',
    repairControlId: 'CONTROL_PUBLIC_SOURCE_RESTART',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q03_SAFE_TO_CONSIDER_MONEY_ACTION',
    question: 'Is the product safe to consider a money action?',
    canonicalOwnerId: 'BACKEND_FOUNDATION_RISK',
    evidenceIds: ['invariants.trade_readiness', 'capital.eligibility', 'risk.verdict', 'execution.authority_state'],
    cockpitSurface: 'risk.trade_readiness',
    repairControlId: 'CONTROL_KILL_SWITCH',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q04_COMPONENT_STATES',
    question: 'Which exact components are running, warming, ready, degraded, stale, blocked, stopped, or recovering?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['supervisor.canonical_component_snapshots', 'inventory.expected_component_denominator'],
    cockpitSurface: 'health.component_graph',
    repairControlId: 'OWNER_COMPONENT_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q05_BLOCKING_DEPENDENCY',
    question: 'Which dependency blocks each failed component?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['supervisor.root_cause_graph', 'inventory.expected_dependency_denominator'],
    cockpitSurface: 'health.root_cause_graph',
    repairControlId: 'OWNER_COMPONENT_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q06_MARKET_AND_ACCOUNT_REALMS_CURRENT',
    question: 'Are Spot public data, USD-M public data, Spot private truth, USD-M private truth, and Margin truth current?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['public_spot.freshness', 'public_usdm.freshness', 'private_spot.freshness', 'private_usdm.freshness', 'private_margin.freshness'],
    cockpitSurface: 'account.truth_realms',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q07_LIFECYCLE_COUNTS',
    question: 'How many symbols are in universe, candidate, focus, opportunity, active, recovery, and cooldown states?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['supervisor.lifecycle_counts', 'market_universe.snapshot', 'capital.position_projection'],
    cockpitSurface: 'dashboard.lifecycle_counts',
    repairControlId: 'OWNER_COMPONENT_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q08_Q_ASSESSMENT',
    question: 'What did Q infer, with which model/version, uncertainty, data quality, and abstention?',
    canonicalOwnerId: 'Q_ACCEPTED_ADVISORY_INTERFACE',
    evidenceIds: ['q.accepted_protocol_projection', 'q.model_revision', 'q.uncertainty', 'q.data_quality', 'q.abstention'],
    cockpitSurface: 'dashboard.q_assessment',
    repairControlId: null,
  }),
  ownerQuestion({
    questionId: 'OWNER_Q09_ENGINE_DECISIONS',
    question: 'What did the existing Basis and Volume engines decide?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['basis_engine.canonical_decision', 'volume_engine.canonical_decision'],
    cockpitSurface: 'opportunities.engine_decisions',
    repairControlId: null,
  }),
  ownerQuestion({
    questionId: 'OWNER_Q10_CAPITAL_RISK_VERDICTS',
    question: 'What did Capital and Risk permit, cap, or reject?',
    canonicalOwnerId: 'CAPITAL_SUPERVISION',
    evidenceIds: ['capital.canonical_verdict', 'multileg_risk.canonical_verdict'],
    cockpitSurface: 'risk.capital_and_risk',
    repairControlId: 'CONTROL_REVOKE_RESERVATION',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q11_DURABLE_BUSINESS_STATE',
    question: 'What ticket, order, fill, position, liability, recovery, or outcome exists?',
    canonicalOwnerId: 'EXISTING_LEDGER',
    evidenceIds: ['ledger.material_business_events', 'reconciliation.external_truth', 'capital.position_projection'],
    cockpitSurface: 'logs.ledger_business_state',
    repairControlId: 'OWNER_LEDGER_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q12_TRUTH_REALMS',
    question: 'What is live, public-live, private-live, replay, synthetic, dry-run, shadow, unavailable, or unknown?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['supervisor.truth_labels', 'invariant.truth_realm_separation'],
    cockpitSurface: 'health.truth_realms',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q13_RECENT_CHANGE_AND_ATTENTION',
    question: 'What changed recently and what requires owner attention?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['supervisor.attention_queue', 'ledger.recent_material_events', 'incident.active_groups'],
    cockpitSurface: 'dashboard.owner_attention',
    repairControlId: 'OWNER_INCIDENT_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q14_SUPPORTED_CONTROLS',
    question: 'What controls are supported for the selected component?',
    canonicalOwnerId: 'BACKEND_FOUNDATION_CONTROL',
    evidenceIds: ['control.capability_registry', 'component.supported_controls'],
    cockpitSurface: 'health.component_controls',
    repairControlId: null,
  }),
  ownerQuestion({
    questionId: 'OWNER_Q15_CONTROL_RESULT',
    question: 'Did a control request apply, reject, expire, or require restart?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['control.durable_receipt', 'control.checkpoint_revision'],
    cockpitSurface: 'health.control_receipts',
    repairControlId: 'OWNER_CONTROL_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_Q16_RELEASE_REVISIONS',
    question: 'What is the current tested commit, deployed commit, config revision, schema revision, and model champion?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['release.tested_commit', 'release.deployed_commit', 'release.config_revision', 'release.schema_revision', 'release.model_champion'],
    cockpitSurface: 'health.release_revisions',
    repairControlId: 'OWNER_CONFIGURATION_REVIEW',
    freshnessMs: 60_000,
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q01_CAN_RUN',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can it run through one composition root, one start, dependency order, reconciliation, and clean shutdown?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['composition.one_root', 'composition.startup_order', 'reconciliation.restart_barrier', 'composition.clean_shutdown'],
    cockpitSurface: 'health.final_assurance.runtime',
    repairControlId: 'OWNER_COMPONENT_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q02_CAN_SEE',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can it see advancing public and private truth, universe and Q freshness, including stale, gap, and conflict states?',
    canonicalOwnerId: 'INTELLIGENCE_RUNTIME',
    evidenceIds: ['source.public_advancement', 'source.private_advancement', 'market_universe.advancement', 'q.freshness', 'source.gap_conflict_projection'],
    cockpitSurface: 'health.final_assurance.sensing',
    repairControlId: 'CONTROL_PUBLIC_SOURCE_RESTART',
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q03_CAN_THINK_HONESTLY',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can it think honestly with canonical evidence, explicit revisions, calibrated or honest labels, and unknowns preserved?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['evidence.canonical_lineage', 'revision.compatibility', 'q.calibration_or_non_probability_label', 'truth.unknown_preserved'],
    cockpitSurface: 'health.final_assurance.intelligence',
    repairControlId: 'CONTROL_INTAKE_PAUSE',
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q04_CAN_CONTROL_MONEY',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can it control money with one Capital owner, one Risk owner, one exchange hand, durable intent, and exact cost and liability truth?',
    canonicalOwnerId: 'BACKEND_FOUNDATION_RISK',
    evidenceIds: ['authority.one_capital_owner', 'authority.one_risk_owner', 'execution.one_exchange_hand', 'intent.durable_before_mutation', 'capital.exact_cost_liability_truth'],
    cockpitSurface: 'risk.final_assurance.money_authority',
    repairControlId: 'CONTROL_KILL_SWITCH',
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q05_CAN_SURVIVE_FAILURE',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can it survive ambiguity, partial leg, crash, restart, recovery, repay, and halted risk reduction?',
    canonicalOwnerId: 'BACKEND_FOUNDATION_RECONCILIATION',
    evidenceIds: ['fault.ambiguity_contained', 'fault.partial_leg_contained', 'fault.crash_restart_proof', 'recovery.liability_preserved', 'recovery.risk_reduction_available'],
    cockpitSurface: 'risk.final_assurance.failure_survival',
    repairControlId: 'OWNER_APPROVED_REMEDIATION',
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q06_CAN_OWNER_OPERATE',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can the owner operate it through real bounded controls, durable command receipts, root cause, and correlation traces without routine log archaeology?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['control.expected_live_coverage', 'control.durable_receipts', 'supervisor.root_cause_graph', 'trace.complete_correlation'],
    cockpitSurface: 'health.final_assurance.operability',
    repairControlId: 'OWNER_CONTROL_REVIEW',
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q07_CAN_RUN_CONTINUOUSLY',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can it run continuously with release supervision, watchdog, backup, restore, rollback, persistent state, and Cloudflare boundary proof?',
    canonicalOwnerId: 'IP_OPS_DEPLOYMENT_OWNER',
    evidenceIds: ['release.immutable_artifact', 'ops.service_supervision', 'ops.external_watchdog', 'ops.backup_restore_rollback', 'persistence.restart_state', 'ops.cloudflare_boundary'],
    cockpitSurface: 'health.final_assurance.continuity',
    repairControlId: 'OWNER_OPS_REVIEW',
    freshnessMs: 60_000,
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q08_CAN_LEARN',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Can it learn from traded, rejected, missed, late, and false-positive outcomes with immutable lineage, calibration, drift, and retirement evidence?',
    canonicalOwnerId: 'MARKET_INTELLIGENCE',
    evidenceIds: ['outcome.cohorts_complete', 'outcome.immutable_lineage', 'model.calibration', 'model.drift', 'model.retirement'],
    cockpitSurface: 'health.final_assurance.learning',
    repairControlId: 'OWNER_MODEL_REVIEW',
    freshnessMs: 60_000,
  }),
  ownerQuestion({
    questionId: 'OWNER_FINAL_Q09_HEAVYWEIGHT_REQUIREMENT_GAPS',
    sourceSection: 'I00_FINAL_NO_SURPRISES',
    question: 'Is any heavyweight Mission requirement absent from wired, visible, and proved coverage?',
    canonicalOwnerId: 'SYSTEM_INTEGRATION',
    evidenceIds: ['mission.coverage_matrix', 'inventory.expected_denominator', 'proof.required_artifacts'],
    cockpitSurface: 'health.final_assurance.mission_coverage',
    repairControlId: 'OWNER_MISSION_COVERAGE_REVIEW',
    freshnessMs: 60_000,
  }),
]);

export const CORE_OWNER_QUESTION_COVERAGE = OWNER_QUESTION_COVERAGE;

function component(
  componentId: string,
  ownerId: string,
  ownerPath: string,
  capitalCritical: boolean,
  silentAfterMs: number,
  staleAfterMs: number,
): Readonly<ExpectedComponent> {
  return Object.freeze({ componentId, ownerId, ownerPath, capitalCritical, silentAfterMs, staleAfterMs });
}

function dependency(
  dependencyId: string,
  fromComponentId: string,
  toComponentId: string,
  required: boolean,
  capitalCritical: boolean,
): Readonly<ExpectedDependency> {
  return Object.freeze({ dependencyId, fromComponentId, toComponentId, required, capitalCritical });
}

function control(
  controlId: string,
  backendOwnerId: string,
  backendCommandId: string,
): Readonly<ExpectedControl> {
  return Object.freeze({ controlId, backendOwnerId, backendCommandId, required: true });
}

function telemetry(
  signalId: string,
  ownerId: string,
  schemaRevision: string,
  freshnessMs: number,
  capitalCritical: boolean,
): Readonly<ExpectedTelemetrySignal> {
  return Object.freeze({ signalId, ownerId, schemaRevision, freshnessMs, required: true, capitalCritical });
}

/** Exact canonical supervisor denominator. ProductAssurance is not a 14th node. */
export const EXPECTED_CANONICAL_COMPONENTS: readonly Readonly<ExpectedComponent>[] = Object.freeze([
  component('public-spot-source', 'INTELLIGENCE_RUNTIME', 'server/src/intelligenceRuntime', true, 10_000, 30_000),
  component('public-usdm-source', 'INTELLIGENCE_RUNTIME', 'server/src/intelligenceRuntime', true, 10_000, 30_000),
  component('market-universe', 'AUDITED_APP', 'server/src/engine/marketData.ts', true, 15_000, 60_000),
  component('intelligence-runtime', 'INTELLIGENCE_RUNTIME', 'server/src/intelligenceRuntime', true, 15_000, 60_000),
  component('market-intelligence', 'MARKET_INTELLIGENCE', 'server/src/intelligenceFoundation', true, 15_000, 60_000),
  component('basis-engine', 'BASIS_ENGINE', 'server/src/engine/basis', false, 15_000, 60_000),
  component('volume-engine', 'VOLUME_ENGINE', 'server/src/engine/volume', false, 15_000, 60_000),
  component('capital-supervision', 'CAPITAL_SUPERVISION', 'server/src/capitalFoundation', true, 15_000, 60_000),
  component('multileg-risk', 'BACKEND_FOUNDATION_RISK', 'server/src/foundation/risk', true, 15_000, 60_000),
  component('execution-coordinator-validate-only', 'BACKEND_FOUNDATION_EXECUTION', 'server/src/foundation/execution', true, 15_000, 60_000),
  component('reconciliation', 'BACKEND_FOUNDATION_RECONCILIATION', 'server/src/foundation/reconciliation', true, 15_000, 60_000),
  component('ledger-persistence', 'EXISTING_LEDGER', 'server/src/ledger.ts', true, 15_000, 60_000),
  component('engine-supervisor', 'SYSTEM_INTEGRATION', 'server/src/systemIntegration', true, 15_000, 60_000),
]);

export const EXPECTED_CANONICAL_DEPENDENCIES: readonly Readonly<ExpectedDependency>[] = Object.freeze([
  dependency('DEP_LEDGER_TO_PUBLIC_SPOT', 'ledger-persistence', 'public-spot-source', true, true),
  dependency('DEP_LEDGER_TO_PUBLIC_USDM', 'ledger-persistence', 'public-usdm-source', true, true),
  dependency('DEP_LEDGER_TO_SUPERVISOR', 'ledger-persistence', 'engine-supervisor', true, true),
  dependency('DEP_PUBLIC_SPOT_TO_UNIVERSE', 'public-spot-source', 'market-universe', true, true),
  dependency('DEP_PUBLIC_USDM_TO_UNIVERSE', 'public-usdm-source', 'market-universe', false, false),
  dependency('DEP_UNIVERSE_TO_RUNTIME', 'market-universe', 'intelligence-runtime', true, true),
  dependency('DEP_PUBLIC_SPOT_TO_RUNTIME', 'public-spot-source', 'intelligence-runtime', true, true),
  dependency('DEP_PUBLIC_USDM_TO_RUNTIME', 'public-usdm-source', 'intelligence-runtime', false, false),
  dependency('DEP_RUNTIME_TO_MARKET_INTELLIGENCE', 'intelligence-runtime', 'market-intelligence', true, true),
  dependency('DEP_MARKET_INTELLIGENCE_TO_BASIS', 'market-intelligence', 'basis-engine', true, false),
  dependency('DEP_PUBLIC_SPOT_TO_BASIS', 'public-spot-source', 'basis-engine', true, false),
  dependency('DEP_PUBLIC_USDM_TO_BASIS', 'public-usdm-source', 'basis-engine', true, false),
  dependency('DEP_MARKET_INTELLIGENCE_TO_VOLUME', 'market-intelligence', 'volume-engine', true, false),
  dependency('DEP_PUBLIC_SPOT_TO_VOLUME', 'public-spot-source', 'volume-engine', true, false),
  dependency('DEP_MARKET_INTELLIGENCE_TO_CAPITAL', 'market-intelligence', 'capital-supervision', true, true),
  dependency('DEP_BASIS_TO_CAPITAL', 'basis-engine', 'capital-supervision', false, false),
  dependency('DEP_VOLUME_TO_CAPITAL', 'volume-engine', 'capital-supervision', false, false),
  dependency('DEP_CAPITAL_TO_RISK', 'capital-supervision', 'multileg-risk', true, true),
  dependency('DEP_RISK_TO_EXECUTION', 'multileg-risk', 'execution-coordinator-validate-only', true, true),
  dependency('DEP_LEDGER_TO_EXECUTION', 'ledger-persistence', 'execution-coordinator-validate-only', true, true),
  dependency('DEP_EXECUTION_TO_RECONCILIATION', 'execution-coordinator-validate-only', 'reconciliation', true, true),
  dependency('DEP_LEDGER_TO_RECONCILIATION', 'ledger-persistence', 'reconciliation', true, true),
]);

/** All canonical commands are expected-live; disabled is evidence, not green. */
export const EXPECTED_CANONICAL_CONTROLS: readonly Readonly<ExpectedControl>[] = Object.freeze([
  control('CTRL_SET_COMPONENT_STATE', 'BACKEND_FOUNDATION_CONTROL', 'SET_COMPONENT_STATE'),
  control('CTRL_SET_INTAKE_PAUSED', 'SYSTEM_INTEGRATION', 'SET_INTAKE_PAUSED'),
  control('CTRL_SET_SAFE_MODE', 'BACKEND_FOUNDATION_CONTROL', 'SET_SAFE_MODE'),
  control('CTRL_SET_KILL_SWITCH', 'BACKEND_FOUNDATION_CONTROL', 'SET_KILL_SWITCH'),
  control('CTRL_APPLY_CONFIGURATION', 'SYSTEM_INTEGRATION', 'APPLY_CONFIGURATION'),
  control('CTRL_REVOKE_APPROVAL', 'CAPITAL_SUPERVISION', 'REVOKE_APPROVAL'),
  control('CTRL_REVOKE_RESERVATION', 'CAPITAL_SUPERVISION', 'REVOKE_RESERVATION'),
  control('CTRL_RESTART_COMPONENT', 'BACKEND_FOUNDATION_CONTROL', 'RESTART_COMPONENT'),
]);

export const EXPECTED_CANONICAL_TELEMETRY: readonly Readonly<ExpectedTelemetrySignal>[] = Object.freeze([
  telemetry('TEL_COMPONENT_PUBLIC_SPOT', 'public-spot-source', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 10_000, true),
  telemetry('TEL_COMPONENT_PUBLIC_USDM', 'public-usdm-source', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 10_000, true),
  telemetry('TEL_COMPONENT_MARKET_UNIVERSE', 'market-universe', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_INTELLIGENCE_RUNTIME', 'intelligence-runtime', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_MARKET_INTELLIGENCE', 'market-intelligence', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_BASIS_ENGINE', 'basis-engine', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, false),
  telemetry('TEL_COMPONENT_VOLUME_ENGINE', 'volume-engine', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, false),
  telemetry('TEL_COMPONENT_CAPITAL_SUPERVISION', 'capital-supervision', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_MULTILEG_RISK', 'multileg-risk', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_EXECUTION_VALIDATE_ONLY', 'execution-coordinator-validate-only', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_RECONCILIATION', 'reconciliation', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_LEDGER', 'ledger-persistence', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPONENT_SUPERVISOR', 'engine-supervisor', 'SYSTEM_COMPONENT_SNAPSHOT_V1', 15_000, true),
  telemetry('TEL_COMPLETE_CORRELATION_TRACE', 'SYSTEM_INTEGRATION', 'SYSTEM_TRACE_V1', 30_000, true),
  telemetry('TEL_INDEPENDENT_BLACK_BOX_PROBE', 'IP_OPS_DEPLOYMENT_OWNER', 'BLACK_BOX_PROBE_V1', 60_000, true),
  telemetry('TEL_TELEMETRY_PIPELINE_SELF_HEALTH', 'SYSTEM_INTEGRATION', 'TELEMETRY_PIPELINE_HEALTH_V1', 15_000, true),
  telemetry('TEL_LEDGER_ADVANCEMENT', 'EXISTING_LEDGER', 'LEDGER_ADVANCEMENT_V1', 15_000, true),
  telemetry('TEL_QUEUE_BACKLOG_DROP', 'INTELLIGENCE_RUNTIME', 'QUEUE_TELEMETRY_V1', 10_000, true),
  telemetry('TEL_EXECUTION_FENCE_EPOCH', 'BACKEND_FOUNDATION_EXECUTION', 'EXECUTION_FENCE_EPOCH_V1', 5_000, true),
]);

/** Template only; bind the tested implementation commit before emitting release evidence. */
export const EXPECTED_INVENTORY_MANIFEST: Readonly<ExpectedInventoryManifest> = Object.freeze({
  schema: 'PRODUCT_ASSURANCE_EXPECTED_INVENTORY_V1',
  revision: 1,
  releaseId: 'IP_ASSURANCE_PRESTAGE_TEMPLATE',
  testedCommit: 'UNBOUND_TESTED_COMMIT',
  generatedAtMs: 1_783_900_800_000,
  components: EXPECTED_CANONICAL_COMPONENTS,
  dependencies: EXPECTED_CANONICAL_DEPENDENCIES,
  controls: EXPECTED_CANONICAL_CONTROLS,
  telemetrySignals: EXPECTED_CANONICAL_TELEMETRY,
  invariantIds: freezeStrings(SAFETY_INVARIANT_CATALOG.map((definition) => definition.invariantId)),
  operationPolicyIds: freezeStrings(OPERATION_POLICY_REGISTRY.map((policy) => policy.operationId)),
  ownerQuestionIds: freezeStrings(OWNER_QUESTION_COVERAGE.map((entry) => entry.questionId)),
});

export const CORE_EXPECTED_INVENTORY_MANIFEST = EXPECTED_INVENTORY_MANIFEST;

export function bindExpectedInventoryManifest(
  releaseId: string,
  testedCommit: string,
  generatedAtMs: number,
): Readonly<ExpectedInventoryManifest> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(releaseId)) throw new TypeError('releaseId is invalid');
  if (!/^[a-f0-9]{40}$/u.test(testedCommit)) throw new TypeError('testedCommit must be a full lowercase Git SHA-1');
  if (!Number.isSafeInteger(generatedAtMs) || generatedAtMs < 0) throw new TypeError('generatedAtMs must be a non-negative UTC millisecond value');
  return Object.freeze({ ...EXPECTED_INVENTORY_MANIFEST, releaseId, testedCommit, generatedAtMs });
}
