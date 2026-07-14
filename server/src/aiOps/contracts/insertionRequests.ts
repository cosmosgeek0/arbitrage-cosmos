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
  readonly wiringId: string;
}

const SEEDS: readonly RequestSeed[] = [
  {
    rowId: 'AIOPS-IR-PERSISTENCE-003', requestedOwner: 'LEDGER', targetSeam: 'Ledger and SystemLedgerPersistenceAdapter', reason: 'Policy decisions and AI case records require the existing sole durable persistence owner.', wiringId: 'MOUNT_AI_OPS_LEDGER_ADAPTERS',
    contract: ['Append and compare-and-set through Ledger only.', 'Persist policy digest, decision chain, append receipt and independent readback.', 'No second store or file journal.'],
    tests: ['Restart, replay, conflict, corruption, backup and restore fail closed.', 'Decision-log delivery or readback loss blocks green.'],
    expectedBehavior: ['Zero acknowledged authoritative-record loss.', 'A1 exposes ports and creates no persistence implementation.'],
  },
  {
    rowId: 'AIOPS-IR-AUTH-004', requestedOwner: 'BACKEND_SECURITY_OPERATOR_ACCESS', targetSeam: 'OperatorAccess middleware and worker-principal boundary', reason: 'Three isolated worker identities and the human owner require default-deny role binding.', wiringId: 'BIND_AI_OPS_ISOLATED_PRINCIPALS',
    contract: ['Bind distinct runtime, repair and verifier principals.', 'Retain only non-secret credential references.', 'Deny inheritance, cross-role fallback and advisor credentials.'],
    tests: ['Prove revocation, cross-identity denial and credential non-exposure.', 'Unknown identity and stale binding deny.'],
    expectedBehavior: ['No subscription or API credential enters the application, browser, repository or worker context.'],
  },
  {
    rowId: 'AIOPS-IR-PACKAGE-006', requestedOwner: 'FRESH_POST_ACCEPTANCE_INTEGRATOR', targetSeam: 'Root and workspace package scripts and lockfiles', reason: 'A1 cannot alter shared test scripts, dependencies or lockfiles.', wiringId: 'INTEGRATE_ACCEPTED_AI_OPS_PACKAGE_DELTAS',
    contract: ['Mount only accepted test commands and necessary dependencies.', 'Preserve exact lockfile and offline behavior.'],
    tests: ['Lockfile integrity, license, vulnerability and dependency-necessity checks.', 'Focused tests run without provider or network access.'],
    expectedBehavior: ['No hidden install, lifecycle script, provider call or unreviewed package.'],
  },
  {
    rowId: 'AIOPS-IR-CONTROLS-008', requestedOwner: 'PRODUCT_RUNTIME_SYSTEM_CONTROL_COMMAND_OWNER', targetSeam: 'buildProductRuntimeControlRegistry and ProductRuntimeSystemControlCommandOwner', reason: 'The 120 AI_OPS entries must extend the existing control registry without a second registry.', wiringId: 'INSERT_AI_OPS_NAMESPACED_CONTROLS',
    contract: ['Add AI_OPS namespaced entries under the immutable maximum-authority envelope.', 'Require atomic compare-and-set ControlChangeSet, owner approval and readback.', 'Delegate J and K effects to existing owners.'],
    tests: ['Prove preview, hash, TTL, stale revision, atomicity, rollback and independent readback.', 'All hard denials remain unreachable with every safe control enabled.'],
    expectedBehavior: ['All A1 entries remain NOT_WIRED until handlers and canonical readback exist.', 'No UI or A1 artifact becomes authority.'],
  },
  {
    rowId: 'AIOPS-IR-REMEDIATION-010', requestedOwner: 'BACKEND_FOUNDATION_CONTROL', targetSeam: 'Product Assurance remediation campaign and existing effect owners', reason: 'Class-A runbooks need owner-ratified execution through existing command and remediation seams.', wiringId: 'RATIFY_AI_OPS_RUNBOOK_ACTION_REQUESTS',
    contract: ['Register each action separately with lease, fence, idempotency, bounds and postconditions.', 'Never create an AI executor.'],
    tests: ['Prove retries, conflict graph, restart checkpoint, quiet period and recurrence quarantine.', 'Forbidden and money-adjacent actions deny.'],
    expectedBehavior: ['Unsigned A1 templates grant no authority.', 'Effects run only through existing owners after acceptance.'],
  },
  {
    rowId: 'AIOPS-IR-ASSURANCE-011', requestedOwner: 'PRODUCT_ASSURANCE', targetSeam: 'Failure Atlas and diagnostic-boundary owner adapters', reason: 'A1 reuses S6 evidence grammar and Atlas truth but cannot promote synthetic or generated evidence.', wiringId: 'BIND_ACCEPTED_AI_OPS_ASSURANCE_ADAPTERS',
    contract: ['Validate exact owner, release, tested commit, subject and digest tuples.', 'Keep S6 and AI Ops action-class dialects separate.'],
    tests: ['Hostile substitution, splice, empty corpus and fixture-promotion tests.', 'Unknown owner or catalog remains UNKNOWN or MISSING.'],
    expectedBehavior: ['Reference artifacts never mint live green or acceptance.'],
  },
  {
    rowId: 'AIOPS-IR-DOCS-017', requestedOwner: 'FRESH_POST_ACCEPTANCE_INTEGRATOR', targetSeam: 'STATE.md and ARCHITECTURE.md Part II', reason: 'Exclusive A1 scope forbids canonical state and ownership documentation changes.', wiringId: 'DOCUMENT_ACCEPTED_AI_OPS_MOUNT',
    contract: ['Update canonical state only from accepted SHA and mounted interfaces.', 'Amend authority map only if ownership actually changes.'],
    tests: ['Compare accepted path and SHA manifests to documentation.', 'Reject premature or duplicate-owner claims.'],
    expectedBehavior: ['Shadow artifacts remain SHADOW_SPECULATIVE and absent from canonical component status.'],
  },
  {
    rowId: 'AIOPS-IR-BARREL-018', requestedOwner: 'FRESH_POST_ACCEPTANCE_INTEGRATOR', targetSeam: 'server/src/aiOps/index.ts and shared fixture/test indexes', reason: 'A1 owns no cross-lane barrel or registry.', wiringId: 'CREATE_POST_ACCEPTANCE_AI_OPS_BARRELS',
    contract: ['Export only accepted lane contracts after port and revalidation.', 'Keep imports pure and acyclic.'],
    tests: ['Duplicate contract, overlap, purity and exact accepted-manifest scans.'],
    expectedBehavior: ['No cross-lane export exists from this shadow packet.'],
  },
  {
    rowId: 'AIOPS-IR-INCIDENT-019', requestedOwner: 'DIRECTOR_RATIFIED_INCIDENT_OWNER_REQUIRED', targetSeam: 'Canonical incident identity, fingerprint, severity and lifecycle owner', reason: 'The base has no ratified canonical incident owner.', wiringId: 'RATIFY_CANONICAL_INCIDENT_OWNER',
    contract: ['Ratify exactly one incident policy owner while Ledger remains persistence only.', 'Expose typed admission projection after ratification.'],
    tests: ['Grouping, split, merge, reopen, close, acknowledgement races, dedupe and persistence.', 'Missing owner cannot become green.'],
    expectedBehavior: ['INCIDENT_OWNER_NOT_CONFIGURED remains explicit until an owner receipt exists.'],
  },
  {
    rowId: 'AIOPS-IR-AUDIT-021', requestedOwner: 'INDEPENDENT_AUDIT_DELIVERY_OWNER_REQUIRED', targetSeam: 'Ledger append plus independently administered audit delivery', reason: 'Local hash chains alone do not prove completeness or prevent equivocation.', wiringId: 'RATIFY_AI_OPS_INDEPENDENT_AUDIT_DELIVERY',
    contract: ['Bind append sequence, hash chain, signed checkpoints and receipt references through existing persistence.', 'Workers cannot rewrite, delete or administer audit delivery.'],
    tests: ['Tamper, deletion, reorder, fork, delivery loss, retention expiry and restore.', 'Missing receipt and readback block green.'],
    expectedBehavior: ['Assurance level stays explicit; HASH_CHAIN is never mislabeled as a transparency receipt.'],
  },
  {
    rowId: 'AIOPS-IR-APPROVAL-023', requestedOwner: 'HUMAN_APPROVAL_OWNER_REQUIRED', targetSeam: 'Typed human approval request and receipt owner', reason: 'Neither A1 nor command preview can approve elevated proposals or sign runbooks.', wiringId: 'RATIFY_AI_OPS_HUMAN_APPROVAL_OWNER',
    contract: ['Bind exact artifact, parameters, principal, expiry, policy and execution readback.', 'AI and service identities cannot satisfy owner approval.'],
    tests: ['Expiry, replay, substitution, self-approval, inherited-chat and role-confusion failures.'],
    expectedBehavior: ['Unsigned runbooks and policy bundles remain ineligible for activation.'],
  },
  {
    rowId: 'AIOPS-IR-CONFIG-025', requestedOwner: 'SERVER_CONFIGURATION_OWNER_AND_I00_OPERATIONS', targetSeam: 'Server config and I00 non-secret deployment bindings', reason: 'Provider states, identity bindings and budgets need explicit revocable configuration.', wiringId: 'ADD_AI_OPS_NON_SECRET_CONFIGURATION',
    contract: ['Default to NOT_CONFIGURED.', 'Store only non-secret identity, provider, budget and endpoint references.', 'Never silently change billing domain.'],
    tests: ['Invalid config, redaction, round trip, deconfiguration, auth-mode conflict and no-secret scans.'],
    expectedBehavior: ['Missing or unverifiable provider truth stays NOT_CONFIGURED or DIAGNOSTIC_PLANE_UNAVAILABLE.'],
  },
  {
    rowId: 'AIOPS-IR-TEST-MOUNT-026', requestedOwner: 'ROOT_TEST_ACCEPTANCE_OWNER', targetSeam: 'package.json test gates, I00 acceptance and Product Assurance operation manifest', reason: 'Root scripts do not discover test/aiOps/contracts and the operation manifest pins the pre-A1 scan count.', wiringId: 'MOUNT_ACCEPTED_AI_OPS_TESTS_AND_REGENERATE_MANIFEST',
    contract: ['Register the accepted focused suite in canonical root acceptance.', 'Regenerate Product Assurance operation manifest only from the accepted ported SHA.', 'Retain exact real exit codes.'],
    tests: ['Focused, network-denied, root, complete acceptance and hostile false-green gates.', 'Verify exact changed paths and scan count.'],
    expectedBehavior: ['Current aggregate PRODUCT_ASSURANCE_OPERATION_SCAN_INVALID is an expected integration blocker, never hidden.', 'No fake-success wrapper.'],
  },
];

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
  wiringState: `PENDING_BACKEND:${seed.wiringId}` as const,
  authorityCreated: false as const,
})));

export function validateInsertionRequests(): readonly string[] {
  const failures: string[] = [];
  const ids = AI_OPS_INSERTION_REQUESTS.map((row) => row.rowId);
  if (new Set(ids).size !== ids.length) failures.push('INSERTION_REQUEST_ID_DUPLICATE');
  for (const row of AI_OPS_INSERTION_REQUESTS) {
    if (!row.rowId.startsWith('AIOPS-IR-')) failures.push(`INSERTION_REQUEST_NAMESPACE_INVALID:${row.rowId}`);
    if (!row.wiringState.startsWith('PENDING_BACKEND:')) failures.push(`INSERTION_REQUEST_WIRING_INVALID:${row.rowId}`);
    if (row.contract.length === 0 || row.tests.length === 0 || row.expectedBehavior.length === 0) failures.push(`INSERTION_REQUEST_EVIDENCE_EMPTY:${row.rowId}`);
    if (row.status !== 'DRAFT' || row.authorityCreated !== false) failures.push(`INSERTION_REQUEST_CREATES_AUTHORITY:${row.rowId}`);
  }
  return sortedUnique(failures);
}
