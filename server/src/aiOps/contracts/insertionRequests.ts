import { immutableClone, sortedUnique } from './shared.js';

export interface AiOpsInsertionRequestRow {
  readonly schema: 'InsertionRequestRowV1';
  readonly version: 1;
  readonly rowId: string;
  readonly status: 'DRAFT';
  readonly requestedOwner: string;
  readonly targetSeam: string;
  readonly reason: string;
  readonly contract: readonly string[];
  readonly tests: readonly string[];
  readonly expectedBehavior: readonly string[];
  readonly wiringState: `PENDING_BACKEND:${string}`;
  readonly authorityCreated: false;
}

interface RequestSeed {
  readonly rowId: string;
  readonly requestedOwner: string;
  readonly targetSeam: string;
  readonly reason: string;
  readonly contract: readonly string[];
  readonly tests: readonly string[];
  readonly expectedBehavior: readonly string[];
}

// These values are a literal serialization of the A1-owned rows in the
// ratified AIOPS-IR registry at aiops-prestage-20260714@08e0beaa.  The
// surrounding advisory table metadata is intentionally not serialized.
const SEEDS: readonly RequestSeed[] = [
  {
    rowId: 'AIOPS-IR-PERSISTENCE-003',
    requestedOwner: 'LEDGER',
    targetSeam: 'server/src/ledger.ts::Ledger; server/src/systemIntegration/persistence/ledgerAdapter.ts::SystemLedgerPersistenceAdapter; server/src/productIntegration/contracts/ports.ts::ProductLedgerPersistencePort',
    reason: 'Durable AI records must use the sole canonical persistence owner.',
    contract: [
      'Add Ledger migrations/adapters for cases, transitions, inbox, outbox, DLQ, attempts, effects, usage, approvals, evidence hashes and retention pointers.',
    ],
    tests: [
      'Prove backup, restore, restart, replay, compare-and-set conflict and corrupt-record failure behavior.',
    ],
    expectedBehavior: [
      'Zero acknowledged authoritative-record loss',
      'one Ledger',
      'no second store or file journal.',
    ],
  },
  {
    rowId: 'AIOPS-IR-AUTH-004',
    requestedOwner: 'BACKEND_SECURITY_OPERATOR_ACCESS',
    targetSeam: 'server/src/security/access.ts::OperatorAccess; server/src/index.ts::operatorAccess.middleware()',
    reason: 'Human and worker principals require distinct default-deny scopes.',
    contract: [
      'Bind separately authenticated human owner and isolated worker principals to explicit role, tool and provider scopes using non-secret references.',
    ],
    tests: [
      'Prove deny-by-default, role separation, revocation and credential-non-exposure with hostile cross-identity attempts.',
    ],
    expectedBehavior: [
      'No subscription credential reaches application, browser, model, repository or worker context',
      'no inherited identity or fallback authority.',
    ],
  },
  {
    rowId: 'AIOPS-IR-PACKAGE-006',
    requestedOwner: 'FRESH_POST_ACCEPTANCE_INTEGRATOR',
    targetSeam: 'package.json; package-lock.json; server/package.json; web/package.json',
    reason: 'Lane-local work cannot edit shared scripts, dependencies or lockfiles.',
    contract: [
      'Apply only dependency/script deltas named by sealed accepted lane receipts.',
    ],
    tests: [
      'Run lockfile integrity, offline network-free tests, license/security and dependency-necessity checks.',
    ],
    expectedBehavior: [
      'Only reviewed necessary packages/scripts land',
      'lanes remain buildable without hidden network/provider calls.',
    ],
  },
  {
    rowId: 'AIOPS-IR-CONTROLS-008',
    requestedOwner: 'PRODUCT_RUNTIME_SYSTEM_CONTROL_COMMAND_OWNER',
    targetSeam: 'server/src/productIntegration/runtime/controls.ts::buildProductRuntimeControlRegistry; systemControlCommandOwner.ts::ProductRuntimeSystemControlCommandOwner',
    reason: 'Fail-closed AI controls must live under the canonical command owner.',
    contract: [
      'Add ratified AI_OPS-namespaced controls within the immutable server capability ceiling.',
    ],
    tests: [
      'Prove preview/hash/TTL/confirmation/receipt/readback, expiry, replay and hard-denial hostile cases.',
    ],
    expectedBehavior: [
      'UI never becomes authority',
      'forbidden money/safety actions remain unreachable',
      'every effect is owner-receipted.',
    ],
  },
  {
    rowId: 'AIOPS-IR-REMEDIATION-010',
    requestedOwner: 'BACKEND_FOUNDATION_CONTROL',
    targetSeam: 'server/src/productAssurance/remediation/campaign.ts::REMEDIATION_ACTIONS/transitionRemediationCampaign/acquireResourceSet/buildRepairConflictGraph; server/src/productIntegration/runtime/systemControlCommandOwner.ts::ProductRuntimeSystemControlCommandOwner; server/src/services/awsRunnerControl.ts::AwsRunnerControl is REFERENCE_ONLY/NOT_CONFIGURED',
    reason: 'Deterministic campaigns exist only as pure vocabulary and cannot silently become an executor.',
    contract: [
      'Ratify a typed action-request contract, registered runbooks, durable checkpoint and existing-effect-owner bindings',
      'never create an AI executor.',
    ],
    tests: [
      'Prove lease, fence, idempotency, precondition, postcondition, quiet period, checkpoint/restart and forbidden-action failure cases.',
    ],
    expectedBehavior: [
      'OP_LOCAL_REMEDIATION_CAMPAIGN stays unavailable until mounted',
      'effects run only through existing owners',
      'money capabilities remain impossible.',
    ],
  },
  {
    rowId: 'AIOPS-IR-ASSURANCE-011',
    requestedOwner: 'PRODUCT_ASSURANCE',
    targetSeam: 'server/src/productAssurance/failureAtlas/atlas.ts; diagnostics/boundary.ts; S1/S6 accepted packet paths',
    reason: 'Atlas and diagnostic evidence must remain bound to accepted owners and release identity.',
    contract: [
      'Bind accepted Atlas catalog/owner and diagnostic-boundary projections through narrow owner adapters.',
    ],
    tests: [
      'Validate owner/release/tested-commit/subject/digest tuples',
      'run hostile substitution, splice, empty-corpus and fixture-promotion tests.',
    ],
    expectedBehavior: [
      'Synthetic/generated projections never mint live green',
      'missing owner/catalog stays UNKNOWN/MISSING.',
    ],
  },
  {
    rowId: 'AIOPS-IR-INCIDENT-019',
    requestedOwner: 'DIRECTOR_RATIFIED_INCIDENT_OWNER_REQUIRED',
    targetSeam: 'Owner/path MISSING; evidence at server/src/productIntegration/runtime/projection.ts::buildProductRuntimeSupervisorEnvelope',
    reason: 'Incident identity, grouping, fingerprint, severity and lifecycle have no canonical owner.',
    contract: [
      'Director ratifies one owner',
      'A2 supplies only a typed admission projection after ratification.',
    ],
    tests: [
      'Prove grouping, split/merge/reopen/close, acknowledgement races, dedupe, persistence and hostile false-green behavior.',
    ],
    expectedBehavior: [
      'INCIDENT_OWNER_NOT_CONFIGURED changes only with owner receipt',
      'Ledger remains persistence, not policy.',
    ],
  },
  {
    rowId: 'AIOPS-IR-AUDIT-021',
    requestedOwner: 'INDEPENDENT_AUDIT_DELIVERY_OWNER_REQUIRED',
    targetSeam: 'Production owner MISSING; S6 append/retention receipt contracts; canonical Ledger insertion seam',
    reason: 'AI provenance requires independently administered append-only/WORM delivery distinct from sentinel execution.',
    contract: [
      'Ratify audit retention, delivery, readback, chain/hash and restoration contract through the canonical Ledger owner.',
    ],
    tests: [
      'Prove append chain, tamper detection, delivery loss, retention expiry, restore and independent readback.',
    ],
    expectedBehavior: [
      'Audit loss is visible within the signed interval',
      'no worker can rewrite/delete evidence or administer its own audit sink.',
    ],
  },
  {
    rowId: 'AIOPS-IR-APPROVAL-023',
    requestedOwner: 'HUMAN_APPROVAL_OWNER_REQUIRED',
    targetSeam: 'Production owner/path MISSING; Product command preview/result types are evidence only, not a generic ApprovalRequest/ApprovalReceipt owner',
    reason: 'Elevated AI proposals require separately authenticated human approval that no AI/service can satisfy.',
    contract: [
      'Ratify typed approval request/receipt binding artifact, parameters, expiry, principal, reauthentication and execution readback.',
    ],
    tests: [
      'Prove expiry, replay, parameter substitution, AI-as-approver, inherited-chat and credential/role-confusion failures.',
    ],
    expectedBehavior: [
      'Only the authenticated human owner approves',
      'preview is never approval',
      'release service executes only exact approved artifact.',
    ],
  },
  {
    rowId: 'AIOPS-IR-CONFIG-025',
    requestedOwner: 'SERVER_CONFIGURATION_OWNER_AND_I00_OPERATIONS',
    targetSeam: 'server/src/config.ts::DEFAULTS/normalizeConfig/loadConfig/saveConfig; .env.example; ops/templates/i00/env/**',
    reason: 'Provider and worker configuration must be explicit, revocable and separate from secrets.',
    contract: [
      'Add ratified non-secret identity/provider/budget/endpoint bindings',
      'secrets remain external references.',
    ],
    tests: [
      'Prove default NOT_CONFIGURED, invalid config rejection, redaction, save/load round-trip, deconfiguration and no-secret scans.',
    ],
    expectedBehavior: [
      'No provider call from defaults',
      'no secret in repo/log/fixture',
      'missing config remains honest and core deterministic.',
    ],
  },
  {
    rowId: 'AIOPS-IR-TEST-MOUNT-026',
    requestedOwner: 'ROOT_TEST_ACCEPTANCE_OWNER',
    targetSeam: 'package.json::test:all:built; test/i00/complete-acceptance.mjs; server/test/i00Acceptance/**',
    reason: 'Accepted lane gates need one canonical root acceptance mount.',
    contract: [
      'Register sealed lane tests and AI-off/fault gates only after acceptance.',
    ],
    tests: [
      'Run focused lane suites, network-free root suite, complete acceptance, hostile false-green and exact exit-code checks.',
    ],
    expectedBehavior: [
      'Real failures return nonzero',
      'no fake success',
      'accepted counts and commands are recorded in canonical state/receipt.',
    ],
  },
];

