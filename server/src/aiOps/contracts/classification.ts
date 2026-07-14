import { AI_OPS_ACTION_CLASS_DEFINITIONS, AI_OPS_HARD_DENIALS, AI_OPS_HARD_DENIAL_IDS, type AiOpsActionClass } from './authority.js';
import { canonicalPolicySnapshot, compareCodeUnits, exactKeys, immutableClone, isBoundedId, isCanonicalSafeText, isDenseArray, sha256Canonical, sortedUnique } from './shared.js';

export const AI_OPS_RESOURCE_KINDS = Object.freeze([
  'CANONICAL_OWNER',
  'DONOR_CONTRACT',
  'ADAPTER',
  'POLICY',
  'RUNBOOK',
  'CONTROL_INSERTION_REQUEST',
  'PERSISTENCE_PORT',
  'FIXTURE',
  'TEST',
  'UNKNOWN',
] as const);
export type AiOpsResourceKind = (typeof AI_OPS_RESOURCE_KINDS)[number];

export interface AiOpsClassificationResource {
  readonly resourceId: string;
  readonly kind: AiOpsResourceKind;
  readonly classifiedPath: string;
  readonly evidencePath: string;
  readonly evidenceDigest: string;
  readonly evidenceDigestAlgorithm: 'GIT_BLOB_SHA1' | 'SHA-256';
  readonly evidenceRevision: string;
  readonly directDependencyIds: readonly string[];
  readonly registeredActionId: string | null;
  readonly requestedActionClass: AiOpsActionClass | null;
  readonly attemptedActionIds: readonly string[];
  readonly hardDenialIds: readonly string[];
  readonly sensitiveOwnerKinds: readonly ('CONTROL' | 'EXECUTION' | 'RISK' | 'LEDGER' | 'CREDENTIAL')[];
}

export interface AiOpsClassificationEntry {
  readonly resourceId: string;
  readonly kind: AiOpsResourceKind;
  readonly classifiedPath: string;
  readonly evidencePath: string;
  readonly evidenceDigest: string;
  readonly evidenceDigestAlgorithm: 'GIT_BLOB_SHA1' | 'SHA-256';
  readonly evidenceRevision: string;
  readonly directDependencyIds: readonly string[];
  readonly transitiveDependencyIds: readonly string[];
  readonly unresolvedDependencyIds: readonly string[];
  readonly cycleMemberIds: readonly string[];
  readonly actionClass: AiOpsActionClass;
  readonly hardDenialIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly authorityCreated: false;
}

export interface AiOpsClassificationManifest {
  readonly schema: 'AI_OPS_CLASSIFICATION_MANIFEST_V1';
  readonly generator: Readonly<{
    id: 'ai-ops-a1-transitive-classifier';
    version: 1;
    algorithm: 'SORTED_DFS_TRANSITIVE_CLOSURE_V1';
  }>;
  readonly sourceRevision: string;
  readonly inputDigest: string;
  readonly entries: readonly Readonly<AiOpsClassificationEntry>[];
  readonly manifestDigest: string;
  readonly operationalAuthorityCreated: false;
}

const CLASS_RANK: Readonly<Record<AiOpsActionClass, number>> = Object.freeze({ A: 0, B: 1, C: 2, D: 3 });
const RANK_CLASS = Object.freeze(['A', 'B', 'C', 'D'] as const);
const MAX_RESOURCES = 512;
const MAX_DIRECT_DEPENDENCIES = 256;
const CLASSIFICATION_RESOURCE_KEYS = Object.freeze([
  'resourceId',
  'kind',
  'classifiedPath',
  'evidencePath',
  'evidenceDigest',
  'evidenceDigestAlgorithm',
  'evidenceRevision',
  'directDependencyIds',
  'registeredActionId',
  'requestedActionClass',
  'attemptedActionIds',
  'hardDenialIds',
  'sensitiveOwnerKinds',
] as const);
const SENSITIVE_OWNER_KINDS = Object.freeze(['CONTROL', 'EXECUTION', 'RISK', 'LEDGER', 'CREDENTIAL'] as const);
const DENIAL_IDS_BY_EXAMPLE = new Map(
  AI_OPS_HARD_DENIALS.flatMap((denial) => denial.examples.map((example) => [example, denial.denialId] as const)),
);

function matchedHardDenialIds(resource: Readonly<AiOpsClassificationResource>): readonly string[] {
  return sortedUnique([
    ...resource.hardDenialIds,
    ...(resource.registeredActionId === null ? [] : [DENIAL_IDS_BY_EXAMPLE.get(resource.registeredActionId)]),
    ...resource.attemptedActionIds.map((actionId) => DENIAL_IDS_BY_EXAMPLE.get(actionId)).filter((value): value is string => value !== undefined),
  ].filter((value): value is string => value !== undefined));
}

