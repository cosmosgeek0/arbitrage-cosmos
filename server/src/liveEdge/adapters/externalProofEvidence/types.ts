import type { L12SupervisorSnapshot } from '../exposureRecoveryProjection/index.js';
import type { MachineGraphEvidenceSnapshot } from '../machineGraphEvidence/index.js';
import type {
  BinanceInstrumentEnvironment,
  BinanceInstrumentProduct,
  BinanceInstrumentRegistrySnapshot,
  InstrumentSizingRequest,
  InstrumentSizingResult,
} from '../binanceInstrumentSpecs/index.js';

export const EXTERNAL_PROOF_EVIDENCE_SCHEMA =
  'LIVE_EDGE_EXTERNAL_PROOF_EVIDENCE_SNAPSHOT_V1' as const;

export const EXTERNAL_PROOF_SUBJECTS = Object.freeze([
  'LOCAL_BUILD_AND_TESTS',
  'SYNTHETIC_FAULT_AND_REPLAY',
  'LANE_RUNTIME_WIRING',
  'L15_DEPLOYMENT_ARTIFACTS',
  'PUBLIC_RUNTIME_OBSERVATION',
  'PRIVATE_ACCOUNT_AND_RECONCILIATION_TRUTH',
  'DEPLOYED_EC2_APPLICATION_AND_COCKPIT',
  'CLOUDFLARE_TUNNEL_AND_ACCESS',
  'SERVICE_RESTART_AND_DEGRADED_BEHAVIOR',
  'SPOT_SIGNED_TEST_ORDER',
  'USD_M_SIGNED_TEST_ORDER',
  'MARGIN_SIGNED_TEST_ORDER',
  'MARGIN_BORROW_AND_REPAY',
  'LIVE_ORDER',
  'STRATEGY_LIVE_TICKET',
  'I00_COMBINED_FAN_IN',
  'CURRENT_FILTER_ADMISSION',
] as const);
export type ExternalProofSubject = (typeof EXTERNAL_PROOF_SUBJECTS)[number];

export const EXTERNAL_PROOF_EVIDENCE_KINDS = Object.freeze([
  'LOCAL_VERIFICATION',
  'DETERMINISTIC_REPLAY',
  'ADAPTER_INTEGRATION_STATE',
  'L15_SATELLITE_ACCEPTANCE',
  'EXTERNAL_AUTHORIZATION_GAP',
  'ABSENT_RUNTIME_EVIDENCE',
  'REPOSITORY_POLICY_BLOCK',
  'EXTERNAL_NON_PERFORMANCE',
  'I00_INTEGRATION_DEFERRAL',
  'CURRENT_OWNER_FILTER_VERDICT',
] as const);
export type ExternalProofEvidenceKind = (typeof EXTERNAL_PROOF_EVIDENCE_KINDS)[number];

export const EXTERNAL_PROOF_CLASSES = Object.freeze([
  'PROVED_LOCAL',
  'SYNTHETIC_REPLAY',
  'UNWIRED',
  'ACCEPTED_SATELLITE',
  'OWNER_GATED',
  'UNPROVEN',
  'PROHIBITED',
  'NOT_PERFORMED',
  'DEFERRED_TO_I00',
  'FILTER_BLOCKED',
] as const);
export type ExternalProofClass = (typeof EXTERNAL_PROOF_CLASSES)[number];

export const EXTERNAL_PROOF_CLASS_BY_KIND = Object.freeze({
  LOCAL_VERIFICATION: 'PROVED_LOCAL',
  DETERMINISTIC_REPLAY: 'SYNTHETIC_REPLAY',
  ADAPTER_INTEGRATION_STATE: 'UNWIRED',
  L15_SATELLITE_ACCEPTANCE: 'ACCEPTED_SATELLITE',
  EXTERNAL_AUTHORIZATION_GAP: 'OWNER_GATED',
  ABSENT_RUNTIME_EVIDENCE: 'UNPROVEN',
  REPOSITORY_POLICY_BLOCK: 'PROHIBITED',
  EXTERNAL_NON_PERFORMANCE: 'NOT_PERFORMED',
  I00_INTEGRATION_DEFERRAL: 'DEFERRED_TO_I00',
  CURRENT_OWNER_FILTER_VERDICT: 'FILTER_BLOCKED',
} as const satisfies Readonly<Record<ExternalProofEvidenceKind, ExternalProofClass>>);

