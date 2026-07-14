import type { L12SupervisorSnapshot } from '../exposureRecoveryProjection/index.js';
import type { MachineGraphEvidenceSnapshot } from '../machineGraphEvidence/index.js';
import type {
  ExternalProofClass,
  ExternalProofEvidenceSnapshot,
  ExternalProofSubject,
} from '../externalProofEvidence/index.js';

export const FINAL_LANE_EVIDENCE_SCHEMA =
  'LIVE_EDGE_FINAL_LANE_EVIDENCE_SNAPSHOT_V1' as const;

export const FINAL_LANE_BRANCH =
  'live-execution-control-proof-20260712' as const;

export const FINAL_LANE_DIRECTOR_ANCHOR =
  '3a8e17be71d21df14f6b236a563cb0595f9eb824' as const;

export const FINAL_LANE_PROTECTED_INPUTS = Object.freeze([
  Object.freeze({
    path: 'DIRECTOR_Q_L_TWO_LANE_LAUNCH.md',
    sha256: '26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06',
  }),
  Object.freeze({
    path: 'LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md',
    sha256: '40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037',
  }),
] as const);

export const FINAL_LANE_SCOPE_GATE_ARTIFACTS = Object.freeze({
  gateScriptSha256: 'f167e2921e627709f0de80332e92314e654a19002f356fe31487858dd28d57c3',
  gateTestSha256: '99edbc4c71b25c4794c8318a62315db8d99abdcfa722dd73dc02f995df2633ee',
  gateTestAssertions: 35,
} as const);

export const FINAL_LANE_ACCEPTED_IDENTITIES = Object.freeze({
  protocolCommit: '73e1a1ff7daa48df8dac45713fc5f106842edafc',
  directorRulingCommit: 'a4a8ebd349e638e047a9ebf20bf6ec170376d08e',
  directorStateCommit: '7ff1fd05584779672690f5058a01b1de573b4ccd',
  l12FinalImplementationCommit: '6d4a330db6047e0b5d384c905b8632617168c71c',
  l12FinalImplementationTree: 'baf3a4de74bf51702a6d8e9dcfaf57d4b843d56a',
  l12ReceiptCommit: '03805c0d2af6cbd90ef22d466896aa3ebc9d4bc5',
  l12ReceiptTree: '6adb4b0b65744410036f74fc29d9af082cc4f02d',
  l12ReceiptBlob: 'da42724376b73116a7fc0535c0b36310b63ad50d',
  l12ReceiptSha256: '15fcaf2d2cf90ca534c4c26ef59560b10b6a4e2549a71ad6d02c7c4abbe8f7b6',
  l12AcceptanceCommit: '9b0d4ad534644273c28d24fec2e18b17717f1167',
  l12AcceptanceTree: 'ebdc7a91260bf453a3961e9905f63ab1cef76c9b',
  l12AcceptanceBlob: 'fb8229ed10901e1d6c845c23f1399297dfc61b1a',
  l12AcceptanceSha256: '63b3c3151510c601fe2a31a953b142b88b170e901892f2162310295d2e66236b',
  l12SnapshotRevision: 'l12_9de531c88241c2bc934c56f43d7ac985',
  l13ImplementationCommit: '2bd645364091684e106770df7f68fa7b720c7c0b',
  l13ImplementationTree: 'c278f58a65b99e3b4c17c3afdd6adfadfe8ccc26',
  l13ReceiptCommit: 'c76e4c3bb90796365cc61f21dadfe1f5afb66f8e',
  l13ReceiptTree: '14ce18a5d6970105df3a9d9a0da2189da5c5a4b2',
  l13ReceiptBlob: '489ce594367a290667936f5e9d3bef787849dc51',
  l13ReceiptSha256: '3b1cc74d2b9e8e8e0d98d702ea6155a1592e5b0b8057dfcf64deae7fb3e4500f',
  l13AcceptanceCommit: '13e5e3f4695c926bae513d3f254e4924970d36df',
  l13AcceptanceTree: '336dc0632060943bff8c3b37dcaa99d688688691',
  l13AcceptanceBlob: '2536490094c06ca6731c48067d732f63d0bdb183',
  l13AcceptanceSha256: '8a87d3a3ab7ac4f7aabe85aaa6cb3b1ff4e85883d83682a7ffb3aa1b2b2d7062',
  l13SnapshotRevision: 'l13_8308d530ac0f5da1918d6bbe6a28f9e8',
  l16ImplementationCommit: '04d7252e5cdd12c6827b42cf8b8e0611600e0b42',
  l16ImplementationTree: '3ba07e8fad103c1594e3a3784a3af2c2537ad026',
  l16ReceiptCommit: '7b831ad56bddbef65c928cc65d3dc7f05cb895da',
  l16ReceiptTree: 'eb41551bed9fcff058296592c52b2589162c96ec',
  l16ReceiptBlob: 'c31c5ecb845deb1295e35ba4381158d6e35e1fdb',
  l16ReceiptSha256: '5c7143da75bfe409569e4e169e71d9817e8a315227a18843f335983605a7a0ac',
  l16AcceptanceCommit: '304b2fd428573ec4eef4846afd1e6578d7c7f93b',
  l16AcceptanceTree: '518bbd5276a4bd3018c446d6051b37a1775dae96',
  l16AcceptanceBlob: 'd58846c7fc4d074561e4129e954a890ff218180d',
  l16AcceptanceSha256: 'cdf44654066c713da8868b1d9260b8f519cd42766a722cf9ef4435435e76cbf1',
  l16EvaluatedAtMs: 1_783_980_101_000,
  l16OrdinarySnapshotRevision: 'l16_d568cea3b66bf198b02c6a37c77acc19',
  l16AcceptedPrefixRevision: 'l16prefix_d9ba911f9129864a44bcc7bf5ad7fbbb',
  l15ReceiptCommit: '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5',
  l15ReceiptTree: 'e401435d6a650aee8a29c3da4495b4db426be017',
  l15WorkCommit: '9a82d4715c73ebe4156638c2bf5e8a2c02373bbf',
  l15ReceiptBlob: '7fc3520d4fede577937c6dd48c191b1e5d212061',
  l15ReceiptRawSha256: 'd5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293',
  l15LocalAssertions: 347,
} as const);