function baseClass(resource: Readonly<AiOpsClassificationResource>): { actionClass: AiOpsActionClass; reasons: string[] } {
  if (matchedHardDenialIds(resource).length > 0 || resource.sensitiveOwnerKinds.length > 0) {
    return { actionClass: 'D', reasons: ['HARD_DENIAL_OR_SENSITIVE_AUTHORITY_MATCH'] };
  }
  if (resource.requestedActionClass === 'A') {
    return { actionClass: 'C', reasons: ['SHADOW_HAS_NO_SIGNED_CLASS_A_REGISTRATION_HANDLER_OR_READBACK'] };
  }
  if (resource.requestedActionClass !== null) {
    return { actionClass: resource.requestedActionClass, reasons: ['EXPLICIT_AI_OPS_SECTION_7_CLASS'] };
  }
  if (resource.kind === 'CONTROL_INSERTION_REQUEST' || resource.kind === 'PERSISTENCE_PORT') {
    return { actionClass: 'B', reasons: ['SHARED_OWNER_CHANGE_REMAINS_PROPOSAL_ONLY'] };
  }
  if (resource.kind === 'UNKNOWN') return { actionClass: 'C', reasons: ['UNKNOWN_RESOURCE_DEFAULTS_TO_ISOLATED_PATCH'] };
  if (resource.kind === 'POLICY' || resource.kind === 'RUNBOOK' || resource.kind === 'ADAPTER') {
    return { actionClass: 'C', reasons: ['POLICY_RUNBOOK_OR_CODE_CHANGE_IS_CLASS_C'] };
  }
  return { actionClass: 'C', reasons: ['UNMAPPED_RESOURCE_DEFAULTS_TO_CLASS_C'] };
}

function assertResource(resource: Readonly<AiOpsClassificationResource>): void {
  if (!exactKeys(resource, CLASSIFICATION_RESOURCE_KEYS)) throw new TypeError('classification resource must be a closed object');
  if (!isBoundedId(resource.resourceId)) throw new TypeError('invalid classification resourceId (redacted)');
  if (!AI_OPS_RESOURCE_KINDS.includes(resource.kind)) throw new TypeError('invalid resource kind (redacted)');
  if (!isCanonicalSafeText(resource.classifiedPath, 512)) throw new TypeError('invalid classifiedPath (redacted)');
  if (!isCanonicalSafeText(resource.evidencePath, 512)) throw new TypeError('invalid evidencePath (redacted)');
  if (resource.evidenceDigestAlgorithm !== 'GIT_BLOB_SHA1' && resource.evidenceDigestAlgorithm !== 'SHA-256') {
    throw new TypeError('invalid evidence digest algorithm (redacted)');
  }
  if (typeof resource.evidenceDigest !== 'string') throw new TypeError('invalid evidence digest (redacted)');
  if (resource.evidenceDigestAlgorithm === 'GIT_BLOB_SHA1' && !/^[a-f0-9]{40}$/.test(resource.evidenceDigest)) throw new TypeError('invalid Git blob digest (redacted)');
  if (resource.evidenceDigestAlgorithm === 'SHA-256' && !/^[a-f0-9]{64}$/.test(resource.evidenceDigest)) throw new TypeError('invalid SHA-256 digest (redacted)');
  if (!isCanonicalSafeText(resource.evidenceRevision, 192)) throw new TypeError('invalid evidence revision (redacted)');
  if (!isDenseArray(resource.hardDenialIds) || resource.hardDenialIds.length > AI_OPS_HARD_DENIAL_IDS.length) throw new TypeError('invalid hard denials (redacted)');
  const denialSet = new Set(AI_OPS_HARD_DENIAL_IDS);
  if (resource.hardDenialIds.some((id) => !denialSet.has(id))) throw new TypeError('unknown hard denial (redacted)');
  if (!isDenseArray(resource.directDependencyIds) || resource.directDependencyIds.some((id) => !isBoundedId(id))) throw new TypeError('invalid dependencies (redacted)');
  if (resource.directDependencyIds.length > MAX_DIRECT_DEPENDENCIES) throw new TypeError('too many dependencies (redacted)');
  if (!isDenseArray(resource.attemptedActionIds) || resource.attemptedActionIds.some((id) => !isBoundedId(id))) throw new TypeError('invalid attempted actions (redacted)');
  if (resource.attemptedActionIds.length > 128) throw new TypeError('too many attempted actions (redacted)');
  if (!isDenseArray(resource.sensitiveOwnerKinds)
    || resource.sensitiveOwnerKinds.length > SENSITIVE_OWNER_KINDS.length
    || resource.sensitiveOwnerKinds.some((kind) => !SENSITIVE_OWNER_KINDS.includes(kind))) {
    throw new TypeError('invalid sensitive owner kinds (redacted)');
  }
  if (resource.registeredActionId !== null && !isBoundedId(resource.registeredActionId)) throw new TypeError('invalid registered action (redacted)');
  if (resource.requestedActionClass !== null && !AI_OPS_ACTION_CLASS_DEFINITIONS.some((row) => row.actionClass === resource.requestedActionClass)) {
    throw new TypeError('unknown requested class (redacted)');
  }
}