export const L15_SATELLITE_EVIDENCE = Object.freeze({
  receiptCommit: '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5',
  receiptTree: 'e401435d6a650aee8a29c3da4495b4db426be017',
  workCommit: '9a82d4715c73ebe4156638c2bf5e8a2c02373bbf',
  receiptBlob: '7fc3520d4fede577937c6dd48c191b1e5d212061',
  receiptRawSha256: 'd5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293',
  localAssertions: 347,
} as const);

export const EXTERNAL_ACTION_CLASSES = Object.freeze([
  'READ_ONLY_PRIVATE_BINANCE_ACCESS',
  'SIGNED_RECONCILIATION_READ',
  'AWS_CLOUDFLARE_CONFIGURATION',
  'EC2_DEPLOY',
  'SERVICE_RESTART',
] as const);
export type ExternalActionClass = (typeof EXTERNAL_ACTION_CLASSES)[number];

export interface ExternalProofEvidenceBase {
  readonly subject: ExternalProofSubject;
  readonly evidenceId: string;
  readonly reasonCodes: readonly string[];
}

export interface LocalVerificationCheck {
  readonly check:
    | 'SERVER_BUILD'
    | 'L16_FOCUSED'
    | 'IMPORT_PURITY'
    | 'ACCUMULATED_LIVE_EDGE'
    | 'PROTOCOL'
    | 'NPM_TEST'
    | 'TEST_ALL'
    | 'DIFF_CHECK';
  readonly exitCode: 0;
  readonly assertions: number | null;
}

export interface LocalVerificationEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'LOCAL_VERIFICATION';
  readonly sourceRevision: string;
  readonly verifiedAtMs: number;
  readonly checks: readonly Readonly<LocalVerificationCheck>[];
}

export interface DeterministicReplayEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'DETERMINISTIC_REPLAY';
  readonly authority: 'SYNTHETIC_TEST';
  readonly sourceRevision: string;
  readonly verifiedAtMs: number;
  readonly exitCode: 0;
  readonly scenarioCount: number;
  readonly assertions: number;
  readonly deterministic: true;
  readonly networkFree: true;
}

export interface AdapterIntegrationStateEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'ADAPTER_INTEGRATION_STATE';
  readonly sourceRevision: string;
  readonly integrationState: 'UNWIRED';
  readonly runtimeCompositionObserved: false;
}

export interface L15SatelliteAcceptanceEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'L15_SATELLITE_ACCEPTANCE';
  readonly receiptCommit: typeof L15_SATELLITE_EVIDENCE.receiptCommit;
  readonly receiptTree: typeof L15_SATELLITE_EVIDENCE.receiptTree;
  readonly workCommit: typeof L15_SATELLITE_EVIDENCE.workCommit;
  readonly receiptBlob: typeof L15_SATELLITE_EVIDENCE.receiptBlob;
  readonly receiptRawSha256: typeof L15_SATELLITE_EVIDENCE.receiptRawSha256;
  readonly localAssertions: typeof L15_SATELLITE_EVIDENCE.localAssertions;
  readonly acceptedSatellite: true;
  readonly merged: false;
  readonly wired: false;
  readonly deployed: false;
  readonly live: false;
}

export interface ExternalAuthorizationGapEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'EXTERNAL_AUTHORIZATION_GAP';
  readonly expectedActionClass: ExternalActionClass;
  readonly authorizationState: 'MISSING' | 'EXPIRED' | 'WRONG_CLASS';
  readonly observedActionClass: ExternalActionClass | null;
  readonly authorizationExpiresAtMs: number | null;
  readonly checkedAtMs: number;
}

export interface AbsentRuntimeEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'ABSENT_RUNTIME_EVIDENCE';
  readonly requiredProof:
    | 'DEPLOYED_APP_AND_COCKPIT'
    | 'CLOUDFLARE_ORIGIN_AND_ACCESS'
    | 'CURRENT_FILTER_OWNER_VERDICT';
  readonly evidenceState: 'ABSENT';
  readonly infrastructureSignal: 'NONE' | 'EC2_STATUS_OK_ONLY' | 'TUNNEL_HEALTHY_ONLY';
  readonly checkedAtMs: number;
}

export interface RepositoryPolicyBlockEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'REPOSITORY_POLICY_BLOCK';
  readonly policy:
    | 'NO_SIGNED_TEST_ORDERS'
    | 'NO_BORROW_REPAY'
    | 'LIVE_EXECUTION_NOT_IMPLEMENTED';
  readonly performed: false;
  readonly checkedAtMs: number;
}

