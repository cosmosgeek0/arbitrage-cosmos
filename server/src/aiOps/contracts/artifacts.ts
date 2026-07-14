import {
  AI_OPS_ACTION_CLASS_DEFINITIONS,
  AI_OPS_ALLOWED_CAPABILITIES_BY_ROLE,
  AI_OPS_HARD_DENIALS,
  AI_OPS_HARD_DENIAL_IDS,
  AI_OPS_LIVE_EXECUTION_STATE,
  AI_OPS_PROVIDER_STATES,
  type AiOpsIdentityRole,
  type AiOpsPermissionLevel,
} from './authority.js';
import { generateClassificationManifest, type AiOpsClassificationResource } from './classification.js';
import { AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS } from './controls.js';
import { AI_OPS_IDENTITIES, AI_OPS_PROVIDER_CREDENTIAL_MATRIX } from './identity.js';
import { AI_OPS_INSERTION_REQUESTS } from './insertionRequests.js';
import { AI_OPS_DECISION_LOG_DESIGN_FIXTURE, AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE } from './policy.js';
import { AI_OPS_CAPABILITY_RELIABILITY_TARGETS, AI_OPS_RUNBOOK_TEMPLATES } from './runbooks.js';
import { AI_OPS_ADAPTED_SCHEMA_BUNDLE } from './schemas.js';
import { AI_OPS_SHADOW_BASE_SHA, immutableClone, sealArtifact, sha256Canonical } from './shared.js';

export interface AiOpsEntryInventoryRow {
  readonly entryId: string;
  readonly mappedRequirement: string;
  readonly owner: string;
  readonly path: string;
  readonly revision: string;
  readonly digestAlgorithm: 'GIT_BLOB_SHA1' | 'GIT_COMMIT_SHA1' | 'SHA-256';
  readonly digest: string;
  readonly disposition: 'REUSE' | 'ADAPT' | 'REFERENCE_ONLY' | 'REJECT_DUPLICATE' | 'MISSING_REQUIRED';
  readonly currentStatus: string;
  readonly testEntrypoints: readonly string[];
  readonly insertionRequestIds: readonly string[];
  readonly resolvedAtShadowBase: boolean;
  readonly authorityCreated: false;
}

type AiOpsEntryInventoryInput = Omit<AiOpsEntryInventoryRow, 'mappedRequirement' | 'currentStatus' | 'testEntrypoints' | 'insertionRequestIds'>
  & Partial<Pick<AiOpsEntryInventoryRow, 'mappedRequirement' | 'currentStatus' | 'testEntrypoints' | 'insertionRequestIds'>>;

const ENTRY_STATUS_BY_DISPOSITION: Readonly<Record<AiOpsEntryInventoryRow['disposition'], string>> = Object.freeze({
  REUSE: 'PRESENT_REUSE_BOUND',
  ADAPT: 'PRESENT_NARROW_ADAPTER_DONOR',
  REFERENCE_ONLY: 'PRESENT_REFERENCE_ONLY',
  REJECT_DUPLICATE: 'DUPLICATE_AUTHORITY_FORBIDDEN',
  MISSING_REQUIRED: 'UNFINISHED_INTERFACE_DEPENDENCY',
});

function inventoryRow(row: AiOpsEntryInventoryInput): Readonly<AiOpsEntryInventoryRow> {
  return {
    entryId: row.entryId,
    mappedRequirement: row.mappedRequirement ?? row.entryId,
    owner: row.owner,
    path: row.path,
    revision: row.revision,
    digestAlgorithm: row.digestAlgorithm,
    digest: row.digest,
    disposition: row.disposition,
    currentStatus: row.currentStatus ?? ENTRY_STATUS_BY_DISPOSITION[row.disposition],
    testEntrypoints: row.testEntrypoints ?? ['test/aiOps/contracts/artifacts-purity.test.mjs'],
    insertionRequestIds: row.insertionRequestIds ?? [],
    resolvedAtShadowBase: row.resolvedAtShadowBase,
    authorityCreated: false,
  };
}