function normalizeResourceSetValues(resource: Readonly<AiOpsClassificationResource>): Readonly<AiOpsClassificationResource> {
  return immutableClone({
    ...resource,
    directDependencyIds: sortedUnique(resource.directDependencyIds),
    attemptedActionIds: sortedUnique(resource.attemptedActionIds),
    hardDenialIds: sortedUnique(resource.hardDenialIds),
    sensitiveOwnerKinds: sortedUnique(resource.sensitiveOwnerKinds) as AiOpsClassificationResource['sensitiveOwnerKinds'],
  });
}

export function generateClassificationManifest(
  sourceRevision: string,
  inputResources: readonly Readonly<AiOpsClassificationResource>[],
): Readonly<AiOpsClassificationManifest> {
  if (!isBoundedId(sourceRevision)) throw new TypeError('invalid classification sourceRevision');
  let clonedResources: readonly Readonly<AiOpsClassificationResource>[];
  try {
    if (!Array.isArray(inputResources)) throw new TypeError('not-an-array');
    clonedResources = canonicalPolicySnapshot(inputResources);
  } catch {
    throw new TypeError('classification resources are not closed canonical data');
  }
  if (clonedResources.length === 0) throw new TypeError('classification resources must not be empty');
  if (clonedResources.length > MAX_RESOURCES) throw new TypeError('classification resource bound exceeded');
  clonedResources.forEach(assertResource);
  const resources = clonedResources.map(normalizeResourceSetValues);
  const byId = new Map(resources.map((resource) => [resource.resourceId, resource]));
  if (byId.size !== resources.length) throw new TypeError('duplicate classification resourceId');
  const sortedDependenciesById = new Map(
    resources.map((resource) => [resource.resourceId, sortedUnique(resource.directDependencyIds)] as const),
  );

  // Resolve cycle membership once for the complete known graph. A per-root DFS
  // that merely skips already-expanded nodes can otherwise hide members of a
  // strongly connected component when a cross-edge reaches a completed node.
  const cycleMembers = new Set<string>();
  const discoveryIndex = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const activeStack: string[] = [];
  const activeIds = new Set<string>();
  let nextDiscoveryIndex = 0;
  const findStronglyConnectedComponent = (resourceId: string): void => {
    const index = nextDiscoveryIndex;
    nextDiscoveryIndex += 1;
    discoveryIndex.set(resourceId, index);
    lowLink.set(resourceId, index);
    activeStack.push(resourceId);
    activeIds.add(resourceId);

    const resource = byId.get(resourceId);
    if (!resource) throw new TypeError(`unknown classification resource: ${resourceId}`);
    const dependencyIds = sortedDependenciesById.get(resourceId);
    if (!dependencyIds) throw new TypeError(`missing classification dependencies: ${resourceId}`);
    for (const dependencyId of dependencyIds) {
      if (!byId.has(dependencyId)) continue;
      if (!discoveryIndex.has(dependencyId)) {
        findStronglyConnectedComponent(dependencyId);
        lowLink.set(resourceId, Math.min(lowLink.get(resourceId) ?? index, lowLink.get(dependencyId) ?? index));
      } else if (activeIds.has(dependencyId)) {
        lowLink.set(resourceId, Math.min(lowLink.get(resourceId) ?? index, discoveryIndex.get(dependencyId) ?? index));
      }
    }

    if (lowLink.get(resourceId) !== index) return;
    const component: string[] = [];
    while (activeStack.length > 0) {
      const memberId = activeStack.pop();
      if (memberId === undefined) throw new TypeError('classification cycle stack underflow');
      activeIds.delete(memberId);
      component.push(memberId);
      if (memberId === resourceId) break;
    }
    const singleMember = component[0];
    const hasSelfLoop = component.length === 1
      && singleMember !== undefined
      && sortedDependenciesById.get(singleMember)?.includes(singleMember) === true;
    if (component.length > 1 || hasSelfLoop) component.forEach((memberId) => cycleMembers.add(memberId));
  };
  for (const resourceId of [...byId.keys()].sort(compareCodeUnits)) {
    if (!discoveryIndex.has(resourceId)) findStronglyConnectedComponent(resourceId);
  }

  const resolve = (rootId: string): { closure: string[]; unresolved: string[]; cycles: string[] } => {
    const closure = new Set<string>();
    const unresolved = new Set<string>();
    const expanded = new Set<string>();
    const visit = (dependencyId: string): void => {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        unresolved.add(dependencyId);
        return;
      }
      closure.add(dependencyId);
      if (expanded.has(dependencyId)) return;
      expanded.add(dependencyId);
      const childIds = sortedDependenciesById.get(dependencyId);
      if (!childIds) throw new TypeError(`missing classification dependencies: ${dependencyId}`);
      for (const childId of childIds) visit(childId);
    };
    const root = byId.get(rootId);
    if (!root) throw new TypeError(`unknown classification root: ${rootId}`);
    const rootDependencyIds = sortedDependenciesById.get(rootId);
    if (!rootDependencyIds) throw new TypeError(`missing classification dependencies: ${rootId}`);
    for (const dependencyId of rootDependencyIds) visit(dependencyId);
    closure.delete(rootId);
    return {
      closure: [...closure].sort(),
      unresolved: [...unresolved].sort(),
      cycles: [...expanded].filter((resourceId) => cycleMembers.has(resourceId)).sort(),
    };
  };

  const prelim = new Map(resources.map((resource) => [resource.resourceId, baseClass(resource)]));
  const entries = resources
    .map((resource): AiOpsClassificationEntry => {
      const dependency = resolve(resource.resourceId);
      const own = prelim.get(resource.resourceId);
      if (!own) throw new TypeError(`classification missing: ${resource.resourceId}`);
      let rank = CLASS_RANK[own.actionClass];
      const reasons = [...own.reasons];
      const dependencyHardDenials = new Set<string>();
      for (const dependencyId of dependency.closure) {
        const dependencyClass = prelim.get(dependencyId);
        if (dependencyClass?.actionClass === 'D') {
          rank = CLASS_RANK.D;
          reasons.push('TRANSITIVE_CLASS_D_INHERITED');
        }
        const dependencyResource = byId.get(dependencyId);
        if (dependencyResource) matchedHardDenialIds(dependencyResource).forEach((id) => dependencyHardDenials.add(id));
      }
      if (dependency.unresolved.length > 0) {
        rank = Math.max(rank, CLASS_RANK.C);
        reasons.push('UNRESOLVED_TRANSITIVE_DEPENDENCY');
      }
      if (dependency.cycles.length > 0) {
        rank = Math.max(rank, CLASS_RANK.C);
        reasons.push('DEPENDENCY_CYCLE_REQUIRES_ISOLATION');
      }
      if (dependencyHardDenials.size > 0) {
        rank = CLASS_RANK.D;
        reasons.push('TRANSITIVE_HARD_DENIAL_INHERITED');
      }
      return {
        resourceId: resource.resourceId,
        kind: resource.kind,
        classifiedPath: resource.classifiedPath,
        evidencePath: resource.evidencePath,
        evidenceDigest: resource.evidenceDigest,
        evidenceDigestAlgorithm: resource.evidenceDigestAlgorithm,
        evidenceRevision: resource.evidenceRevision,
        directDependencyIds: sortedUnique(resource.directDependencyIds),
        transitiveDependencyIds: dependency.closure,
        unresolvedDependencyIds: dependency.unresolved,
        cycleMemberIds: dependency.cycles,
        actionClass: RANK_CLASS[rank] ?? 'D',
        hardDenialIds: sortedUnique([...matchedHardDenialIds(resource), ...dependencyHardDenials]),
        reasonCodes: sortedUnique(reasons),
        authorityCreated: false,
      };
    })
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId));
  const inputDigest = sha256Canonical(resources.slice().sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId)));
  const manifestDigest = sha256Canonical({
    schema: 'AI_OPS_CLASSIFICATION_MANIFEST_V1',
    generator: { id: 'ai-ops-a1-transitive-classifier', version: 1, algorithm: 'SORTED_DFS_TRANSITIVE_CLOSURE_V1' },
    sourceRevision,
    inputDigest,
    entries,
    operationalAuthorityCreated: false,
  });
  return immutableClone({
    schema: 'AI_OPS_CLASSIFICATION_MANIFEST_V1' as const,
    generator: { id: 'ai-ops-a1-transitive-classifier' as const, version: 1 as const, algorithm: 'SORTED_DFS_TRANSITIVE_CLOSURE_V1' as const },
    sourceRevision,
    inputDigest,
    entries,
    manifestDigest,
    operationalAuthorityCreated: false as const,
  });
}