export type FinalLaneAcceptedIdentities = typeof FINAL_LANE_ACCEPTED_IDENTITIES;

export const FINAL_LANE_COMMAND_SPECS = Object.freeze([
  Object.freeze({
    check: 'SCOPE_GATE_TESTS',
    command: 'ops/tests/test-lane-worker-scope-gate.sh',
    assertionRule: 35,
  }),
  Object.freeze({
    check: 'WORKER_SCOPE_GATE',
    command: 'ops/tests/lane-worker-scope-gate.sh',
    assertionRule: null,
  }),
  Object.freeze({
    check: 'SERVER_BUILD',
    command: 'npm run build -w server',
    assertionRule: null,
  }),
  Object.freeze({
    check: 'L17_FOCUSED',
    command: 'node --test --test-concurrency=1 --test-reporter=spec "server/test/liveEdge/finalLaneEvidence/**/*.test.mjs"',
    assertionRule: 23,
  }),
  Object.freeze({
    check: 'IMPORT_PURITY',
    command: 'node --test --test-concurrency=1 --test-reporter=spec server/test/liveEdge/security/import-purity.test.mjs',
    assertionRule: 4,
  }),
  Object.freeze({
    check: 'ACCUMULATED_LIVE_EDGE',
    command: 'node --test --test-concurrency=1 --test-reporter=spec "server/test/liveEdge/**/*.test.mjs"',
    assertionRule: 1618,
  }),
  Object.freeze({
    check: 'PROTOCOL',
    command: 'node packages/edge-protocol-tests/protocol.test.mjs',
    assertionRule: 22,
  }),
  Object.freeze({
    check: 'FOUNDATION_RISK',
    command: 'node server/test/foundation/risk/risk.mjs',
    assertionRule: 884,
  }),
  Object.freeze({
    check: 'FOUNDATION_CONTROL',
    command: 'node server/test/foundation/control/control.mjs',
    assertionRule: 97,
  }),
  Object.freeze({
    check: 'FOUNDATION_EXECUTION',
    command: 'node server/test/foundation/execution/execution.mjs',
    assertionRule: 178,
  }),
  Object.freeze({
    check: 'FOUNDATION_RECONCILIATION',
    command: 'node server/test/foundation/reconciliation/reconciliation.mjs',
    assertionRule: 75,
  }),
  Object.freeze({
    check: 'FOUNDATION_OBSERVABILITY',
    command: 'node server/test/foundation/observability/observability.mjs',
    assertionRule: 130,
  }),
  Object.freeze({
    check: 'FOUNDATION_READ_MODEL',
    command: 'node server/test/foundation/readModel/read-model.mjs',
    assertionRule: 72,
  }),
  Object.freeze({
    check: 'INTEGRATION_BUILT',
    command: 'npm run test:integration:built',
    assertionRule: 180,
  }),
  Object.freeze({
    check: 'NPM_TEST',
    command: 'npm test',
    assertionRule: 377,
  }),
  Object.freeze({
    check: 'TEST_ALL',
    command: 'npm run test:all',
    assertionRule: 2479,
  }),
  Object.freeze({
    check: 'DIFF_CHECK',
    command: 'git diff --check',
    assertionRule: null,
  }),
  Object.freeze({
    check: 'FINAL_WORKER_SCOPE_GATE',
    command: 'ops/tests/lane-worker-scope-gate.sh --final',
    assertionRule: null,
  }),
] as const);

