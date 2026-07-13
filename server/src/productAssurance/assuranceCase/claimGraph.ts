import {
  assertDigestOrNull,
  assertIdentifier,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  sortedUnique,
  type AssuranceVerdict,
} from '../common.js';

export interface AssuranceClaimNode {
  readonly claimId: string;
  readonly revision: number;
  readonly claimType: 'ROOT' | 'INTERMEDIATE' | 'EVIDENCE';
  readonly statement: string;
  readonly producerId: string;
  readonly verifierId: string | null;
  readonly producerCommonModeGroupId: string | null;
  readonly verifierCommonModeGroupId: string | null;
  readonly dependencyClaimIds: readonly string[];
  readonly assertedVerdict: AssuranceVerdict;
  readonly evidenceIds: readonly string[];
  /** SHA-256 binding over the immutable evidence bundle named by evidenceIds. */
  readonly evidenceDigest: string | null;
  readonly expiresAtMs: number | null;
}

export interface EvaluatedAssuranceClaim {
  readonly claimId: string;
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly invalidatedByClaimIds: readonly string[];
}

export interface AssuranceClaimGraphProjection {
  readonly evaluatedAtMs: number;
  readonly claims: readonly Readonly<EvaluatedAssuranceClaim>[];
  readonly rootClaimIds: readonly string[];
  readonly overallVerdict: AssuranceVerdict;
  readonly cycleClaimIds: readonly string[];
}

function findCycles(nodes: readonly Readonly<AssuranceClaimNode>[]): readonly string[] {
  const byId = new Map(nodes.map((node) => [node.claimId, node]));
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles = new Set<string>();
  let nextIndex = 0;

  const visit = (id: string): void => {
    indexes.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    const node = byId.get(id);
    for (const dependency of node?.dependencyClaimIds ?? []) {
      if (!byId.has(dependency)) continue;
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, lowLinks.get(dependency) ?? 0));
      } else if (onStack.has(dependency)) {
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, indexes.get(dependency) ?? 0));
      }
    }

    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    const selfCycle = component.length === 1 && (byId.get(id)?.dependencyClaimIds.includes(id) ?? false);
    if (component.length > 1 || selfCycle) {
      for (const member of component) cycles.add(member);
    }
  };
  for (const node of nodes) {
    if (!indexes.has(node.claimId)) visit(node.claimId);
  }
  return sortedUnique([...cycles]);
}

function validateClaimNode(node: Readonly<AssuranceClaimNode>): void {
  assertIdentifier(node.claimId, 'claim.claimId');
  assertIdentifier(node.producerId, 'claim.producerId');
  assertSafeNonNegativeInteger(node.revision, 'claim.revision');
  if (!(['ROOT', 'INTERMEDIATE', 'EVIDENCE'] as const).includes(node.claimType)) {
    throw new TypeError(`claim ${node.claimId} has unsupported claimType`);
  }
  if (!(['PASS', 'FAIL', 'UNKNOWN'] as const).includes(node.assertedVerdict)) {
    throw new TypeError(`claim ${node.claimId} has unsupported assertedVerdict`);
  }
  if (typeof node.statement !== 'string' || node.statement.trim().length === 0 || node.statement.length > 1_000) {
    throw new TypeError(`claim ${node.claimId} statement must be non-empty text (<=1000 chars)`);
  }
  if (node.verifierId !== null) assertIdentifier(node.verifierId, 'claim.verifierId');
  if (node.producerCommonModeGroupId !== null) {
    assertIdentifier(node.producerCommonModeGroupId, 'claim.producerCommonModeGroupId');
  }
  if (node.verifierCommonModeGroupId !== null) {
    assertIdentifier(node.verifierCommonModeGroupId, 'claim.verifierCommonModeGroupId');
  }
  if (node.expiresAtMs !== null) assertUtcMs(node.expiresAtMs, 'claim.expiresAtMs');
  assertDigestOrNull(node.evidenceDigest, 'claim.evidenceDigest');
  if (new Set(node.dependencyClaimIds).size !== node.dependencyClaimIds.length) {
    throw new TypeError(`claim ${node.claimId} has duplicate dependencies`);
  }
  if (new Set(node.evidenceIds).size !== node.evidenceIds.length) {
    throw new TypeError(`claim ${node.claimId} has duplicate evidence IDs`);
  }
  for (const dependencyId of node.dependencyClaimIds) {
    assertIdentifier(dependencyId, `claim ${node.claimId} dependencyClaimId`);
  }
  for (const evidenceId of node.evidenceIds) {
    assertIdentifier(evidenceId, `claim ${node.claimId} evidenceId`);
  }

  if (node.claimType === 'EVIDENCE') {
    if (node.dependencyClaimIds.length > 0) {
      throw new TypeError(`evidence claim ${node.claimId} cannot depend on other claims`);
    }
    if (node.evidenceIds.length === 0 || node.evidenceDigest === null) {
      throw new TypeError(`evidence claim ${node.claimId} requires evidence IDs and a digest binding`);
    }
    return;
  }

  if (node.dependencyClaimIds.length === 0) {
    throw new TypeError(`${node.claimType.toLowerCase()} claim ${node.claimId} requires dependencies`);
  }
  if (node.evidenceIds.length > 0 || node.evidenceDigest !== null) {
    throw new TypeError(`${node.claimType.toLowerCase()} claim ${node.claimId} must derive evidence through dependencies`);
  }
}