const AI_OPS_ENTRY_INVENTORY_INPUTS: readonly AiOpsEntryInventoryInput[] = [
  { entryId: 'foundation.canonical-json', owner: 'FOUNDATION', path: 'server/src/foundation/contracts/identity.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '4f4aac43a685f9a4f3635e7eabcc0610917ea761', disposition: 'REUSE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'foundation.time', owner: 'FOUNDATION', path: 'server/src/foundation/contracts/time.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7672fbfc23a286ac856348dbf244dcab2c937672', disposition: 'REUSE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'foundation.failures', owner: 'FOUNDATION', path: 'server/src/foundation/contracts/failures.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '988c23c17bfacec2b32ea96744f42498dc9d9da0', disposition: 'REUSE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.diagnostic-boundary', owner: 'PRODUCT_ASSURANCE', path: 'server/src/productAssurance/diagnostics/boundary.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7b6b92a4fcbcc15d22b90d35f1244427fa1b0eab', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.catalog-core', owner: 'PRODUCT_ASSURANCE', path: 'server/src/productAssurance/catalog/core.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'b777635f1eeb4d92882e86ae0789086425603653', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.operations-policy', owner: 'PRODUCT_ASSURANCE', path: 'server/src/productAssurance/operations/policy.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'd63a7c9001dc9296ce9d02bd7bcf1854ac56883a', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.remediation-campaign', owner: 'PRODUCT_ASSURANCE', path: 'server/src/productAssurance/remediation/campaign.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '5b858894af4e31af0922a5e84e07b9cd795caf20', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.failure-atlas', owner: 'PRODUCT_ASSURANCE', path: 'server/src/productAssurance/failureAtlas/atlas.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '30ee43149328ede255acb5421324e64819fc6f01', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's6.boundary-schema', owner: 'IP_ASSURANCE_S6', path: 'fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json', revision: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '042456c58b1cd5b6eb179c0c9c289f6e69d06034', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's6.canonical-kernel', owner: 'IP_ASSURANCE_S6', path: 'fixtures/productAssurance/systemic/agentBoundary/canonical.mjs', revision: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '6336ad5613e16af2dd4147cd27ab63d5042e743b', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's6.evaluators', owner: 'IP_ASSURANCE_S6', path: 'fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs', revision: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '9d8399e6c0d2a74a892bf759342a75e40eabd867', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's6.provider-stub', owner: 'IP_ASSURANCE_S6', path: 'fixtures/productAssurance/systemic/agentBoundary/provider-stub.mjs', revision: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437', digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'f9d53717160f892685851c2f84e961b74b8f1347', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's6.insertion-draft', owner: 'IP_ASSURANCE_S6', path: 'fixtures/productAssurance/systemic/agentBoundary/ASSURANCE_INSERTION_REQUEST_DRAFT.json', revision: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '0489eee2f468cb328bbff8a6c3de44a4b9478cc5', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's6.owner-law', owner: 'IP_ASSURANCE_OWNER', path: 'IP_ASSURANCE.md', revision: 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '308a7b90a3a75a707bb22a8880ee02b6acef9675', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.generated-atlas', owner: 'PRODUCT_ASSURANCE', path: 'fixtures/productAssurance/generated/OPERATIONAL_FAILURE_ATLAS.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'cee6e95858726e088210d3e4f7deafc5e8accf03', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-runtime.types', owner: 'PRODUCT_INTEGRATION_RUNTIME', path: 'server/src/productIntegration/runtime/types.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'ea2dfc4ab36626ea5945cbf45f144b253944866b', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-runtime.controls', owner: 'PRODUCT_RUNTIME_SYSTEM_CONTROL_COMMAND_OWNER', path: 'server/src/productIntegration/runtime/controls.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '5338ceace7e97b51045b6928fd0c6c287d58093c', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-runtime.command-owner', owner: 'PRODUCT_RUNTIME_SYSTEM_CONTROL_COMMAND_OWNER', path: 'server/src/productIntegration/runtime/systemControlCommandOwner.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7dca4a1cb3c11f8a468d71d808a2933329b9538f', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'system-control.types', owner: 'FOUNDATION_CONTROL', path: 'server/src/systemIntegration/controls/types.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'db2d73885fa3fa276fcf181293820902bf009d10', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'ledger.adapter', owner: 'LEDGER', path: 'server/src/systemIntegration/persistence/ledgerAdapter.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'ef035124b0a2e7c63beed8ac2284365599de988b', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'ledger.owner', owner: 'LEDGER', path: 'server/src/ledger.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'cb2433266dde597de22b873db68c4e5c33d34a1b', disposition: 'REUSE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'root.package', mappedRequirement: 'Accepted root test and package mount', owner: 'FRESH_POST_ACCEPTANCE_INTEGRATOR', path: 'package.json', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '99728adf274e3b150c6aa263d3150726e93bef95', disposition: 'MISSING_REQUIRED', insertionRequestIds: ['AIOPS-IR-PACKAGE-006'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'i00.product-assurance-manifest', mappedRequirement: 'Accepted Product Assurance scan-manifest regeneration', owner: 'ROOT_TEST_ACCEPTANCE_OWNER', path: 'fixtures/i00/product-assurance-manifest.v1.json', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '07b6192b9842e70d256884b81ab8d1368e27e180', disposition: 'MISSING_REQUIRED', insertionRequestIds: ['AIOPS-IR-TEST-MOUNT-026'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'i00.section14.owner-law', mappedRequirement: 'I00 section 14 durable self-healing registry owner law', owner: 'OWNER', path: '/Users/cosmosgeek/Desktop/Main/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', revision: 'owner-file-20260714', digestAlgorithm: 'SHA-256', digest: '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: false, authorityCreated: false },
  { entryId: 'i00.section20.owner-law', mappedRequirement: 'I00 section 20 diagnostic-provider external authorization owner law', owner: 'OWNER', path: '/Users/cosmosgeek/Desktop/Main/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', revision: 'owner-file-20260714', digestAlgorithm: 'SHA-256', digest: '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: false, authorityCreated: false },
  { entryId: 'i00.self-healing-registry', mappedRequirement: 'I00 section 14 durable self-healing registry', owner: 'I00_ACCEPTANCE_OWNER', path: 'I00_PRODUCT_BUILD_STATE.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '97c28d71a1f9b6986e4b00ae18d2e0df9943bef5', disposition: 'REFERENCE_ONLY', currentStatus: 'SOURCE_FROZEN_LOCAL_ACCEPTANCE_PENDING', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.autonomic-reconcile-kernel', mappedRequirement: 'Bounded autonomic reconcile kernel', owner: 'PRODUCT_ASSURANCE_REMEDIATION', path: 'server/src/productAssurance/remediation/campaign.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '5b858894af4e31af0922a5e84e07b9cd795caf20', disposition: 'ADAPT', insertionRequestIds: ['AIOPS-IR-REMEDIATION-010'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.runtime-assurance-separation', mappedRequirement: 'Runtime-assurance separation', owner: 'PRODUCT_ASSURANCE_DIAGNOSTICS', path: 'server/src/productAssurance/diagnostics/boundary.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7b6b92a4fcbcc15d22b90d35f1244427fa1b0eab', disposition: 'ADAPT', insertionRequestIds: ['AIOPS-IR-ASSURANCE-011'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'ip-assurance.subordinate-llm-plane', mappedRequirement: 'Subordinate LLM diagnostic and repair-assistance plane', owner: 'IP_ASSURANCE_S6', path: 'fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json', revision: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '042456c58b1cd5b6eb179c0c9c289f6e69d06034', disposition: 'ADAPT', insertionRequestIds: ['AIOPS-IR-ASSURANCE-011'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'i00.provider-authorization', mappedRequirement: 'I00 section 20 diagnostic-provider external authorization', owner: 'BACKEND_SECURITY_OPERATOR_ACCESS', path: 'I00_PRODUCT_BUILD_STATE.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '97c28d71a1f9b6986e4b00ae18d2e0df9943bef5', disposition: 'MISSING_REQUIRED', currentStatus: 'NOT_CONFIGURED_AND_NO_REAL_PROVIDER_AUTH', insertionRequestIds: ['AIOPS-IR-AUTH-004', 'AIOPS-IR-CONFIG-025'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'i00.acceptance-phases', mappedRequirement: 'I00 phases I02 I03 I04 I08 I09 I10 I11 I13 I14 and section 27 acceptance', owner: 'I00_ACCEPTANCE_OWNER', path: 'I00_PRODUCT_BUILD_STATE.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '97c28d71a1f9b6986e4b00ae18d2e0df9943bef5', disposition: 'MISSING_REQUIRED', currentStatus: 'SOURCE_FROZEN_LOCAL_ACCEPTANCE_PENDING_NOT_ACCEPTED', insertionRequestIds: ['AIOPS-IR-DOCS-017', 'AIOPS-IR-BARREL-018', 'AIOPS-IR-TEST-MOUNT-026'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'ip-assurance.sections-3.1-3.9', mappedRequirement: 'IP Assurance sections 3.1 through 3.9', owner: 'IP_ASSURANCE_OWNER', path: 'IP_ASSURANCE.md', revision: 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '308a7b90a3a75a707bb22a8880ee02b6acef9675', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'ip-assurance.systemic-s6', mappedRequirement: 'IP Assurance Systemic Amendment section 7 S6', owner: 'IP_ASSURANCE_S6', path: 'IP_ASSURANCE.md', revision: 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '308a7b90a3a75a707bb22a8880ee02b6acef9675', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'ip-assurance.systemic-s8', mappedRequirement: 'IP Assurance Systemic Amendment section 9 S8', owner: 'IP_ASSURANCE_S8', path: 'IP_ASSURANCE.md', revision: 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6', digestAlgorithm: 'GIT_BLOB_SHA1', digest: '308a7b90a3a75a707bb22a8880ee02b6acef9675', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's8.stability-contracts', mappedRequirement: 'Integrated S8 stability contracts', owner: 'IP_ASSURANCE_S8', path: 'fixtures/productAssurance/systemic/stability/contracts.mjs', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'df43a8426691a7c73b4402d9f9cc96247876ae84', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 's8.stability-integration-receipt', mappedRequirement: 'Integrated S8 stability donor receipt', owner: 'I00_INTEGRATOR', path: 'docs/archive/i00-phase2/A_STABILITY_INTEGRATION_RECEIPT.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '958f03f5d463bc2790499e06ce814a0f5a1d56ff', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'product-assurance.generated-diagnostic-boundary', mappedRequirement: 'AGENTIC_DIAGNOSTIC_BOUNDARY.md', owner: 'PRODUCT_ASSURANCE', path: 'fixtures/productAssurance/generated/AGENTIC_DIAGNOSTIC_BOUNDARY.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '1088ead1bea2854beb52bb41b29aae51e663dff3', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'i00.donor-receipt.a-agent', mappedRequirement: 'Integrated A-AGENT and S6 donor receipt', owner: 'I00_INTEGRATOR', path: 'docs/archive/i00-phase2/A_AGENT_INTEGRATION_RECEIPT.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'f3657fa8a31f91caeb36b5229ad0fd61806e9bf6', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'i00.donor-receipt.a-case', mappedRequirement: 'Integrated canonical case donor receipt', owner: 'I00_INTEGRATOR', path: 'docs/archive/i00-phase2/A_CASE_INTEGRATION_RECEIPT.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'dc7a70f25520b8bbf5423e217fc081226f29c676', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'i00.donor-receipt.a-cockpit', mappedRequirement: 'Integrated canonical cockpit donor receipt', owner: 'I00_INTEGRATOR', path: 'docs/archive/i00-phase2/A_COCKPIT_INTEGRATION_RECEIPT.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'a6aae22e16c54682fad77ff34acf5aee0b94de99', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.incident-owner', mappedRequirement: 'Canonical incident identity and lifecycle owner', owner: 'DIRECTOR_RATIFIED_INCIDENT_OWNER_REQUIRED', path: 'server/src/productIntegration/runtime/managedInventory.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'e1496fc9416f60a06f97ab5cd807a5e6580537e7', disposition: 'MISSING_REQUIRED', currentStatus: 'INCIDENT_OWNER_NOT_CONFIGURED', insertionRequestIds: ['AIOPS-IR-INCIDENT-019'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.material-event-owner', mappedRequirement: 'Canonical material-event delivery owner', owner: 'PRODUCT_INTEGRATION_RUNTIME', path: 'server/src/productIntegration/runtime/materialDelivery.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7ac5cf1b743e650de54fa9f8f00fbadb4842a47a', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.approval-owner', mappedRequirement: 'Existing capital approval owner; not the missing human AI Ops signer', owner: 'CAPITAL_FOUNDATION_APPROVALS', path: 'server/src/capitalFoundation/approvals/index.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'eee7b95d1e9b4821102ca4979deb5720d4f018d8', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.human-aiops-approval-owner', mappedRequirement: 'Separately authenticated human AI Ops approval and signature owner', owner: 'HUMAN_APPROVAL_OWNER_REQUIRED', path: 'server/src/productAssurance/diagnostics/boundary.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7b6b92a4fcbcc15d22b90d35f1244427fa1b0eab', disposition: 'MISSING_REQUIRED', currentStatus: 'SIGNER_PRINCIPAL_AND_RECEIPT_OWNER_NOT_RATIFIED', insertionRequestIds: ['AIOPS-IR-APPROVAL-023'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.telemetry-owner', mappedRequirement: 'Canonical telemetry coverage evidence', owner: 'PRODUCT_ASSURANCE_TELEMETRY', path: 'fixtures/productAssurance/generated/TELEMETRY_COVERAGE_MATRIX.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'ffc09a9f4d33d1851a1716061ec310b556e83051', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.telemetry-runtime-owner', mappedRequirement: 'Accepted telemetry emission owner for AI Ops', owner: 'PRODUCT_ASSURANCE_OWNER_CONTRACTS', path: 'server/src/productAssurance/adapters/ownerContracts.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '6caa44ecab1dbc2561fdd92947b442c029b6dc4a', disposition: 'MISSING_REQUIRED', currentStatus: 'DIRECTOR_ACCEPTED_S5_AND_I08_OWNER_CONTRACT_MISSING', insertionRequestIds: ['AIOPS-IR-ASSURANCE-011'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.auth-owner', mappedRequirement: 'Canonical operator-access authentication owner', owner: 'BACKEND_SECURITY_OPERATOR_ACCESS', path: 'server/src/security/access.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '453cd980861bfa19c0bdde989b90a02264356b91', disposition: 'REUSE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.aiops-principals', mappedRequirement: 'Canonical configured AI Ops worker principals', owner: 'BACKEND_SECURITY_OPERATOR_ACCESS', path: 'server/src/productIntegration/runtime/managedInventory.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'e1496fc9416f60a06f97ab5cd807a5e6580537e7', disposition: 'MISSING_REQUIRED', currentStatus: 'AI_OPS_PRINCIPALS_NOT_CONFIGURED', insertionRequestIds: ['AIOPS-IR-AUTH-004'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'canonical.cockpit-owner', mappedRequirement: 'Canonical cockpit projection owner', owner: 'PRODUCT_ASSURANCE_COCKPIT', path: 'server/src/productAssurance/cockpit/viewModel.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '1281a5e0b6e090ad4021e20594dfcefd231b1064', disposition: 'ADAPT', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'monitoring.browser-synthetic', mappedRequirement: 'Existing browser and synthetic monitoring', owner: 'I00_BROWSER_PROBE_OWNER', path: 'test/i00/performance/app-probe.mjs', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'd489c7dab7021ad68bb2cbed6cb0ef9bd20b186b', disposition: 'REFERENCE_ONLY', testEntrypoints: ['test/i00/performance/app-probe.mjs', 'test/aiOps/contracts/artifacts-purity.test.mjs'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'monitoring.synthetic-probe', mappedRequirement: 'Existing synthetic deployment probe', owner: 'I00_OPERATIONS', path: 'ops/i00/bin/probe.mjs', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '111c2839e37fc33bb34859cd28f8cae9c59e24b5', disposition: 'REUSE', testEntrypoints: ['ops/i00/bin/probe.mjs', 'test/aiOps/contracts/artifacts-purity.test.mjs'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.worktree-scope', mappedRequirement: 'Existing worktree and lane-scope enforcement', owner: 'DIRECTOR_SCOPE_GATE', path: 'ops/tests/lane-worker-scope-gate.sh', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'cbfd50b1c6639722d5469d974fd718f74e974ef5', disposition: 'REUSE', testEntrypoints: ['ops/tests/lane-worker-scope-gate.sh', 'test/aiOps/contracts/artifacts-purity.test.mjs'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.test-acceptance', mappedRequirement: 'Existing complete I00 acceptance test mechanism', owner: 'I00_ACCEPTANCE_OWNER', path: 'test/i00/complete-acceptance.mjs', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '6bc83e95b767ad51b412385719532b659bd96388', disposition: 'REUSE', testEntrypoints: ['test/i00/complete-acceptance.mjs', 'test/aiOps/contracts/artifacts-purity.test.mjs'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.worktree-patch-test', mappedRequirement: 'Existing isolated worktree patch and test mechanism', owner: 'DIRECTOR_RULEBOOK_OWNER', path: 'docs/archive/DIRECTOR_RULEBOOK.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '0b4513051024a1e237105051a086166f820e2f64', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.release-assembly', mappedRequirement: 'Existing release assembly mechanism', owner: 'I00_RELEASE_OWNER', path: 'ops/i00/bin/assemble-release.mjs', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'be721b432c67dd638c5758bc5b7817c82e2b7d21', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.release-switch', mappedRequirement: 'Existing release switch mechanism', owner: 'I00_RELEASE_OWNER', path: 'ops/i00/bin/release-switch.sh', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '480654e66a38076126e34bd4b617d8f0854a72f8', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.canary-evidence', mappedRequirement: 'Existing canary evidence mechanism', owner: 'LIVE_EDGE_FINAL_LANE_EVIDENCE', path: 'server/src/liveEdge/adapters/finalLaneEvidence/projection.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '11a960982c20eaca37bcebb1769b88d297c191a8', disposition: 'REFERENCE_ONLY', currentStatus: 'MECHANISM_PRESENT_REAL_CANARY_NOT_PERFORMED', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.canary-activation', mappedRequirement: 'Owner-authorized real canary and current readback', owner: 'I00_OPERATIONS_OWNER', path: 'ops/docs/i00/ACTIVATION_AND_BOUNDARY_RUNBOOK.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '327a92a79c5845add960ea4aabb3d481413e461b', disposition: 'MISSING_REQUIRED', currentStatus: 'REAL_CANARY_NOT_PERFORMED_AND_SECTION20_AUTH_MISSING', insertionRequestIds: ['AIOPS-IR-CONFIG-025'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'mechanism.rollback-switch', mappedRequirement: 'Existing rollback mechanism', owner: 'I00_RELEASE_OWNER', path: 'ops/i00/bin/rollback-switch.sh', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'e2540de6368fc39996f649612b9980c48acadd7f', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'docs.director-rulebook', mappedRequirement: 'DIRECTOR_RULEBOOK.md actual archive path', owner: 'DIRECTOR', path: 'docs/archive/DIRECTOR_RULEBOOK.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '0b4513051024a1e237105051a086166f820e2f64', disposition: 'REFERENCE_ONLY', currentStatus: 'HISTORICAL_ARCHIVE_REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'docs.blueprint', mappedRequirement: 'BLUEPRINT.md actual archive path', owner: 'PROJECT_ARCHITECTURE', path: 'docs/archive/BLUEPRINT.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'edfc46a892e8cbdd9a88fe6c8e3e9654a3a52ae2', disposition: 'REFERENCE_ONLY', currentStatus: 'HISTORICAL_ARCHIVE_REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'docs.engine', mappedRequirement: 'ENGINE.md actual archive path', owner: 'ENGINE_OWNER', path: 'docs/archive/ENGINE.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '63e2bbc4d0dde1a6eaa6efba0a04b32ed6716fda', disposition: 'REFERENCE_ONLY', currentStatus: 'HISTORICAL_ARCHIVE_REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'docs.project-memory', mappedRequirement: 'PROJECT_MEMORY.md actual archive path', owner: 'PROJECT_STATE_ARCHIVE', path: 'docs/archive/PROJECT_MEMORY.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'e61e796833942222a6fa99676198daf87fe588fe', disposition: 'REFERENCE_ONLY', currentStatus: 'HISTORICAL_ARCHIVE_REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'docs.design-playbook', mappedRequirement: 'DESIGN_PLAYBOOK.md actual archive path', owner: 'UI_DESIGN_OWNER', path: 'docs/archive/DESIGN_PLAYBOOK.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '52cd828a8bf0970f230cf29589e5ec21ad944c5b', disposition: 'REFERENCE_ONLY', currentStatus: 'HISTORICAL_ARCHIVE_REFERENCE_ONLY', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.source-of-truth', mappedRequirement: 'No second durable source of truth', owner: 'ARCHITECTURE_AUTHORITY_MAP', path: 'ARCHITECTURE.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '93d7604599b43109eb67433e85101009c3f82b8e', disposition: 'REJECT_DUPLICATE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.event-bus', mappedRequirement: 'No second event bus', owner: 'PRODUCT_INTEGRATION_RUNTIME', path: 'server/src/productIntegration/runtime/materialDelivery.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7ac5cf1b743e650de54fa9f8f00fbadb4842a47a', disposition: 'REJECT_DUPLICATE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.incident-database', mappedRequirement: 'No incident database before canonical incident owner ratification', owner: 'DIRECTOR_RATIFIED_INCIDENT_OWNER_REQUIRED', path: 'I00_PRODUCT_BUILD_STATE.md', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '97c28d71a1f9b6986e4b00ae18d2e0df9943bef5', disposition: 'REJECT_DUPLICATE', insertionRequestIds: ['AIOPS-IR-INCIDENT-019'], resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.command-registry', mappedRequirement: 'No second command registry', owner: 'PRODUCT_RUNTIME_SYSTEM_CONTROL_COMMAND_OWNER', path: 'server/src/productIntegration/runtime/systemControlCommandOwner.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7dca4a1cb3c11f8a468d71d808a2933329b9538f', disposition: 'REJECT_DUPLICATE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.approval-store', mappedRequirement: 'No second approval store', owner: 'CAPITAL_FOUNDATION_APPROVALS', path: 'server/src/capitalFoundation/approvals/index.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'eee7b95d1e9b4821102ca4979deb5720d4f018d8', disposition: 'REJECT_DUPLICATE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.health-system', mappedRequirement: 'No second health system', owner: 'SYSTEM_INTEGRATION_APPLICATION_HEALTH', path: 'server/src/systemIntegration/application/health.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '7530fcdc936cf5ddf60df6ae0a9547623eda6c25', disposition: 'REJECT_DUPLICATE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.executor', mappedRequirement: 'No second executor', owner: 'FOUNDATION_EXECUTION', path: 'server/src/foundation/execution/index.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: '1ef4fff0e59d045c192261229c7408a904d267c8', disposition: 'REJECT_DUPLICATE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'reject-duplicate.ledger', mappedRequirement: 'No second ledger', owner: 'LEDGER', path: 'server/src/ledger.ts', revision: AI_OPS_SHADOW_BASE_SHA, digestAlgorithm: 'GIT_BLOB_SHA1', digest: 'cb2433266dde597de22b873db68c4e5c33d34a1b', disposition: 'REJECT_DUPLICATE', resolvedAtShadowBase: true, authorityCreated: false },
  { entryId: 'authority.activation-directive', owner: 'OWNER', path: '/Users/cosmosgeek/Desktop/POST_I00_EVENT_DRIVEN_AI_OPERATIONS_ACTIVATION.md', revision: 'owner-file-20260714', digestAlgorithm: 'SHA-256', digest: 'cbc523fd18578641f6fcc02a5efb564ac861ca1320fcc189948a0725b41b5195', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: false, authorityCreated: false },
  { entryId: 'authority.command', owner: 'OWNER', path: '/Users/cosmosgeek/Desktop/command.txt', revision: 'owner-file-20260714', digestAlgorithm: 'SHA-256', digest: '4d938de306fb7577d8ff143677e30fb21fc3192da16d554c3a578b59566fb590', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: false, authorityCreated: false },
  { entryId: 'authority.time-amendment', owner: 'OWNER', path: '/Users/cosmosgeek/Desktop/OWNER TIME-OPTIMIZATION AMENDMENT.txt', revision: 'owner-file-20260714', digestAlgorithm: 'SHA-256', digest: '46549feced327d805c6057ecedffc8b65469c6537e5ce64b8c0a4f559eb1da30', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: false, authorityCreated: false },
  { entryId: 'authority.resolution-receipt', owner: 'MAIN_DIRECTOR', path: '/Users/cosmosgeek/Desktop/Main/AI_OPS_AUTHORITY_RESOLUTION_RECEIPT.md', revision: 'main-observed-20260714', digestAlgorithm: 'SHA-256', digest: '51d9343f747c7f652bbcd53137b06dec2f760268a9799ea57fbe077eaef898f0', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: false, authorityCreated: false },
  { entryId: 'authority.d-launch-29', owner: 'MAIN_DIRECTOR', path: '/Users/cosmosgeek/Desktop/Main/QL_DIRECTOR_STATE.md', revision: '2b32317dbf89907bcf529231247f1f9a63235d49', digestAlgorithm: 'SHA-256', digest: 'db90f7165ec577e19bab0dd4abca29b647ffb7b2d5be677c9b7f4faa5de80878', disposition: 'REFERENCE_ONLY', resolvedAtShadowBase: false, authorityCreated: false },
];

export const AI_OPS_ENTRY_INVENTORY: readonly Readonly<AiOpsEntryInventoryRow>[] = immutableClone(
  AI_OPS_ENTRY_INVENTORY_INPUTS.map(inventoryRow),
);

export const AI_OPS_SCHEMA_REUSE_MAP = immutableClone([
  { targetContract: 'AI_OPS_ARTIFACT_ENVELOPE_V1', donor: 'Foundation canonicalJson and time', mode: 'REUSE', adaptation: 'Add strict policy negative-zero and lone-surrogate rejection; preserve hash-profile label.' },
  { targetContract: 'AI_OPS_IDENTITY_PROVIDER_MATRIX_V1', donor: 'S6 WorkloadIdentityEventV1 and ExternalSandboxNotConfiguredV1', mode: 'ADAPT', adaptation: 'Expand three isolated worker rows across five closed provider states plus one explicit NOT_CONFIGURED advisor row; retain absence semantics.' },
  { targetContract: 'AI_OPS_ACTION_CLASS_V1', donor: 'S6 SelfCorrectionClassPolicyV1 and CandidateV1', mode: 'ADAPT', adaptation: 'Reuse evidence grammar only; never cast A-D because directive section 7 meanings differ.' },
  { targetContract: 'AI_OPS_DECISION_LOG_PORT_V1', donor: 'S6 AppendRetentionReceiptV1 and Ledger adapter', mode: 'ADAPT', adaptation: 'Expose append/readback port over Ledger; do not create storage.' },
  { targetContract: 'AI_OPS_RUNBOOK_MANIFEST_TEMPLATE_V1', donor: 'S6 repair evidence and Product Assurance remediation campaign', mode: 'ADAPT', adaptation: 'Unsigned insertion-only templates with numerical per-capability targets.' },
  { targetContract: 'AI_OPS_INSERTION_REQUESTS_V1', donor: 'S6 InsertionRequestRowV1', mode: 'REUSE', adaptation: 'Same DRAFT and PENDING_BACKEND grammar with AI Ops seams.' },
]);

const ROLE_LEVELS: Readonly<Record<AiOpsIdentityRole, readonly AiOpsPermissionLevel[]>> = Object.freeze({
  RUNTIME_DIAGNOSTICIAN: ['OBSERVE_EXPLAIN', 'BOUNDED_QUERY_REPLAY', 'PROPOSE_TYPED_ACTION'],
  ENGINEERING_REPAIR_WORKER: ['OBSERVE_EXPLAIN', 'BOUNDED_QUERY_REPLAY', 'PROPOSE_TYPED_ACTION', 'PATCH_ISOLATED_AND_TEST', 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY'],
  INDEPENDENT_VERIFICATION_WORKER: ['OBSERVE_EXPLAIN', 'BOUNDED_QUERY_REPLAY'],
  RESEARCH_TRADE_CONTEXT_ADVISOR: [],
});

export const AI_OPS_CAPABILITY_MATRIX = immutableClone(AI_OPS_IDENTITIES.map((identity) => ({
  identityId: identity.identityId,
  role: identity.role,
  permissionLevels: ROLE_LEVELS[identity.role],
  capabilityIds: AI_OPS_ALLOWED_CAPABILITIES_BY_ROLE[identity.role],
  providerStatesRepresented: identity.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR' ? ['NOT_CONFIGURED'] : AI_OPS_PROVIDER_STATES,
  hardDenialIds: AI_OPS_HARD_DENIAL_IDS,
  arbitraryToolAccess: 'DENIED',
  moneyAuthority: 'NONE',
  productionAuthority: 'NONE',
  liveExecutionState: AI_OPS_LIVE_EXECUTION_STATE,
  crossIdentityInheritance: 'DENIED',
  authorityCreated: false,
})));

export const AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES = immutableClone([
  { dependencyId: 'I00_ACCEPTED_AI_OPS_INTERFACES', currentState: 'UNFINISHED', insertionRequestIds: ['AIOPS-IR-DOCS-017', 'AIOPS-IR-BARREL-018'], requirement: 'Port into a fresh worktree from the then-accepted SHA and revalidate every accepted interface.' },
  { dependencyId: 'CANONICAL_INCIDENT_OWNER', currentState: 'MISSING_REQUIRED', insertionRequestIds: ['AIOPS-IR-INCIDENT-019'], requirement: 'Director ratifies exactly one incident identity and lifecycle owner.' },
  { dependencyId: 'HUMAN_APPROVAL_AND_SIGNATURE_OWNER', currentState: 'MISSING_REQUIRED', insertionRequestIds: ['AIOPS-IR-APPROVAL-023'], requirement: 'Separately authenticated owner signs exact runbook and policy artifacts.' },
  { dependencyId: 'AI_OPS_CONTROL_REGISTRY_MOUNT', currentState: 'NOT_WIRED', insertionRequestIds: ['AIOPS-IR-CONTROLS-008'], requirement: 'Canonical registry supplies namespaced entries, handlers, CAS and independent readback.' },
  { dependencyId: 'AI_OPS_LEDGER_AND_AUDIT_MOUNT', currentState: 'NOT_WIRED', insertionRequestIds: ['AIOPS-IR-PERSISTENCE-003', 'AIOPS-IR-AUDIT-021'], requirement: 'Ledger adapter and independent audit delivery satisfy append, readback and loss gates.' },
  { dependencyId: 'AI_OPS_WORKER_IDENTITY_AND_CONFIG', currentState: 'NOT_CONFIGURED', insertionRequestIds: ['AIOPS-IR-AUTH-004', 'AIOPS-IR-CONFIG-025'], requirement: 'Three isolated principals bind non-secret provider configuration with explicit billing domain.' },
  { dependencyId: 'AI_OPS_RUNBOOK_EXECUTION_BINDING', currentState: 'NOT_WIRED', insertionRequestIds: ['AIOPS-IR-REMEDIATION-010'], requirement: 'Existing remediation and command owners ratify each action; A1 never executes.' },
  { dependencyId: 'AI_OPS_ACCEPTED_ASSURANCE_BINDING', currentState: 'MISSING_REQUIRED', insertionRequestIds: ['AIOPS-IR-ASSURANCE-011'], requirement: 'Accepted Atlas and S6 evidence bind through Product Assurance owner adapters without fixture promotion.' },
  { dependencyId: 'AI_OPS_ROOT_TEST_AND_OPERATION_MANIFEST', currentState: 'NOT_MOUNTED', insertionRequestIds: ['AIOPS-IR-PACKAGE-006', 'AIOPS-IR-TEST-MOUNT-026'], requirement: 'Mount focused suite and regenerate Product Assurance scan manifest from accepted SHA.' },
]);

const INVENTORY_BY_ID = new Map(AI_OPS_ENTRY_INVENTORY.map((row) => [row.entryId, row]));
function resource(
  resourceId: string,
  kind: AiOpsClassificationResource['kind'],
  classifiedPath: string,
  inventoryId: string,
  directDependencyIds: readonly string[],
  requestedActionClass: AiOpsClassificationResource['requestedActionClass'] = null,
  attemptedActionIds: readonly string[] = [],
  registeredActionId: string | null = null,
): AiOpsClassificationResource {
  const evidence = INVENTORY_BY_ID.get(inventoryId);
  return {
    resourceId,
    kind,
    classifiedPath,
    evidencePath: evidence?.path ?? classifiedPath,
    evidenceDigest: evidence?.digest ?? sha256Canonical({ resourceId, classifiedPath }),
    evidenceDigestAlgorithm: evidence?.digestAlgorithm === 'GIT_BLOB_SHA1' ? 'GIT_BLOB_SHA1' : 'SHA-256',
    evidenceRevision: evidence?.revision ?? AI_OPS_SHADOW_BASE_SHA,
    directDependencyIds,
    registeredActionId,
    requestedActionClass,
    attemptedActionIds,
    hardDenialIds: [],
    sensitiveOwnerKinds: [],
  };
}

/**
 * One deterministic classification resource owns each local source path for
 * dependency-edge binding. A source may also expose secondary semantic
 * resources (policy.ts exposes the decision-log port), but relative imports
 * always resolve through this canonical file-node map.
 */
export const AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH: Readonly<Record<string, string>> = immutableClone({
  'server/src/aiOps/contracts/artifacts.ts': 'aiops-source-artifacts',
  'server/src/aiOps/contracts/authority.ts': 'aiops-source-authority',
  'server/src/aiOps/contracts/classification.ts': 'aiops-classification-manifest',
  'server/src/aiOps/contracts/controls.ts': 'aiops-control-insertion-requests',
  'server/src/aiOps/contracts/identity.ts': 'aiops-identity-adapter',
  'server/src/aiOps/contracts/index.ts': 'aiops-source-index',
  'server/src/aiOps/contracts/insertionRequests.ts': 'aiops-source-insertion-requests',
  'server/src/aiOps/contracts/policy.ts': 'aiops-policy-adapter',
  'server/src/aiOps/contracts/runbooks.ts': 'aiops-runbook-templates',
  'server/src/aiOps/contracts/schemas.ts': 'aiops-source-schemas',
  'server/src/aiOps/contracts/shared.ts': 'aiops-source-shared',
});

export const AI_OPS_CLASSIFICATION_INPUTS: readonly Readonly<AiOpsClassificationResource>[] = immutableClone([
  resource('foundation-canonical-json', 'CANONICAL_OWNER', 'server/src/foundation/contracts/identity.ts', 'foundation.canonical-json', []),
  resource('foundation-time', 'CANONICAL_OWNER', 'server/src/foundation/contracts/time.ts', 'foundation.time', []),
  resource('s6-boundary-schema', 'DONOR_CONTRACT', 'fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json', 's6.boundary-schema', []),
  resource('s6-evaluators', 'DONOR_CONTRACT', 'fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs', 's6.evaluators', ['s6-boundary-schema']),
  resource('product-assurance-diagnostic-boundary', 'CANONICAL_OWNER', 'server/src/productAssurance/diagnostics/boundary.ts', 'product-assurance.diagnostic-boundary', ['foundation-canonical-json']),
  resource('ledger-owner', 'CANONICAL_OWNER', 'server/src/ledger.ts', 'ledger.owner', []),
  resource('ledger-adapter', 'CANONICAL_OWNER', 'server/src/systemIntegration/persistence/ledgerAdapter.ts', 'ledger.adapter', ['ledger-owner']),
  resource('control-registry-owner', 'CANONICAL_OWNER', 'server/src/productIntegration/runtime/controls.ts', 'product-runtime.controls', []),
  resource('command-owner', 'CANONICAL_OWNER', 'server/src/productIntegration/runtime/systemControlCommandOwner.ts', 'product-runtime.command-owner', ['control-registry-owner']),
  resource('remediation-owner', 'CANONICAL_OWNER', 'server/src/productAssurance/remediation/campaign.ts', 'product-assurance.remediation-campaign', []),
  resource('aiops-source-shared', 'ADAPTER', 'server/src/aiOps/contracts/shared.ts', 'foundation.canonical-json', ['foundation-canonical-json', 'foundation-time'], 'C'),
  resource('aiops-source-authority', 'POLICY', 'server/src/aiOps/contracts/authority.ts', 'authority.activation-directive', ['aiops-source-shared', 'product-assurance-diagnostic-boundary'], 'C'),
  resource('aiops-identity-adapter', 'ADAPTER', 'server/src/aiOps/contracts/identity.ts', 's6.evaluators', ['aiops-source-authority', 'aiops-source-shared', 's6-evaluators', 'product-assurance-diagnostic-boundary', 'foundation-time'], 'C'),
  resource('aiops-policy-adapter', 'POLICY', 'server/src/aiOps/contracts/policy.ts', 'product-assurance.operations-policy', ['aiops-source-authority', 'aiops-source-shared', 'aiops-identity-adapter', 'foundation-canonical-json', 'foundation-time', 'ledger-adapter'], 'C'),
  resource('aiops-decision-log-port', 'PERSISTENCE_PORT', 'server/src/aiOps/contracts/policy.ts', 'ledger.adapter', ['aiops-source-authority', 'aiops-source-shared', 'aiops-identity-adapter', 'ledger-adapter'], 'B'),
  resource('aiops-runbook-templates', 'RUNBOOK', 'server/src/aiOps/contracts/runbooks.ts', 'product-assurance.remediation-campaign', ['aiops-source-authority', 'aiops-source-shared', 's6-evaluators', 'remediation-owner', 'command-owner'], 'C'),
  resource('aiops-control-insertion-requests', 'CONTROL_INSERTION_REQUEST', 'server/src/aiOps/contracts/controls.ts', 'product-runtime.controls', ['aiops-source-authority', 'aiops-source-shared', 'control-registry-owner', 'command-owner'], 'B'),
  resource('aiops-source-insertion-requests', 'ADAPTER', 'server/src/aiOps/contracts/insertionRequests.ts', 's6.insertion-draft', ['aiops-source-shared'], 'C'),
  resource('aiops-source-schemas', 'ADAPTER', 'server/src/aiOps/contracts/schemas.ts', 's6.boundary-schema', ['aiops-classification-manifest', 'aiops-control-insertion-requests', 'aiops-identity-adapter', 'aiops-policy-adapter', 'aiops-runbook-templates', 'aiops-source-authority', 'aiops-source-shared'], 'C'),
  resource('aiops-class-a-shadow-candidate', 'RUNBOOK', 'fixtures/aiOps/contracts/runbook-templates.v1.json#RECONNECT_STREAM', 'authority.activation-directive', ['aiops-runbook-templates'], 'A', [], 'AI_OPS_ACTION_RECONNECT_STREAM'),
  resource('aiops-classification-manifest', 'POLICY', 'server/src/aiOps/contracts/classification.ts', 'foundation.canonical-json', ['aiops-source-authority', 'aiops-source-shared', 'aiops-identity-adapter', 'aiops-policy-adapter', 'aiops-decision-log-port', 'aiops-runbook-templates', 'aiops-control-insertion-requests'], 'C'),
  resource('aiops-source-artifacts', 'ADAPTER', 'server/src/aiOps/contracts/artifacts.ts', 'authority.activation-directive', ['aiops-source-shared', 'aiops-source-authority', 'aiops-identity-adapter', 'aiops-policy-adapter', 'aiops-runbook-templates', 'aiops-control-insertion-requests', 'aiops-source-insertion-requests', 'aiops-source-schemas', 'aiops-classification-manifest'], 'C'),
  resource('aiops-source-index', 'ADAPTER', 'server/src/aiOps/contracts/index.ts', 'authority.activation-directive', ['aiops-source-shared', 'aiops-source-authority', 'aiops-identity-adapter', 'aiops-classification-manifest', 'aiops-runbook-templates', 'aiops-policy-adapter', 'aiops-control-insertion-requests', 'aiops-source-insertion-requests', 'aiops-source-schemas', 'aiops-source-artifacts'], 'C'),
  ...AI_OPS_HARD_DENIALS.map((denial) => resource(
    `aiops-hard-denial-fixture-${String(denial.directiveRow).padStart(2, '0')}`,
    'FIXTURE',
    `fixtures/aiOps/contracts/hard-denials.v1.json#${denial.denialId}`,
    'authority.activation-directive',
    [],
    null,
    [denial.examples[0] ?? denial.denialId],
  )),
]);

export const AI_OPS_CLASSIFICATION_MANIFEST_TEMPLATE = generateClassificationManifest(AI_OPS_SHADOW_BASE_SHA, AI_OPS_CLASSIFICATION_INPUTS);

export const AI_OPS_ARTIFACTS = Object.freeze({
  entryInventory: sealArtifact('AI_OPS_ENTRY_INVENTORY_V1', 'aiops-entry-inventory', AI_OPS_ENTRY_INVENTORY),
  schemaReuseMap: sealArtifact('AI_OPS_SCHEMA_REUSE_MAP_V1', 'aiops-schema-reuse-map', AI_OPS_SCHEMA_REUSE_MAP),
  adaptedSchemas: sealArtifact('AI_OPS_ADAPTED_SCHEMA_BUNDLE_V1', 'aiops-adapted-schema-bundle', AI_OPS_ADAPTED_SCHEMA_BUNDLE),
  capabilityMatrix: sealArtifact('AI_OPS_CAPABILITY_MATRIX_V1', 'aiops-capability-matrix', AI_OPS_CAPABILITY_MATRIX),
  identityProviderMatrix: sealArtifact('AI_OPS_IDENTITY_PROVIDER_MATRIX_V1', 'aiops-identity-provider-matrix', AI_OPS_PROVIDER_CREDENTIAL_MATRIX),
  hardDenials: sealArtifact('AI_OPS_HARD_DENIALS_V1', 'aiops-hard-denials', AI_OPS_HARD_DENIALS),
  actionClasses: sealArtifact('AI_OPS_ACTION_CLASSES_V1', 'aiops-action-classes', AI_OPS_ACTION_CLASS_DEFINITIONS),
  runbookTemplates: sealArtifact('AI_OPS_RUNBOOK_TEMPLATES_V1', 'aiops-runbook-templates', AI_OPS_RUNBOOK_TEMPLATES),
  reliabilityTargets: sealArtifact('AI_OPS_CAPABILITY_RELIABILITY_TARGETS_V1', 'aiops-capability-reliability-targets', AI_OPS_CAPABILITY_RELIABILITY_TARGETS),
  policyBundleFixture: sealArtifact('AI_OPS_POLICY_BUNDLE_FIXTURE_V1', 'aiops-policy-bundle-fixture', AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE),
  decisionLogDesign: sealArtifact('AI_OPS_DECISION_LOG_DESIGN_V1', 'aiops-decision-log-design', AI_OPS_DECISION_LOG_DESIGN_FIXTURE),
  controlInsertionRequests: sealArtifact('AI_OPS_CONTROL_INSERTION_REQUESTS_V1', 'aiops-control-insertion-requests', AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS),
  insertionRequests: sealArtifact('AI_OPS_INSERTION_REQUESTS_V1', 'aiops-insertion-requests', AI_OPS_INSERTION_REQUESTS),
  unfinishedInterfaces: sealArtifact('AI_OPS_UNFINISHED_INTERFACES_V1', 'aiops-unfinished-interfaces', AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES),
});