export type FinalLaneCommandCheck = (typeof FINAL_LANE_COMMAND_SPECS)[number]['check'];

export interface FinalLaneCommandEvidence {
  readonly check: FinalLaneCommandCheck;
  readonly command: string;
  readonly sourceRevision: string;
  readonly verifiedAtMs: number;
  readonly exitCode: 0;
  readonly assertions: number | null;
}

export interface FinalLaneProtectedInputEvidence {
  readonly path: (typeof FINAL_LANE_PROTECTED_INPUTS)[number]['path'];
  readonly sha256: (typeof FINAL_LANE_PROTECTED_INPUTS)[number]['sha256'];
  readonly regularFile: true;
  readonly symlink: false;
  readonly untracked: true;
  readonly unstaged: true;
}

export interface FinalLaneScopeGateEvidence {
  readonly schema: 'L_WORKER_SCOPE_GATE_V1';
  readonly command: 'ops/tests/lane-worker-scope-gate.sh --final';
  readonly mode: 'FINAL';
  readonly branch: typeof FINAL_LANE_BRANCH;
  readonly knownAnchor: typeof FINAL_LANE_DIRECTOR_ANCHOR;
  readonly selectedBaseline: string;
  readonly checkedRevision: string;
  readonly gateScriptSha256: typeof FINAL_LANE_SCOPE_GATE_ARTIFACTS.gateScriptSha256;
  readonly gateTestSha256: typeof FINAL_LANE_SCOPE_GATE_ARTIFACTS.gateTestSha256;
  readonly anchorIsAncestor: true;
  readonly baselineOnFirstParent: true;
  readonly baselineHasTwoParents: true;
  readonly baselineSubjectHasExactDirectorPrefix: true;
  readonly classifierCryptographicallyAuthenticatesAuthorship: false;
  readonly workerCommitCount: number;
  readonly committedPathObservations: number;
  readonly trackedDirtyPathCount: 0;
  readonly nonProtectedUntrackedPathCount: 0;
  readonly violations: readonly [];
  readonly protectedInputs: readonly Readonly<FinalLaneProtectedInputEvidence>[];
  readonly checkedAtMs: number;
  readonly exitCode: 0;
}

export const FINAL_OPERATIONAL_SUBJECTS = Object.freeze([
  'ROLLBACK_PROOF',
  'BACKUP_RESTORE_PROOF',
  'CANARY_PREFLIGHT_PROOF',
  'REAL_CANARY_PROOF',
] as const);
export type FinalOperationalSubject = (typeof FINAL_OPERATIONAL_SUBJECTS)[number];

export interface FinalOperationalNonPerformanceEvidence {
  readonly subject: FinalOperationalSubject;
  readonly kind: 'OPERATION_NOT_PERFORMED';
  readonly proofState: 'ABSENT';
  readonly performed: false;
  readonly checkedAtMs: number;
  readonly reasonCodes: readonly string[];
}

export const FINAL_LANE_SUBJECTS = Object.freeze([
  'PROTOCOL_CONFORMANCE',
  'SECURITY_BOUNDARY',
  'SYNTHETIC_FAULT_REPLAY',
  'SERVICE_RESTART',
  'ROLLBACK',
  'BACKUP_RESTORE',
  'CANARY_PREFLIGHT',
  'REAL_CANARY',
  'AWS_CLOUDFLARE_DEPLOYMENT',
  'PUBLIC_RUNTIME_OBSERVATION',
  'PRIVATE_ACCOUNT_RECONCILIATION',
  'SIGNED_TEST_ORDERS',
  'MARGIN_BORROW_REPAY',
  'LIVE_EXECUTION',
  'L15_DEPLOYMENT_SATELLITE',
  'LANE_RUNTIME_WIRING',
  'Q_L_COMBINED_CHAIN',
  'CURRENT_FILTER_ADMISSION',
] as const);
export type FinalLaneSubject = (typeof FINAL_LANE_SUBJECTS)[number];

export type FinalLaneClassification = ExternalProofClass;