export interface ExternalNonPerformanceEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'EXTERNAL_NON_PERFORMANCE';
  readonly actionClass: 'PUBLIC_RUNTIME_OBSERVATION';
  readonly performed: false;
  readonly checkedAtMs: number;
}

export interface I00IntegrationDeferralEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'I00_INTEGRATION_DEFERRAL';
  readonly target: 'I00';
  readonly integrationState: 'DEFERRED';
  readonly merged: false;
  readonly wired: false;
  readonly deployed: false;
}

export interface FilterAdmissionIdentity {
  readonly product: BinanceInstrumentProduct;
  readonly environment: BinanceInstrumentEnvironment;
  readonly snapshotRevision: string;
  readonly request: Readonly<InstrumentSizingRequest>;
}

export interface CurrentOwnerFilterVerdictEvidence extends ExternalProofEvidenceBase {
  readonly kind: 'CURRENT_OWNER_FILTER_VERDICT';
  readonly expectedSubject: Readonly<FilterAdmissionIdentity>;
  readonly ownerSnapshot: Readonly<BinanceInstrumentRegistrySnapshot>;
  readonly ownerResult: Readonly<InstrumentSizingResult>;
}

export type ExternalProofEvidenceRecord =
  | LocalVerificationEvidence
  | DeterministicReplayEvidence
  | AdapterIntegrationStateEvidence
  | L15SatelliteAcceptanceEvidence
  | ExternalAuthorizationGapEvidence
  | AbsentRuntimeEvidence
  | RepositoryPolicyBlockEvidence
  | ExternalNonPerformanceEvidence
  | I00IntegrationDeferralEvidence
  | CurrentOwnerFilterVerdictEvidence;

export interface ExternalProofLineageBinding {
  readonly sourceSchema: MachineGraphEvidenceSnapshot['schema'];
  readonly sourceVersion: 1;
  readonly sourceSnapshotRevision: string;
  readonly sourceAssembledAtMs: number;
  readonly l12SourceSnapshotRevision: string;
  readonly projectionAuthority: 'OWNER_EVIDENCE_ADAPTER_ONLY';
  readonly truthClass: 'SYNTHETIC_ONLY_UNWIRED';
  readonly readinessAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface ClassifiedExternalProofEvidence {
  readonly subject: ExternalProofSubject;
  readonly classification: ExternalProofClass;
  readonly evidence: Readonly<ExternalProofEvidenceRecord>;
  readonly provesLocal: boolean;
  readonly provesSyntheticReplay: boolean;
  readonly provesAcceptedSatellite: boolean;
  readonly provesMerged: false;
  readonly provesWired: false;
  readonly provesDeployed: false;
  readonly provesLivePublic: false;
  readonly provesLivePrivate: false;
  readonly provesReadiness: false;
  readonly provesMoneyMutation: false;
}

export interface ExternalProofEvidenceInput {
  readonly evaluatedAtMs: number;
  readonly implementationRevision: string;
  readonly l12Snapshot: Readonly<L12SupervisorSnapshot>;
  readonly l13Snapshot: Readonly<MachineGraphEvidenceSnapshot>;
  readonly evidence: readonly Readonly<ExternalProofEvidenceRecord>[];
}

export interface ExternalProofEvidenceSnapshot {
  readonly schema: typeof EXTERNAL_PROOF_EVIDENCE_SCHEMA;
  readonly version: 1;
  readonly snapshotRevision: string;
  readonly evaluatedAtMs: number;
  readonly implementationRevision: string;
  readonly lineage: Readonly<ExternalProofLineageBinding>;
  readonly evidence: readonly Readonly<ClassifiedExternalProofEvidence>[];
  readonly projectionAuthority: 'INJECTED_EVIDENCE_CLASSIFICATION_ONLY';
  readonly classificationAuthority: 'CLOSED_KIND_MAPPING_ONLY';
  readonly externalCalls: false;
  readonly credentialAccess: 'NONE';
  readonly runnerAuthority: 'NONE';
  readonly deployAuthority: 'NONE';
  readonly readinessAuthority: 'NONE';
  readonly actionAuthority: 'NONE';
  readonly sendEligible: false;
  readonly liveExecution: 'LIVE_EXECUTION_NOT_IMPLEMENTED';
  readonly deployedProof: false;
  readonly livePublicProof: false;
  readonly livePrivateProof: false;
  readonly readinessProof: false;
  readonly moneyMutationProof: false;
}