export function evaluateAssuranceClaimGraph(
  nodes: readonly Readonly<AssuranceClaimNode>[],
  nowMs: number,
): Readonly<AssuranceClaimGraphProjection> {
  assertUtcMs(nowMs, 'nowMs');
  const ids = nodes.map((node) => node.claimId);
  if (new Set(ids).size !== ids.length) throw new TypeError('claim graph contains duplicate IDs');
  const byId = new Map(nodes.map((node) => [node.claimId, node]));
  for (const node of nodes) {
    validateClaimNode(node);
  }
  const evidenceOwnerById = new Map<string, string>();
  const evidenceOwnerByDigest = new Map<string, string>();
  for (const node of nodes.filter((candidate) => candidate.claimType === 'EVIDENCE')) {
    for (const evidenceId of node.evidenceIds) {
      const owner = evidenceOwnerById.get(evidenceId);
      if (owner !== undefined && owner !== node.claimId) throw new TypeError(`evidence ID ${evidenceId} is reused across claims`);
      evidenceOwnerById.set(evidenceId, node.claimId);
    }
    if (node.evidenceDigest !== null) {
      const owner = evidenceOwnerByDigest.get(node.evidenceDigest);
      if (owner !== undefined && owner !== node.claimId) throw new TypeError(`evidence digest is reused across claims ${owner} and ${node.claimId}`);
      evidenceOwnerByDigest.set(node.evidenceDigest, node.claimId);
    }
  }
  const cycleIds = new Set(findCycles(nodes));
  const evaluated = new Map<string, Readonly<EvaluatedAssuranceClaim>>();
  const evaluating = new Set<string>();
  const evaluate = (claimId: string): Readonly<EvaluatedAssuranceClaim> => {
    const cached = evaluated.get(claimId);
    if (cached) return cached;
    const node = byId.get(claimId);
    if (!node) return Object.freeze({ claimId, verdict: 'UNKNOWN', reasonCodes: Object.freeze(['CLAIM_DEPENDENCY_MISSING']), invalidatedByClaimIds: Object.freeze([claimId]) });
    if (evaluating.has(claimId) || cycleIds.has(claimId)) {
      const cycle = Object.freeze({ claimId, verdict: 'UNKNOWN' as const, reasonCodes: Object.freeze(['CLAIM_GRAPH_CYCLE']), invalidatedByClaimIds: Object.freeze([claimId]) });
      evaluated.set(claimId, cycle);
      return cycle;
    }
    evaluating.add(claimId);
    const failed: string[] = [];
    const unknown: string[] = [];
    const invalidatedBy: string[] = [];
    if (node.expiresAtMs === null) unknown.push('CLAIM_EXPIRY_MISSING');
    else if (nowMs >= node.expiresAtMs) failed.push('CLAIM_EXPIRED');
    if (node.verifierId === null) unknown.push('CLAIM_VERIFIER_MISSING');
    else if (node.producerId === node.verifierId) failed.push('CLAIM_VERIFIER_NOT_INDEPENDENT');
    if (node.producerCommonModeGroupId === null || node.verifierCommonModeGroupId === null) unknown.push('CLAIM_COMMON_MODE_INDEPENDENCE_UNKNOWN');
    else if (node.producerCommonModeGroupId === node.verifierCommonModeGroupId) failed.push('CLAIM_COMMON_MODE_VERIFICATION');
    const dependencies = node.dependencyClaimIds.map(evaluate);
    for (const dependency of dependencies) {
      if (dependency.verdict === 'FAIL') failed.push('DEPENDENCY_CLAIM_FAILED');
      if (dependency.verdict === 'UNKNOWN') unknown.push('DEPENDENCY_CLAIM_UNKNOWN');
      if (dependency.verdict !== 'PASS') invalidatedBy.push(dependency.claimId, ...dependency.invalidatedByClaimIds);
    }
    if (node.assertedVerdict === 'FAIL') failed.push('CLAIM_ASSERTED_FAIL');
    if (node.assertedVerdict === 'UNKNOWN') unknown.push('CLAIM_ASSERTED_UNKNOWN');
    const result = Object.freeze({
      claimId,
      verdict: failed.length > 0 ? 'FAIL' as const : unknown.length > 0 ? 'UNKNOWN' as const : 'PASS' as const,
      reasonCodes: sortedUnique([...failed, ...unknown]),
      invalidatedByClaimIds: sortedUnique(invalidatedBy),
    });
    evaluating.delete(claimId);
    evaluated.set(claimId, result);
    return result;
  };
  const claims = nodes.map((node) => evaluate(node.claimId)).sort((left, right) => left.claimId.localeCompare(right.claimId));
  const roots = nodes.filter((node) => node.claimType === 'ROOT').map((node) => node.claimId).sort();
  const rootResults = roots.map((id) => evaluated.get(id)).filter((result): result is Readonly<EvaluatedAssuranceClaim> => result !== undefined);
  const overallVerdict: AssuranceVerdict = roots.length === 0
    ? 'UNKNOWN'
    : rootResults.some((result) => result.verdict === 'FAIL')
      ? 'FAIL'
      : rootResults.some((result) => result.verdict === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
  return Object.freeze({ evaluatedAtMs: nowMs, claims: Object.freeze(claims), rootClaimIds: Object.freeze(roots), overallVerdict, cycleClaimIds: sortedUnique([...cycleIds]) });
}