export interface FinalLaneClassifiedEvidence {
  readonly subject: FinalLaneSubject;
  readonly classification: FinalLaneClassification;
  readonly sourceSubjects: readonly ExternalProofSubject[];
  readonly reasonCodes: readonly string[];
  readonly provesIntegrated: false;
  readonly provesDeployed: false;
  readonly provesPrivate: false;
  readonly provesTradeReady: false;
  readonly provesLive: false;
  readonly provesProductionReadiness: false;
  readonly provesMoneyMutation: false;
}

export interface FinalLaneL16Lineage {
  readonly sourceSchema: ExternalProofEvidenceSnapshot['schema'];
  readonly sourceVersion: 1;
  readonly sourceSnapshotRevision: string;
  readonly sourceEvaluatedAtMs: number;
  readonly sourceImplementationRevision: typeof FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit;
  readonly l13SourceSnapshotRevision: string;
  readonly l12SourceSnapshotRevision: string;
  readonly sourceFilterAdmissionClass: 'UNPROVEN' | 'FILTER_BLOCKED';
  readonly effectiveFilterAdmissionClass: 'UNPROVEN' | 'FILTER_BLOCKED';
  readonly projectionAuthority: 'INJECTED_EVIDENCE_CLASSIFICATION_ONLY';
  readonly classificationAuthority: 'CLOSED_KIND_MAPPING_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface FinalLaneEvidenceInput {
  readonly evaluatedAtMs: number;
  readonly implementationRevision: string;
  readonly l12Snapshot: Readonly<L12SupervisorSnapshot>;
  readonly l13Snapshot: Readonly<MachineGraphEvidenceSnapshot>;
  readonly l16Snapshot: Readonly<ExternalProofEvidenceSnapshot>;
  readonly identities: Readonly<FinalLaneAcceptedIdentities>;
  readonly scopeGate: Readonly<FinalLaneScopeGateEvidence>;
  readonly commands: readonly Readonly<FinalLaneCommandEvidence>[];
  readonly operationalEvidence: readonly Readonly<FinalOperationalNonPerformanceEvidence>[];
}

export interface FinalLaneEvidenceSnapshot {
  readonly schema: typeof FINAL_LANE_EVIDENCE_SCHEMA;
  readonly version: 1;
  readonly snapshotRevision: string;
  readonly evaluatedAtMs: number;
  readonly implementationRevision: string;
  readonly l16Lineage: Readonly<FinalLaneL16Lineage>;
  readonly identities: Readonly<FinalLaneAcceptedIdentities>;
  readonly scopeGate: Readonly<FinalLaneScopeGateEvidence>;
  readonly commands: readonly Readonly<FinalLaneCommandEvidence>[];
  readonly operationalEvidence: readonly Readonly<FinalOperationalNonPerformanceEvidence>[];
  readonly evidence: readonly Readonly<FinalLaneClassifiedEvidence>[];
  readonly evidenceDisposition: 'LOCAL_GATE_EVIDENCE_COMPLETE';
  readonly acceptanceState: 'PENDING_IMMUTABLE_RECEIPT_ACCEPTANCE';
  readonly evidenceTrust: 'INJECTED_UNATTESTED';
  readonly measurementAuthority: 'INJECTED_RECORD_ONLY';
  readonly laneApplicability: 'L_LANE_LOCAL_ONLY';
  readonly releaseState: 'SYNTHETIC_ONLY';
  readonly integrationState: 'UNWIRED';
  readonly combinedChainState: 'DEFERRED_TO_I00';
  readonly injectedLocalGateEvidenceComplete: true;
  readonly cryptographicAttestation: false;
  readonly gateExecutionObservedByAdapter: false;
  readonly projectionAuthority: 'INJECTED_VALIDATED_EVIDENCE_ONLY';
  readonly classificationAuthority: 'CLOSED_FINAL_MAPPING_ONLY';
  readonly externalCalls: false;
  readonly filesystemAccess: false;
  readonly gitAccess: false;
  readonly environmentAccess: false;
  readonly credentialAccess: 'NONE';
  readonly runnerAuthority: 'NONE';
  readonly controlAuthority: 'NONE';
  readonly deploymentAuthority: 'NONE';
  readonly restartAuthority: 'NONE';
  readonly readinessAuthority: 'NONE';
  readonly actionAuthority: 'NONE';
  readonly sendEligible: false;
  readonly liveExecution: 'LIVE_EXECUTION_NOT_IMPLEMENTED';
  readonly combinedAcceptance: false;
  readonly integratedProof: false;
  readonly deployedProof: false;
  readonly livePublicProof: false;
  readonly livePrivateProof: false;
  readonly tradeReadyProof: false;
  readonly productionReadinessProof: false;
  readonly laneReadyProof: false;
  readonly moneyMutationProof: false;
}