// Integrator-owned rows remain explicit dependencies, but A1 must not re-author
// them as lane-owned insertion requests.
export const AI_OPS_EXTERNAL_INTEGRATOR_DEPENDENCY_IDS = Object.freeze([
  'AIOPS-IR-DOCS-017',
  'AIOPS-IR-BARREL-018',
] as const);

export const AI_OPS_INSERTION_REQUESTS: readonly Readonly<AiOpsInsertionRequestRow>[] = immutableClone(SEEDS.map((seed) => ({
  schema: 'InsertionRequestRowV1' as const,
  version: 1 as const,
  rowId: seed.rowId,
  status: 'DRAFT' as const,
  requestedOwner: seed.requestedOwner,
  targetSeam: seed.targetSeam,
  reason: seed.reason,
  contract: seed.contract,
  tests: seed.tests,
  expectedBehavior: seed.expectedBehavior,
  wiringState: `PENDING_BACKEND:${seed.rowId}` as const,
  authorityCreated: false as const,
})));

export function validateInsertionRequests(): readonly string[] {
  const failures: string[] = [];
  const ids = AI_OPS_INSERTION_REQUESTS.map((row) => row.rowId);
  if (new Set(ids).size !== ids.length) failures.push('INSERTION_REQUEST_ID_DUPLICATE');
  for (const row of AI_OPS_INSERTION_REQUESTS) {
    if (!row.rowId.startsWith('AIOPS-IR-')) failures.push(`INSERTION_REQUEST_NAMESPACE_INVALID:${row.rowId}`);
    if (row.wiringState !== `PENDING_BACKEND:${row.rowId}`) failures.push(`INSERTION_REQUEST_WIRING_INVALID:${row.rowId}`);
    if (row.contract.length === 0 || row.tests.length === 0 || row.expectedBehavior.length === 0) failures.push(`INSERTION_REQUEST_EVIDENCE_EMPTY:${row.rowId}`);
    if (row.status !== 'DRAFT' || row.authorityCreated !== false) failures.push(`INSERTION_REQUEST_CREATES_AUTHORITY:${row.rowId}`);
  }
  return sortedUnique(failures);
}
