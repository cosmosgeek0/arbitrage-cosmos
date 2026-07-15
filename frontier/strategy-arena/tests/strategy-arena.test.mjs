import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  adaptExperimentCard,
  adaptProductSurfaceProjection,
  adaptScenarioReference,
  compareTournamentReports,
  cloneValidatedCampaign,
  createArenaAdapterMaps,
  createArenaPolicy,
  createEvaluationCampaign,
  createEventContext,
  createFixtureRuntime,
  createProductSurfaceProjection,
  createQValidationAuthority,
  createShadowExposureProjection,
  createStrategyObservation,
  createStrategySnapshot,
  createSyntheticEconomicProjection,
  evaluateTournament,
  invokeArenaFacet,
  projectArenaCockpit,
  routeArenaAdvisory,
  runArenaLoadProof,
  validateArenaDockRelease,
  validateEvaluationCampaign,
  validateEventContext,
  validateOwnerReferenceSet,
  validateQValidationAuthorityAgainstOwner,
  validateScenarioReferences,
  validateStrategyArenaReport,
  validateStrategyObservation,
  validateSyntheticEconomicProjection,
} from '../src/index.mjs';
import {
  FixtureSandbox,
  canonicalize,
  createProviderFacetBinding,
  createScenarioReference,
  reverseFixture,
  sha256,
  validateCanonicalAdapterMap,
  validateExtensionDescriptor,
  validateInsertionRequest,
  validateMaxSafeRateClaim,
  validateResourceBudgetClaim,
  validateResourceRateCompatibility,
} from '../../dock/src/index.mjs';
import {
  BASE_SHA,
  CLOCK,
  Q_SHA,
  REFS,
  baseTournament,
  economics,
  eventContext,
  observation,
  outcome,
  ownerRef,
  policy,
  qAuthority,
  scenarioReference,
  snapshot,
} from './fixtures.mjs';
import { strategyArenaSchema } from './schema-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REPO = resolve(ROOT, '../..');
const DOCK_SHA = 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5';
const SAFE_Q_SLICES = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/q-validation-owner-slices.v1.json'), 'utf8'));

async function json(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutHash(value, hashField) {
  const copy = clone(value);
  delete copy[hashField];
  return copy;
}

function schemaError(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function validateSchemaSubset(root, schema, value, path = '$') {
  if (schema.$ref !== undefined) {
    const prefix = '#/$defs/';
    if (!schema.$ref.startsWith(prefix) || root.$defs[schema.$ref.slice(prefix.length)] === undefined) schemaError(path, `unresolved ref ${schema.$ref}`);
    return validateSchemaSubset(root, root.$defs[schema.$ref.slice(prefix.length)], value, path);
  }
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter((candidate) => {
      try { validateSchemaSubset(root, candidate, value, path); return true; } catch { return false; }
    });
    if (matches.length !== 1) schemaError(path, `oneOf matched ${matches.length} branches`);
  }
  if (schema.anyOf !== undefined) {
    const matches = schema.anyOf.filter((candidate) => {
      try { validateSchemaSubset(root, candidate, value, path); return true; } catch { return false; }
    });
    if (matches.length === 0) schemaError(path, 'anyOf matched 0 branches');
  }
  if (schema.allOf !== undefined) for (const candidate of schema.allOf) validateSchemaSubset(root, candidate, value, path);
  if (schema.if !== undefined) {
    let matches = true;
    try { validateSchemaSubset(root, schema.if, value, path); } catch { matches = false; }
    if (matches && schema.then !== undefined) validateSchemaSubset(root, schema.then, value, path);
    if (!matches && schema.else !== undefined) validateSchemaSubset(root, schema.else, value, path);
  }
  if (schema.const !== undefined && canonicalize(schema.const) !== canonicalize(value)) schemaError(path, 'const mismatch');
  if (schema.enum !== undefined && !schema.enum.some((candidate) => canonicalize(candidate) === canonicalize(value))) schemaError(path, 'enum mismatch');
  if (schema.type !== undefined) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    if (actual !== schema.type) schemaError(path, `expected ${schema.type}, received ${actual}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) schemaError(path, 'string below minLength');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) schemaError(path, 'string above maxLength');
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) schemaError(path, 'pattern mismatch');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) schemaError(path, 'number below minimum');
    if (schema.maximum !== undefined && value > schema.maximum) schemaError(path, 'number above maximum');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) schemaError(path, 'array below minItems');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) schemaError(path, 'array above maxItems');
    if (schema.uniqueItems === true && new Set(value.map((entry) => canonicalize(entry))).size !== value.length) schemaError(path, 'array items not unique');
    if (schema.items !== undefined) value.forEach((entry, index) => validateSchemaSubset(root, schema.items, entry, `${path}[${index}]`));
    if (schema.contains !== undefined) {
      const matches = value.filter((entry, index) => {
        try { validateSchemaSubset(root, schema.contains, entry, `${path}[${index}]`); return true; } catch { return false; }
      }).length;
      const minimum = schema.minContains ?? 1;
      if (matches < minimum) schemaError(path, 'array below minContains');
      if (schema.maxContains !== undefined && matches > schema.maxContains) schemaError(path, 'array above maxContains');
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const required = schema.required ?? [];
    for (const field of required) if (!Object.hasOwn(value, field)) schemaError(path, `missing required field ${field}`);
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, field)) schemaError(path, `unexpected field ${field}`);
    }
    for (const [field, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, field)) validateSchemaSubset(root, child, value[field], `${path}.${field}`);
  }
  return true;
}

function rebuildCampaign(campaign, overrides = {}) {
  return createEvaluationCampaign({ ...withoutHash(campaign, 'campaignHash'), ...overrides });
}

function parseGitRef(ref) {
  const match = /^git:([a-f0-9]{40}):([^#]+)(?:#(.+))?$/.exec(ref);
  assert.ok(match, `invalid immutable ref ${ref}`);
  return { commit: match[1], path: match[2], pointer: match[3] ?? null };
}

function pointerValue(value, pointer) {
  if (pointer === null || !pointer.startsWith('/')) return null;
  return pointer.split('/').slice(1).reduce((current, segment) => current[segment.replaceAll('~1', '/').replaceAll('~0', '~')], value);
}

function rawSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitResolver(reference) {
  const { commit, path, pointer } = parseGitRef(reference.ref);
  if (commit === SAFE_Q_SLICES.source.commit && path === SAFE_Q_SLICES.source.path) {
    if (pointer !== null && !Object.hasOwn(SAFE_Q_SLICES.projections, pointer)) throw Object.assign(new TypeError(`Q14 projection is not validation-safe: ${pointer}`), { code: 'ARENA_Q_UNSAFE_PROJECTION_REQUESTED' });
    const projectionValue = pointer === null ? undefined : clone(SAFE_Q_SLICES.projections[pointer]);
    return {
      gitObjectSha: SAFE_Q_SLICES.source.gitObjectSha,
      contentSha256: SAFE_Q_SLICES.source.contentSha256,
      projectionSha256: pointer === null ? null : sha256(`${canonicalize(projectionValue)}\n`),
      projectionValue,
    };
  }
  const object = execFileSync('git', ['rev-parse', `${commit}:${path}`], { cwd: REPO, encoding: 'utf8' }).trim();
  const kind = execFileSync('git', ['cat-file', '-t', object], { cwd: REPO, encoding: 'utf8' }).trim();
  const bytes = kind === 'tree'
    ? execFileSync('git', ['ls-tree', '-r', `${commit}:${path}`], { cwd: REPO })
    : execFileSync('git', ['show', `${commit}:${path}`], { cwd: REPO });
  let projectionSha256 = null;
  let projectionValue;
  if (pointer?.startsWith('/')) {
    const parsed = JSON.parse(execFileSync('git', ['show', `${commit}:${path}`], { cwd: REPO, encoding: 'utf8' }));
    projectionValue = pointerValue(parsed, pointer);
    projectionSha256 = sha256(`${canonicalize(projectionValue)}\n`);
  }
  return { gitObjectSha: object, contentSha256: rawSha256(bytes), projectionSha256, projectionValue };
}

function evaluate(campaign) {
  return evaluateTournament(campaign, gitResolver);
}

function allOwnerRefs() {
  return Object.values(REFS);
}

test('accepted Q14 source is build-time verified into four validation-safe owner slices', () => {
  const sourceSpec = `${SAFE_Q_SLICES.source.commit}:${SAFE_Q_SLICES.source.path}`;
  const safeSourceProjection = JSON.parse(execFileSync('sh', [
    '-c',
    'git show "$1" | jq -c \'{datasetDigest: .datasetDigest, folds: .plan.folds, spec: .plan.spec, status: .plan.status}\'',
    'strategy-arena-q-safe-slice',
    sourceSpec,
  ], { cwd: REPO, encoding: 'utf8' }));
  const sourceContentSha256 = execFileSync('sh', [
    '-c',
    'git show "$1" | shasum -a 256 | awk \'{print $1}\'',
    'strategy-arena-q-source-hash',
    sourceSpec,
  ], { cwd: REPO, encoding: 'utf8' }).trim();
  assert.equal(execFileSync('git', ['rev-parse', sourceSpec], { cwd: REPO, encoding: 'utf8' }).trim(), SAFE_Q_SLICES.source.gitObjectSha);
  assert.equal(sourceContentSha256, SAFE_Q_SLICES.source.contentSha256);
  assert.deepEqual(SAFE_Q_SLICES.projections, {
    '/datasetDigest': safeSourceProjection.datasetDigest,
    '/plan/folds': safeSourceProjection.folds,
    '/plan/spec': safeSourceProjection.spec,
    '/plan/status': safeSourceProjection.status,
  });
  for (const reference of [REFS.q14DatasetDigest, REFS.q14ValidationFolds, REFS.q14HoldoutPolicy, REFS.q14PlanStatus]) {
    const { pointer } = parseGitRef(reference.ref);
    assert.equal(sha256(`${canonicalize(SAFE_Q_SLICES.projections[pointer])}\n`), reference.projectionSha256);
  }
  assert.doesNotMatch(canonicalize(SAFE_Q_SLICES), /holdoutSampleIds|holdoutGrant|trialLedger|deflatedSharpe|multipleTesting|"pbo"/);
  const safeSampleIds = SAFE_Q_SLICES.projections['/plan/folds'].flatMap((fold) => [...fold.trainSampleIds, ...fold.validationSampleIds]);
  assert.equal(safeSampleIds.every((sampleId) => /^s-(?:00[0-5][0-9]|006[0-3])$/.test(sampleId)), true);
});

test('all pinned owner refs are shape-validated and bound into an honest caller attestation', () => {
  const attestation = validateOwnerReferenceSet(allOwnerRefs(), gitResolver);
  assert.equal(attestation.referenceShapeValidated, true);
  assert.equal(attestation.sourceBytesIndependentlyVerified, false);
  assert.equal(attestation.attestations.length, allOwnerRefs().length);
  assert.equal(attestation.resolverPosture, 'CALLER_SUPPLIED_PINNED_IDENTITY_ATTESTATION');
  assert.match(attestation.attestationHash, /^[a-f0-9]{64}$/);
  assert.equal(attestation.attestations.every((row) => /^[a-f0-9]{64}$/.test(row.referenceHash)), true);
});

test('owner resolver rejects malformed, duplicate, callback-mutated, and hash-mismatched identities', () => {
  assert.throws(() => createStrategySnapshot({ ...withoutHash(snapshot('basis', policy()), 'snapshotHash'), canonicalStrategyRef: 'git:HEAD:server/src/engine/basis' }), { code: 'ARENA_GIT_REF_INVALID' });
  assert.throws(() => createStrategySnapshot({ ...withoutHash(snapshot('basis', policy()), 'snapshotHash'), canonicalStrategyRef: `git:${BASE_SHA}:server/src/engine/**` }), { code: 'ARENA_GIT_REF_INVALID' });
  let calls = 0;
  const sentinel = () => { calls += 1; throw new Error('resolver must not run'); };
  assert.throws(() => validateOwnerReferenceSet([{ ...REFS.basisTree, ref: 'git:HEAD:server/src/engine/basis' }], sentinel), { code: 'ARENA_GIT_REF_INVALID' });
  assert.throws(() => validateOwnerReferenceSet([{ ...REFS.basisTree, injected: true }], sentinel), { code: 'ARENA_RECORD_SHAPE_INVALID' });
  assert.throws(() => validateOwnerReferenceSet([REFS.basisTree, REFS.basisTree], sentinel), { code: 'ARENA_OWNER_REFERENCE_DUPLICATE' });
  assert.equal(calls, 0);
  assert.throws(() => validateOwnerReferenceSet([REFS.q14ValidationFolds], () => ({ ...gitResolver(REFS.q14ValidationFolds), gitObjectSha: '0'.repeat(40) })), { code: 'ARENA_OWNER_REFERENCE_MISMATCH' });
  assert.throws(() => validateOwnerReferenceSet([clone(REFS.basisTree)], (reference) => { reference.contentSha256 = '0'.repeat(64); return gitResolver(REFS.basisTree); }), TypeError);
  const relabeled = { ...REFS.basisTree, schemaId: 'DifferentSchema', schemaVersion: '999', posture: 'SYNTHETIC_ONLY' };
  const left = validateOwnerReferenceSet([REFS.basisTree], (reference) => gitResolver({ ...reference, ...REFS.basisTree }));
  const right = validateOwnerReferenceSet([relabeled], () => gitResolver(REFS.basisTree));
  assert.notEqual(left.attestationHash, right.attestationHash);
  const identityReads = { gitObjectSha: 0, contentSha256: 0, projectionSha256: 0 };
  const unstableIdentity = {};
  for (const [field, expected, forged] of [
    ['gitObjectSha', REFS.basisTree.gitObjectSha, '0'.repeat(40)],
    ['contentSha256', REFS.basisTree.contentSha256, '0'.repeat(64)],
    ['projectionSha256', null, '0'.repeat(64)],
  ]) {
    Object.defineProperty(unstableIdentity, field, {
      enumerable: true,
      get() {
        identityReads[field] += 1;
        return identityReads[field] === 1 ? expected : forged;
      },
    });
  }
  const snapshotted = validateOwnerReferenceSet([REFS.basisTree], () => unstableIdentity);
  assert.deepEqual(snapshotted.attestations[0], {
    ref: REFS.basisTree.ref,
    gitObjectSha: REFS.basisTree.gitObjectSha,
    contentSha256: REFS.basisTree.contentSha256,
    projectionSha256: null,
    referenceHash: sha256(REFS.basisTree),
  });
  assert.deepEqual(identityReads, { gitObjectSha: 1, contentSha256: 1, projectionSha256: 1 });
  let lengthReads = 0;
  let lengthShiftResolverCalls = 0;
  const lengthShiftingReferences = new Proxy([REFS.basisTree], {
    get(target, field, receiver) {
      if (field !== 'length') return Reflect.get(target, field, receiver);
      lengthReads += 1;
      return lengthReads <= 2 ? 1 : 0;
    },
  });
  assert.throws(() => validateOwnerReferenceSet(lengthShiftingReferences, () => { lengthShiftResolverCalls += 1; return gitResolver(REFS.basisTree); }), { code: 'ARENA_OWNER_RESOLVER_REQUIRED' });
  assert.equal(lengthShiftResolverCalls, 0);
});

test('Q authority resolves only validation-safe Q14 leaves and keeps campaign selection pressure unavailable', () => {
  const authority = qAuthority();
  const requested = [];
  validateQValidationAuthorityAgainstOwner(authority, (reference) => { requested.push(reference.ref); return gitResolver(reference); });
  assert.deepEqual(requested.sort(), [REFS.q14DatasetDigest.ref, REFS.q14HoldoutPolicy.ref, REFS.q14PlanStatus.ref, REFS.q14ValidationFolds.ref].sort());
  assert.equal(requested.some((ref) => ref.endsWith('#/plan')), false);
  assert.equal(authority.validationFoldsDigest, '45d95a79c9ed28fedc488538405aa22c4684d4373fa82f59e5bd2daafad9ed71');
  assert.deepEqual(authority.folds, SAFE_Q_SLICES.projections['/plan/folds'].map((fold) => ({
    foldId: fold.foldId,
    status: fold.status,
    validationSampleIds: fold.validationSampleIds,
    validationStartCutoffNs: fold.validationStartCutoffNs,
    validationEndCutoffNs: fold.validationEndCutoffNs,
    purgedCount: fold.purgedCount,
    embargoedCount: fold.embargoedCount,
    groupConflictCount: fold.groupConflictCount,
  })));
  assert.equal(authority.holdoutAccessState, 'SEALED_REQUIRES_NEW_Q_GRANT_AND_REPLAY_BUNDLE');
  assert.doesNotMatch(canonicalize(authority), /holdoutSampleIds|holdoutGrant|trialLedger|multiplicityEvidence|recordedTrialCount/);
});

test('Q owner projection bytes must match the pinned projection digest before semantic use', () => {
  const authority = qAuthority();
  const forgedResolver = (reference) => {
    const resolved = gitResolver(reference);
    if (reference.ref !== REFS.q14ValidationFolds.ref) return resolved;
    const projectionValue = clone(resolved.projectionValue);
    projectionValue[0].validationSampleIds.push('FORGED_SAMPLE');
    return { ...resolved, projectionValue };
  };
  assert.throws(() => validateQValidationAuthorityAgainstOwner(authority, forgedResolver), { code: 'ARENA_Q_OWNER_PROJECTION_DIGEST_MISMATCH' });
  assert.throws(() => validateOwnerReferenceSet([REFS.q14ValidationFolds], forgedResolver), { code: 'ARENA_OWNER_PROJECTION_DIGEST_MISMATCH' });
  let undefinedFirstReads = 0;
  const undefinedFirstResolver = (reference) => {
    const stable = gitResolver(reference);
    if (reference.ref !== REFS.q14ValidationFolds.ref) return stable;
    return {
      gitObjectSha: stable.gitObjectSha,
      contentSha256: stable.contentSha256,
      projectionSha256: stable.projectionSha256,
      get projectionValue() {
        undefinedFirstReads += 1;
        return undefinedFirstReads === 1 ? undefined : clone(stable.projectionValue);
      },
    };
  };
  assert.throws(() => validateQValidationAuthorityAgainstOwner(authority, undefinedFirstResolver), { code: 'ARENA_Q_OWNER_PROJECTION_MISMATCH' });
  assert.equal(undefinedFirstReads, 1);
});

test('Q authority rejects unsafe scope, extra fold payload, oversized decimals, membership overlap, and owner drift', () => {
  const authority = qAuthority();
  assert.throws(() => qAuthority({ validationFoldsRef: { ...REFS.q14ValidationFolds, projectionSha256: '0'.repeat(64) } }), { code: 'ARENA_Q_FOLDS_DIGEST_MISMATCH' });
  assert.throws(() => qAuthority({ sourceArtifactRef: REFS.q14ValidationFolds }), { code: 'ARENA_Q_SOURCE_SCOPE_INVALID' });
  const relabeledSource = { ...REFS.q14Source, schemaId: 'AlternateQ14Schema' };
  assert.throws(() => createQValidationAuthority({ ...withoutHash(authority, 'qAuthorityHash'), sourceArtifactRef: relabeledSource }), { code: 'ARENA_Q_ACCEPTED_IDENTITY_MISMATCH' });
  const unsafePlanRef = ownerRef({ commit: Q_SHA, path: SAFE_Q_SLICES.source.path, pointer: '/plan', gitObjectSha: SAFE_Q_SLICES.source.gitObjectSha, contentSha256: SAFE_Q_SLICES.source.contentSha256, projectionSha256: '061a147448835f17ed74dc1739db1866e74c94d80effe97e8d58e8cafa9b2bd6', schemaId: 'Q14WalkForwardPlanV1', posture: 'SYNTHETIC_ONLY' });
  assert.throws(() => qAuthority({ validationFoldsRef: unsafePlanRef, validationFoldsDigest: unsafePlanRef.projectionSha256 }), { code: 'ARENA_Q_SAFE_PROJECTION_REF_INVALID' });
  const overlapping = clone(authority.folds);
  overlapping[1].validationSampleIds[0] = overlapping[0].validationSampleIds[0];
  overlapping[1].validationSampleIds.sort();
  assert.throws(() => createQValidationAuthority({ ...withoutHash(authority, 'qAuthorityHash'), folds: overlapping }), { code: 'ARENA_Q_MEMBERSHIP_OVERLAP' });
  const oversized = clone(authority.folds);
  oversized[0].validationEndCutoffNs = '9'.repeat(3_000);
  assert.throws(() => createQValidationAuthority({ ...withoutHash(authority, 'qAuthorityHash'), folds: oversized }), { code: 'ARENA_DECIMAL_STRING_INVALID' });
  const driftedFolds = clone(authority.folds);
  driftedFolds[0].validationSampleIds[0] = 's-9999';
  driftedFolds[0].validationSampleIds.sort();
  const drifted = createQValidationAuthority({ ...withoutHash(authority, 'qAuthorityHash'), folds: driftedFolds });
  assert.throws(() => validateQValidationAuthorityAgainstOwner(drifted, gitResolver), { code: 'ARENA_Q_PLAN_SEMANTIC_MISMATCH' });
  const forgedOwnerFolds = clone(SAFE_Q_SLICES.projections['/plan/folds']);
  forgedOwnerFolds[0].validationSampleIds[0] = 's-9999';
  forgedOwnerFolds[0].validationSampleIds.sort();
  let projectionReads = 0;
  const unstableProjectionResolver = (reference) => {
    if (reference.ref !== REFS.q14ValidationFolds.ref) return gitResolver(reference);
    const stable = gitResolver(reference);
    const output = {
      gitObjectSha: stable.gitObjectSha,
      contentSha256: stable.contentSha256,
      projectionSha256: stable.projectionSha256,
    };
    Object.defineProperty(output, 'projectionValue', {
      enumerable: true,
      get() {
        projectionReads += 1;
        return clone(projectionReads <= 2 ? SAFE_Q_SLICES.projections['/plan/folds'] : forgedOwnerFolds);
      },
    });
    return output;
  };
  assert.throws(() => validateQValidationAuthorityAgainstOwner(drifted, unstableProjectionResolver), { code: 'ARENA_Q_PLAN_SEMANTIC_MISMATCH' });
  assert.equal(projectionReads, 1);
  const ownerFolds = clone(SAFE_Q_SLICES.projections['/plan/folds']);
  ownerFolds[0].holdoutSampleIds = ['s-0064'];
  const projectionSha256 = sha256(`${canonicalize(ownerFolds)}\n`);
  assert.throws(() => qAuthority({ validationFoldsRef: { ...REFS.q14ValidationFolds, projectionSha256 }, validationFoldsDigest: projectionSha256 }), { code: 'ARENA_Q_ACCEPTED_IDENTITY_MISMATCH' });
});

test('snapshots are deterministic, deeply frozen, policy-bound, and materially hashed', () => {
  const arenaPolicy = policy();
  const left = snapshot('basis', arenaPolicy);
  const right = snapshot('basis', arenaPolicy);
  assert.equal(left.snapshotHash, right.snapshotHash);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.qExperimentAndModelRefs), true);
  assert.deepEqual(left.qExperimentAndModelRefs, []);
  assert.throws(() => left.qExperimentAndModelRefs.push(REFS.q14ValidationFolds), TypeError);
  const changed = snapshot('basis', arenaPolicy, { seed: 20260717 });
  assert.notEqual(changed.snapshotHash, left.snapshotHash);
  assert.equal(left.canonicalStrategyHash, 'fa6ff1969828e980710cd273a3e207239dfb64ba');
  assert.throws(() => createStrategySnapshot({ ...withoutHash(left, 'snapshotHash'), canonicalStrategyHash: '0'.repeat(40) }), { code: 'ARENA_STRATEGY_EVIDENCE_BINDING_MISMATCH' });
});

test('fixture economics is exact, reconciled, and never claims owner verification or attribution', () => {
  const fact = economics('E1', 'snapshot.basis.v1', { gross: '999', net: '984', fees: '1', slippage: '2', fundingBorrow: '3', latency: '4', recovery: '5' });
  assert.equal(fact.fixtureNetOutcomeMicros, '984');
  assert.equal(fact.accountingStatus, 'FIXTURE_PROVIDED');
  assert.equal(fact.attributionComputed, false);
  const tampered = clone(fact);
  tampered.fixtureFactRef = 'fixture://strategy-arena/economics/tampered';
  assert.throws(() => validateSyntheticEconomicProjection(tampered), { code: 'ARENA_RECORD_HASH_MISMATCH' });
  assert.throws(() => economics('E1', 'snapshot.basis.v1', { gross: '999', net: '-17', fees: '1', slippage: '2', fundingBorrow: '3', latency: '4', recovery: '5' }), { code: 'ARENA_ECONOMIC_IDENTITY_MISMATCH' });
  assert.throws(() => createSyntheticEconomicProjection({ ...withoutHash(fact, 'economicFactHash'), costMicros: { ...fact.costMicros, slippage: null } }), { code: 'ARENA_ECONOMICS_INCOMPLETE' });
  assert.throws(() => economics('E1', 'snapshot.basis.v1', { fees: '-1' }), { code: 'ARENA_MICROS_INVALID' });
});

test('partial owner unknowns remain explicit and no exposure is not fabricated zero', () => {
  const partial = economics('E1', 'snapshot.basis.v1', {
    state: 'UNKNOWN',
    overrides: {
      grossOutcomeMicros: '100',
      costMicros: { fees: '1', slippage: null, fundingBorrow: '0', latency: '0', recovery: '0' },
      fixtureNetOutcomeMicros: null,
    },
  });
  assert.equal(partial.costMicros.slippage, null);
  assert.equal(partial.fixtureNetOutcomeMicros, null);
  const none = economics('E2', 'snapshot.basis.v1', { state: 'NO_EXPOSURE' });
  assert.equal(none.grossOutcomeMicros, null);
  assert.equal(none.costMicros, null);
  assert.equal(none.fixtureNetOutcomeMicros, null);
  assert.equal(none.accountingStatus, 'NOT_APPLICABLE');
  assert.throws(() => outcome('E9', 'UNKNOWN', 'CLEAR', { state: 'AVAILABLE' }), { code: 'ARENA_OUTCOME_AVAILABLE_UNKNOWN' });
  const completeButMarkedIncomplete = withoutHash(economics('E1', 'snapshot.basis.v1'), 'economicFactHash');
  completeButMarkedIncomplete.state = 'UNKNOWN';
  completeButMarkedIncomplete.accountingStatus = 'INCOMPLETE';
  completeButMarkedIncomplete.reasonCodes = ['FALSE_INCOMPLETE'];
  assert.throws(() => createSyntheticEconomicProjection(completeButMarkedIncomplete), { code: 'ARENA_ECONOMICS_INCOMPLETE_STATE_FALSE' });
  const unavailable = economics('E1', 'snapshot.basis.v1', { state: 'UNKNOWN', overrides: { grossOutcomeMicros: null, costMicros: null, fixtureNetOutcomeMicros: null, accountingStatus: 'UNAVAILABLE', reasonCodes: ['OWNER_ECONOMICS_UNAVAILABLE'] } });
  assert.equal(validateSyntheticEconomicProjection(unavailable), true);
  for (const injected of [
    { grossOutcomeMicros: '1' },
    { fixtureNetOutcomeMicros: '0' },
    { costMicros: { fees: null, slippage: null, fundingBorrow: null, latency: null, recovery: null } },
  ]) assert.throws(() => createSyntheticEconomicProjection({ ...withoutHash(unavailable, 'economicFactHash'), ...injected }), { code: 'ARENA_ECONOMICS_UNAVAILABLE_VALUE_PRESENT' });
});

test('acted, blocked, non-action, and data-invalid observation semantics fail closed', () => {
  const { basis, contexts } = baseTournament();
  const blocked = createShadowExposureProjection({
    ...withoutHash(observation(basis, contexts[1], { disposition: 'REJECTED', exposureOptions: { allocationState: 'BLOCKED', demandUnits: 10 } }).shadowExposure, 'exposureFactHash'),
    allocationState: 'BLOCKED',
    demandUnits: 10,
  });
  const acted = withoutHash(observation(basis, contexts[0]), 'observationHash');
  assert.throws(() => createStrategyObservation({ ...acted, shadowExposure: blocked }), { code: 'ARENA_ACTED_WITHOUT_EXPOSURE' });
  assert.throws(() => createStrategyObservation({ ...acted, servingPosture: 'ABSTAIN_UNKNOWN' }), { code: 'ARENA_ACTED_POSTURE_INVALID' });
  const rejected = withoutHash(observation(basis, contexts[1], { disposition: 'REJECTED' }), 'observationHash');
  assert.throws(() => createStrategyObservation({ ...rejected, economics: economics('E2', basis.snapshotId) }), { code: 'ARENA_COUNTERFACTUAL_ECONOMICS_FORBIDDEN' });
  assert.equal(observation(basis, contexts[1], { disposition: 'DATA_INVALID' }).servingPosture, 'ABSTAIN_UNKNOWN');
  const exposed = withoutHash(observation(basis, contexts[0]).shadowExposure, 'exposureFactHash');
  assert.throws(() => createShadowExposureProjection({ ...exposed, demandUnits: 11 }), { code: 'ARENA_CAPACITY_STATE_INVALID' });
  assert.throws(() => createShadowExposureProjection({ ...exposed, allocationState: 'CAPPED' }), { code: 'ARENA_CAPACITY_STATE_INVALID' });
  assert.throws(() => createShadowExposureProjection({ ...exposed, closedAtMs: exposed.openedAtMs }), { code: 'ARENA_EXPOSURE_DURATION_INVALID' });
  const notRequested = withoutHash(observation(basis, contexts[1], { disposition: 'REJECTED' }).shadowExposure, 'exposureFactHash');
  assert.throws(() => createShadowExposureProjection({ ...notRequested, demandUnits: 1 }), { code: 'ARENA_CAPACITY_STATE_INVALID' });
  assert.throws(() => createShadowExposureProjection({ ...notRequested, allocationState: 'BLOCKED' }), { code: 'ARENA_CAPACITY_STATE_INVALID' });

  const actedObservation = observation(basis, contexts[0]);
  const unknownEconomics = economics('E1', basis.snapshotId, {
    state: 'UNKNOWN',
    overrides: {
      grossOutcomeMicros: null,
      costMicros: null,
      fixtureNetOutcomeMicros: null,
      accountingStatus: 'UNAVAILABLE',
      reasonCodes: ['OWNER_ECONOMICS_UNAVAILABLE'],
    },
  });
  const hashBoundUnknown = {
    ...withoutHash(actedObservation, 'observationHash'),
    economics: unknownEconomics,
  };
  hashBoundUnknown.observationHash = sha256(hashBoundUnknown);
  let economicsReads = 0;
  const unstableObservation = new Proxy(hashBoundUnknown, {
    get(target, field, receiver) {
      if (field !== 'economics') return Reflect.get(target, field, receiver);
      economicsReads += 1;
      return economicsReads <= 1 ? actedObservation.economics : target.economics;
    },
  });
  assert.throws(() => validateStrategyObservation(unstableObservation), { code: 'ARENA_RECORD_HASH_MISMATCH' });
  assert.equal(economicsReads, 1);
});

test('one immutable event context anchors fold, time, symbol, regime, scenario, evidence, and outcome truth', () => {
  const context = eventContext(1, 's-0013', 'fold-01', 'FAVORABLE');
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.outcome), true);
  const changed = eventContext(1, 's-0013', 'fold-01', 'FAVORABLE', 'CLEAR', { symbol: 'ETHUSDT' });
  assert.notEqual(changed.eventContextHash, context.eventContextHash);
  const tampered = clone(context);
  tampered.regime = 'TAMPERED';
  assert.throws(() => validateEventContext(tampered), { code: 'ARENA_RECORD_HASH_MISMATCH' });
});

test('campaign enforces exact same-event matrix, unique identities, and shared-context resolution', () => {
  const { campaign, contexts } = baseTournament();
  assert.throws(() => rebuildCampaign(campaign, { observations: campaign.observations.slice(1) }), { code: 'ARENA_EVENT_MATRIX_INCOMPLETE' });
  assert.throws(() => rebuildCampaign(campaign, { observations: [...campaign.observations, campaign.observations[0]] }), { code: 'ARENA_OBSERVATION_DUPLICATE' });
  const foreign = withoutHash(campaign.observations[0], 'observationHash');
  foreign.eventContextHash = 'f'.repeat(64);
  const foreignRow = createStrategyObservation(foreign);
  assert.throws(() => rebuildCampaign(campaign, { observations: [foreignRow, ...campaign.observations.slice(1)] }), { code: 'ARENA_EVENT_CONTEXT_UNRESOLVED' });
  assert.throws(() => rebuildCampaign(campaign, { seed: campaign.seed + 1 }), { code: 'ARENA_SEED_BINDING_MISMATCH' });
  assert.throws(() => rebuildCampaign(campaign, { strategyRecordedTrialCount: 3 }), { code: 'ARENA_STRATEGY_TRIAL_EVIDENCE_INVALID' });
  assert.throws(() => rebuildCampaign(campaign, { strategySelectionPressureRefs: [REFS.q15ExperimentCard] }), { code: 'ARENA_SELECTION_PRESSURE_EVIDENCE_INVALID' });
  assert.throws(() => policy({ metricOrder: [...campaign.evaluationPolicy.metricOrder.slice(0, -1), campaign.evaluationPolicy.metricOrder[0]] }), { code: 'ARENA_STRING_ARRAY_DUPLICATE' });
  assert.throws(() => rebuildCampaign(campaign, { scenarioReferences: Array.from({ length: 33 }, () => scenarioReference()) }), { code: 'ARENA_SCENARIO_SET_INVALID' });
  const alteredScenario = createScenarioReference({ ...withoutHash(scenarioReference(), 'scenarioHash'), seed: 716 });
  const alteredContexts = campaign.eventContexts.map((context) => createEventContext({ ...withoutHash(context, 'eventContextHash'), scenarioHash: alteredScenario.scenarioHash }));
  const alteredContextHashes = new Map(campaign.eventContexts.map((context, index) => [context.eventContextHash, alteredContexts[index].eventContextHash]));
  const alteredRows = campaign.observations.map((row) => createStrategyObservation({ ...withoutHash(row, 'observationHash'), eventContextHash: alteredContextHashes.get(row.eventContextHash) }));
  assert.throws(() => rebuildCampaign(campaign, { scenarioReferences: [alteredScenario], eventContexts: alteredContexts, observations: alteredRows }), { code: 'ARENA_SCENARIO_IDENTITY_MISMATCH' });
  assert.throws(() => validateScenarioReferences([alteredScenario]), { code: 'ARENA_SCENARIO_IDENTITY_MISMATCH' });
  const duplicateSampleContext = eventContext(2, 's-0013', 'fold-01', 'UNFAVORABLE');
  const duplicateSampleRows = campaign.observations.map((row) => row.eventContextHash === contexts[1].eventContextHash ? createStrategyObservation({ ...withoutHash(row, 'observationHash'), eventContextHash: duplicateSampleContext.eventContextHash }) : row);
  assert.throws(() => rebuildCampaign(campaign, { eventContexts: campaign.eventContexts.map((context) => context.eventId === 'E2' ? duplicateSampleContext : context), observations: duplicateSampleRows }), { code: 'ARENA_Q_SAMPLE_DUPLICATE' });
});

test('campaign derivation snapshots caller input before validation and return', () => {
  const campaign = clone(baseTournament().campaign);
  let campaignIdReads = 0;
  const unstableCampaign = new Proxy(campaign, {
    get(target, field, receiver) {
      if (field !== 'campaignId') return Reflect.get(target, field, receiver);
      campaignIdReads += 1;
      return campaignIdReads <= 2 ? target.campaignId : 'FORGED-CAMPAIGN-ID';
    },
  });
  const snapshotted = cloneValidatedCampaign(unstableCampaign);
  assert.equal(snapshotted.campaignId, campaign.campaignId);
  assert.equal(campaignIdReads, 1);
  assert.doesNotThrow(() => validateEvaluationCampaign(snapshotted));
});

test('campaign-wide owner references are bounded before report generation', () => {
  const base = baseTournament();
  const excessRefs = Array.from({ length: 55 }, (_, index) => ownerRef({
    commit: BASE_SHA,
    path: 'server/src/engine/basis/index.ts',
    pointer: `/synthetic-model-${String(index).padStart(2, '0')}`,
    gitObjectSha: '1'.repeat(40),
    contentSha256: '2'.repeat(64),
    projectionSha256: '3'.repeat(64),
    schemaId: 'SyntheticOwnerRefForBoundTest',
    posture: 'SYNTHETIC_ONLY',
  })).sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  const widenedBasis = createStrategySnapshot({ ...withoutHash(base.basis, 'snapshotHash'), qExperimentAndModelRefs: excessRefs });
  assert.throws(() => rebuildCampaign(base.campaign, {
    strategySnapshots: base.campaign.strategySnapshots.map((entry) => entry.snapshotId === base.basis.snapshotId ? widenedBasis : entry),
    observations: base.campaign.observations.map((row) => row.strategySnapshotHash === base.basis.snapshotHash ? createStrategyObservation({ ...withoutHash(row, 'observationHash'), strategySnapshotHash: widenedBasis.snapshotHash }) : row),
  }), { code: 'ARENA_CAMPAIGN_OWNER_REFERENCE_LIMIT' });
});

test('iteration admits only temporally valid Q members and exposes no final-holdout phase, grant, membership, or source blob', () => {
  const { campaign, contexts } = baseTournament();
  const badContext = eventContext(1, 's-0012', 'fold-01', 'FAVORABLE');
  const replacedContexts = campaign.eventContexts.map((context) => context.eventId === 'E1' ? badContext : context);
  const replacedRows = campaign.observations.map((row) => row.eventContextHash === contexts[0].eventContextHash ? createStrategyObservation({ ...withoutHash(row, 'observationHash'), eventContextHash: badContext.eventContextHash }) : row);
  assert.throws(() => rebuildCampaign(campaign, { eventContexts: replacedContexts, observations: replacedRows }), { code: 'ARENA_Q_VALIDATION_MEMBERSHIP_MISMATCH' });
  assert.throws(() => rebuildCampaign(campaign, { qHoldoutGrant: {} }), { code: 'ARENA_RECORD_SHAPE_INVALID' });
  assert.throws(() => rebuildCampaign(campaign, { campaignPhase: 'RECORDED_FINAL_HOLDOUT_REPLAY' }), { code: 'ARENA_ENUM_INVALID' });
  assert.throws(() => createEventContext({ ...withoutHash(contexts[0], 'eventContextHash'), partition: 'FINAL_HOLDOUT' }), { code: 'ARENA_ENUM_INVALID' });
  const lateContext = createEventContext({ ...withoutHash(contexts[0], 'eventContextHash'), eventTimeMs: contexts[0].eventTimeMs + 100_000_000, receiveTimeMs: contexts[0].eventTimeMs + 100_000_100 });
  const lateRows = campaign.observations.map((row) => row.eventContextHash === contexts[0].eventContextHash ? createStrategyObservation({ ...withoutHash(row, 'observationHash'), eventContextHash: lateContext.eventContextHash }) : row);
  assert.throws(() => rebuildCampaign(campaign, { eventContexts: campaign.eventContexts.map((context) => context.eventId === 'E1' ? lateContext : context), observations: lateRows }), { code: 'ARENA_Q_FOLD_TIME_MISMATCH' });
  const rowIndex = campaign.observations.findIndex((row) => row.eventContextHash === contexts[0].eventContextHash && row.strategySnapshotHash === campaign.strategySnapshots[0].snapshotHash);
  const earlyExposure = createShadowExposureProjection({ ...withoutHash(campaign.observations[rowIndex].shadowExposure, 'exposureFactHash'), openedAtMs: contexts[0].eventTimeMs - 1 });
  const earlyRows = [...campaign.observations];
  earlyRows[rowIndex] = createStrategyObservation({ ...withoutHash(earlyRows[rowIndex], 'observationHash'), shadowExposure: earlyExposure });
  assert.throws(() => rebuildCampaign(campaign, { observations: earlyRows }), { code: 'ARENA_EXPOSURE_TIME_INVALID' });
  assert.equal(campaign.qValidationAuthority.sourceArtifactRef.ref.includes('#'), false);
  assert.equal(campaign.qValidationAuthority.validationFoldsRef.ref.endsWith('#/plan/folds'), true);
  assert.equal(campaign.qValidationAuthority.holdoutPolicyRef.ref.endsWith('#/plan/spec'), true);
  assert.doesNotMatch(canonicalize(campaign), /holdoutSampleIds|holdoutGrant|trialLedger|deflatedSharpe|multipleTesting|"pbo"/);
});

test('base tournament yields exact owner-preserving scorecards and Pareto tiers', () => {
  const { campaign } = baseTournament();
  const report = evaluate(campaign);
  assert.equal(report.truthClass, 'ADVISORY');
  assert.equal(report.canonical, false);
  assert.equal(report.attributionComputed, false);
  assert.equal(report.decisionAlternativesComputed, false);
  assert.deepEqual(report.ranking.tiers, [['snapshot.basis.v1'], ['snapshot.volume.v1']]);
  assert.equal(report.ranking.singleMetricWinnerSelected, false);
  const basis = report.scorecards.find((card) => card.snapshotId === 'snapshot.basis.v1');
  const volume = report.scorecards.find((card) => card.snapshotId === 'snapshot.volume.v1');
  assert.equal(basis.shadowPortfolio.fixtureNetOutcomeMicros, '430');
  assert.equal(volume.shadowPortfolio.fixtureNetOutcomeMicros, '135');
  assert.equal(basis.nonActionQuality.qualityPpm, 1_000_000);
  assert.equal(volume.nonActionQuality.qualityPpm, 0);
  assert.equal(volume.falsePositiveCount, 1);
  assert.equal(basis.stability.slices.some((slice) => slice.sliceId.startsWith('fold:')), true);
});

test('MISSED disposition is included in harmful non-action and missed-opportunity accounting', () => {
  const base = baseTournament();
  const rows = base.campaign.observations.map((row) => {
    if (row.strategySnapshotHash !== base.basis.snapshotHash || row.eventContextHash !== base.contexts[0].eventContextHash) return row;
    return observation(base.basis, base.contexts[0], { disposition: 'MISSED' });
  });
  const card = evaluate(rebuildCampaign(base.campaign, { observations: rows })).scorecards.find((entry) => entry.snapshotId === base.basis.snapshotId);
  assert.deepEqual(card.nonActionQuality.dispositions, ['EXPIRED', 'MISSED', 'QUIET_CONTROL', 'REJECTED']);
  assert.equal(card.nonActionQuality.harmful, 1);
  assert.equal(card.missedOpportunityCount, 1);
});

test('tournament hash and ranking are invariant under strategy, event, and observation permutations', () => {
  const { campaign } = baseTournament();
  const permuted = rebuildCampaign(campaign, {
    strategySnapshots: [...campaign.strategySnapshots].reverse(),
    eventContexts: [...campaign.eventContexts].reverse(),
    observations: [...campaign.observations].reverse(),
  });
  assert.equal(permuted.campaignHash, campaign.campaignHash);
  assert.equal(evaluate(permuted).reportHash, evaluate(campaign).reportHash);
});

test('resolver callbacks cannot mutate the campaign after validation and change scored truth under the old hash', () => {
  const original = clone(baseTournament().campaign);
  const baseline = evaluate(original);
  let mutated = false;
  const report = evaluateTournament(original, (reference) => {
    if (!mutated) {
      const acted = original.observations.find((row) => row.economics.state === 'AVAILABLE');
      acted.economics.fixtureNetOutcomeMicros = '999999';
      mutated = true;
    }
    return gitResolver(reference);
  });
  assert.equal(mutated, true);
  assert.equal(original.observations.some((row) => row.economics.fixtureNetOutcomeMicros === '999999'), true);
  assert.equal(report.reportHash, baseline.reportHash);
  assert.deepEqual(report.scorecards, baseline.scorecards);
});

test('cost-aware owner projections can move a dominated strategy onto the Pareto front without selecting one winner', () => {
  const base = baseTournament();
  const rows = [...base.campaign.observations];
  for (const eventId of ['E1', 'E2', 'E4']) {
    const index = rows.findIndex((row) => row.strategySnapshotHash === base.volume.snapshotHash && base.contexts.find((context) => context.eventId === eventId).eventContextHash === row.eventContextHash);
    const context = base.contexts.find((entry) => entry.eventId === eventId);
    rows[index] = observation(base.volume, context, { economicsOptions: { gross: '700', net: '600', fees: '60', slippage: '20', fundingBorrow: '10', latency: '10', recovery: '0' }, contention: eventId === 'E4' ? ['fixture://capital/contention/E4'] : [] });
  }
  const changed = evaluate(rebuildCampaign(base.campaign, { observations: rows }));
  assert.deepEqual(changed.ranking.tiers[0], ['snapshot.basis.v1', 'snapshot.volume.v1']);
  assert.equal(changed.ranking.automaticWinnerSelected, false);
  assert.equal(changed.metaAllocationAdvisory.state, 'NO_PROPOSAL');
  assert.equal(changed.metaAllocationAdvisory.reviewClass, 'SELECTION_PRESSURE_UNAVAILABLE');
  assert.equal(changed.metaAllocationAdvisory.relativeWeightsPpm, null);
  assert.equal(changed.metaAllocationAdvisory.capitalAmounts, null);
});

test('unknown required metrics and zero denominators exclude a card instead of fabricating perfect scores', () => {
  const base = baseTournament();
  const allActedRows = base.campaign.observations.map((row) => {
    if (row.strategySnapshotHash !== base.basis.snapshotHash || row.decisionDisposition === 'ACTED') return row;
    const context = base.contexts.find((entry) => entry.eventContextHash === row.eventContextHash);
    return observation(base.basis, context, { economicsOptions: { gross: '100', net: '60' } });
  });
  const report = evaluate(rebuildCampaign(base.campaign, { observations: allActedRows }));
  const basis = report.scorecards.find((card) => card.snapshotId === base.basis.snapshotId);
  assert.equal(basis.nonActionQuality.qualityPpm, null);
  assert.equal(basis.comparability, 'ABSTAIN_UNKNOWN');
  assert.equal(basis.metricValues, null);
  assert.equal(report.ranking.excluded.includes(base.basis.snapshotId), true);
  assert.equal(report.lifecycleAdvisories.find((item) => item.targetSnapshotHash === base.basis.snapshotHash).state, 'ABSTAIN_UNKNOWN');
});

test('partial economics, unknown outcomes, and data-invalid observations null dependent ranking and proposals', () => {
  const base = baseTournament();
  const rows = base.campaign.observations.map((row) => {
    if (row.strategySnapshotHash !== base.basis.snapshotHash || row.eventContextHash !== base.contexts[0].eventContextHash) return row;
    return observation(base.basis, base.contexts[0], {
      disposition: 'DATA_INVALID',
      economicsOptions: { overrides: { grossOutcomeMicros: '100', costMicros: { fees: '1', slippage: null, fundingBorrow: '0', latency: '0', recovery: '0' }, fixtureNetOutcomeMicros: null } },
    });
  });
  const report = evaluate(rebuildCampaign(base.campaign, { observations: rows }));
  const card = report.scorecards.find((entry) => entry.snapshotId === base.basis.snapshotId);
  assert.equal(card.comparability, 'ABSTAIN_UNKNOWN');
  assert.equal(card.shadowPortfolio.fixtureNetOutcomeMicros, null);
  assert.equal(card.unknownReasons.some((reason) => reason.startsWith('DATA_INVALID:')), true);
  const comparison = report.sameEventComparison.comparisons.find((entry) => entry.eventId === 'E1').strategies.find((entry) => entry.snapshotId === base.basis.snapshotId);
  assert.equal(comparison.economicState, 'UNKNOWN');
  assert.equal(comparison.fixtureNetOutcomeMicros, null);
});

test('shadow windows prove overlap geometry and preserve owner-declared contention without allocating', () => {
  const report = evaluate(baseTournament().campaign);
  assert.equal(report.opportunityOverlapAndContention.overlapCount, 2);
  assert.deepEqual(report.opportunityOverlapAndContention.ownerDeclaredContentionRefs, ['fixture://capital/contention/E4']);
  assert.equal(report.opportunityOverlapAndContention.capitalConflictInferred, false);
  assert.equal(report.opportunityOverlapAndContention.allocationPerformed, false);
  assert.equal(report.sameEventComparison.oneSharedContextPerEvent, true);
});

test('overlap analysis catches cross-opportunity concurrency and capacity capping counts against performance', () => {
  const base = baseTournament();
  const rows = [...base.campaign.observations];
  const basisE1Index = rows.findIndex((row) => row.strategySnapshotHash === base.basis.snapshotHash && row.eventContextHash === base.contexts[0].eventContextHash);
  const longExposure = createShadowExposureProjection({
    ...withoutHash(rows[basisE1Index].shadowExposure, 'exposureFactHash'),
    closedAtMs: base.contexts[1].eventTimeMs + 1_000,
  });
  rows[basisE1Index] = createStrategyObservation({ ...withoutHash(rows[basisE1Index], 'observationHash'), shadowExposure: longExposure });
  const overlapReport = evaluate(rebuildCampaign(base.campaign, { observations: rows }));
  assert.equal(overlapReport.opportunityOverlapAndContention.overlapCount, 3);
  assert.equal(overlapReport.opportunityOverlapAndContention.overlaps.some((entry) => entry.eventIds[0] !== entry.eventIds[1]), true);

  const cappedRows = [...base.campaign.observations];
  const cappedExposure = createShadowExposureProjection({
    ...withoutHash(cappedRows[basisE1Index].shadowExposure, 'exposureFactHash'),
    allocationState: 'CAPPED',
    demandUnits: 20,
    grantedUnits: 10,
  });
  cappedRows[basisE1Index] = createStrategyObservation({ ...withoutHash(cappedRows[basisE1Index], 'observationHash'), shadowExposure: cappedExposure });
  const cappedCard = evaluate(rebuildCampaign(base.campaign, { observations: cappedRows })).scorecards.find((card) => card.snapshotId === base.basis.snapshotId);
  assert.equal(cappedCard.capacityConstraintCount, 1);
  assert.equal(cappedCard.capacityConstraintRatePpm, 250_000);
  assert.equal(cappedCard.metricValues.CAPACITY_CONSTRAINT_RATE_PPM_INVERTED, 750_000);
});

test('global overlap analysis includes concurrent opportunities from one frozen strategy package', () => {
  const base = baseTournament();
  const rows = base.campaign.observations.map((row) => {
    const context = base.contexts.find((entry) => entry.eventContextHash === row.eventContextHash);
    if (row.strategySnapshotHash === base.volume.snapshotHash) return observation(base.volume, context, { disposition: 'REJECTED' });
    if (row.strategySnapshotHash !== base.basis.snapshotHash || context.eventId !== 'E1') return row;
    const longExposure = createShadowExposureProjection({
      ...withoutHash(row.shadowExposure, 'exposureFactHash'),
      closedAtMs: base.contexts[2].eventTimeMs + 1_000,
    });
    return createStrategyObservation({ ...withoutHash(row, 'observationHash'), shadowExposure: longExposure });
  });
  const overlaps = evaluate(rebuildCampaign(base.campaign, { observations: rows })).opportunityOverlapAndContention.overlaps;
  assert.equal(overlaps.some((entry) => entry.snapshotIds[0] === base.basis.snapshotId
    && entry.snapshotIds[1] === base.basis.snapshotId
    && entry.eventIds.includes('E1')
    && entry.eventIds.includes('E3')), true);
});

test('campaign rejects aggregate arithmetic overflow before evaluation', () => {
  const base = baseTournament();
  const rows = base.campaign.observations.map((row) => {
    if (row.strategySnapshotHash !== base.basis.snapshotHash || row.decisionDisposition !== 'ACTED') return row;
    const context = base.contexts.find((entry) => entry.eventContextHash === row.eventContextHash);
    return observation(base.basis, context, { economicsOptions: { gross: '400000000040', net: '400000000000' } });
  });
  assert.throws(() => rebuildCampaign(base.campaign, { observations: rows }), { code: 'ARENA_CAMPAIGN_AGGREGATION_OVERFLOW' });

  const combinedCostRows = [...base.campaign.observations];
  const target = combinedCostRows.findIndex((row) => row.strategySnapshotHash === base.basis.snapshotHash && row.decisionDisposition === 'ACTED');
  const context = base.contexts.find((entry) => entry.eventContextHash === combinedCostRows[target].eventContextHash);
  combinedCostRows[target] = observation(base.basis, context, {
    economicsOptions: {
      overrides: {
        grossOutcomeMicros: '1000000000000',
        costMicros: { fees: '600000000000', slippage: '600000000000', fundingBorrow: '0', latency: '0', recovery: '0' },
        fixtureNetOutcomeMicros: '-200000000000',
      },
    },
  });
  assert.throws(() => rebuildCampaign(base.campaign, { observations: combinedCostRows }), { code: 'ARENA_CAMPAIGN_AGGREGATION_OVERFLOW' });
});

test('same Q/model source is one evidence family and blocks a meta-allocation proposal', () => {
  const report = evaluate(baseTournament({ snapshotOverrides: { basis: { qExperimentAndModelRefs: [REFS.q15ExperimentCard] }, volume: { qExperimentAndModelRefs: [REFS.q15ExperimentCard] } } }).campaign);
  assert.equal(report.sourceDependenceWarnings.length, 1);
  assert.equal(report.sourceDependenceWarnings[0].independentConfirmationCount, 1);
  assert.equal(report.metaAllocationAdvisory.state, 'NO_PROPOSAL');
  assert.equal(report.metaAllocationAdvisory.reviewClass, 'SELECTION_PRESSURE_UNAVAILABLE');
  assert.equal(report.metaAllocationAdvisory.relativeWeightsPpm, null);
  assert.equal(report.metaAllocationAdvisory.capitalAmounts, null);
});

test('different projections from one Q artifact remain one correlated evidence family', () => {
  const base = baseTournament({ snapshotOverrides: { basis: { qExperimentAndModelRefs: [REFS.q15LogisticModelCard] }, volume: { qExperimentAndModelRefs: [REFS.q15XgbModelCard] } } });
  const rows = [...base.campaign.observations];
  for (const eventId of ['E1', 'E2', 'E4']) {
    const context = base.contexts.find((entry) => entry.eventId === eventId);
    const index = rows.findIndex((row) => row.strategySnapshotHash === base.volume.snapshotHash && row.eventContextHash === context.eventContextHash);
    rows[index] = observation(base.volume, context, { economicsOptions: { gross: '700', net: '600', fees: '60', slippage: '20', fundingBorrow: '10', latency: '10', recovery: '0' }, contention: eventId === 'E4' ? ['fixture://capital/contention/E4'] : [] });
  }
  const report = evaluate(rebuildCampaign(base.campaign, { observations: rows }));
  assert.equal(report.sourceDependenceWarnings.length, 1);
  assert.deepEqual(report.sourceDependenceWarnings[0].sharedDerivedSourceFamilyIds, [`q-artifact:${REFS.q15LogisticModelCard.contentSha256}`]);
  assert.equal(report.metaAllocationAdvisory.state, 'NO_PROPOSAL');
  assert.equal(report.metaAllocationAdvisory.reviewClass, 'SELECTION_PRESSURE_UNAVAILABLE');
});

test('distinct Q refs cannot make the same canonical strategy count as independent evidence', () => {
  const base = baseTournament({
    snapshotOverrides: {
      basis: { qExperimentAndModelRefs: [REFS.q15ExperimentCard] },
      volume: {
        canonicalStrategyRef: REFS.basisTree.ref,
        canonicalStrategyHash: REFS.basisTree.gitObjectSha,
        canonicalStrategyContentSha256: REFS.basisTree.contentSha256,
        evidenceSnapshotRefs: [REFS.basisTree],
        qExperimentAndModelRefs: [REFS.qDisposition],
      },
    },
  });
  const report = evaluate(base.campaign);
  assert.equal(report.sourceDependenceWarnings.length, 1);
  assert.deepEqual(report.sourceDependenceWarnings[0].sharedDerivedSourceFamilyIds, [`strategy:${REFS.basisTree.contentSha256}`]);
  assert.deepEqual(report.sourceDependenceWarnings[0].sharedQEvidenceRefs, []);
  assert.equal(report.metaAllocationAdvisory.state, 'NO_PROPOSAL');
});

test('lifecycle advisories bind immutable target and evidence identities and never mutate', () => {
  const report = evaluate(baseTournament().campaign);
  for (const advisory of report.lifecycleAdvisories) {
    assert.match(advisory.targetStrategyHash, /^[a-f0-9]{40}$/);
    assert.match(advisory.targetSnapshotHash, /^[a-f0-9]{64}$/);
    assert.match(advisory.evidenceScorecardHash, /^[a-f0-9]{64}$/);
    assert.equal(advisory.ownerSeam, 'STRATEGY_AND_Q_OWNER_REVIEW_REQUIRED');
    assert.equal(advisory.authorityClass, 'NO_AUTHORITY');
    assert.equal(advisory.mutationPerformed, false);
    assert.equal(advisory.state, 'ABSTAIN_UNKNOWN');
    assert.equal(advisory.reviewClass, 'SELECTION_PRESSURE_UNAVAILABLE');
    assert.deepEqual(advisory.reasonCodes, ['CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING']);
  }
});

test('missing campaign-bound Q selection evidence suppresses deterministic breach proposals', () => {
  const report = evaluate(baseTournament({
    policyOverrides: {
      maximumFalsePositiveRatePpm: 0,
      maximumAmbiguityRatePpm: 0,
      maximumRecoveryBurdenMicros: '0',
      maximumCapacityConstraintRatePpm: 0,
      demotionRequiresBreaches: 2,
      retirementRequiresBreaches: 3,
    },
  }).campaign);
  assert.equal(report.lifecycleAdvisories.every((advisory) => advisory.state === 'ABSTAIN_UNKNOWN' && advisory.reviewClass === 'SELECTION_PRESSURE_UNAVAILABLE' && advisory.mutationPerformed === false), true);
  assert.equal(report.metaAllocationAdvisory.state, 'NO_PROPOSAL');
  assert.equal(report.ranking.selectionPressureAdjusted, false);
  assert.deepEqual(report.ranking.reasonCodes, ['CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING']);
});

test('Q15 adapter consumes the exact card instead of masquerading an F3 snapshot as ExperimentCard', () => {
  const bundle = JSON.parse(execFileSync('git', ['show', `${Q_SHA}:quant/generated/q15/registry_cards.v1.json`], { cwd: REPO, encoding: 'utf8' }));
  const preview = adaptExperimentCard(bundle.experimentCard);
  assert.equal(preview.canonicalContractVersion, 'Q15ExperimentCardV1@1');
  assert.equal(canonicalize(reverseFixture(preview)), canonicalize(bundle.experimentCard));
  const bad = { ...bundle.experimentCard, posture: 'LIVE' };
  assert.throws(() => adaptExperimentCard(bad), { code: 'ARENA_Q15_CARD_IDENTITY_MISMATCH' });
});

test('scenario and cockpit adapters are exact identity round trips with no mount or controls', () => {
  const tournament = baseTournament();
  const report = evaluate(tournament.campaign);
  const scenario = scenarioReference();
  const dockScenario = JSON.parse(readFileSync(resolve(REPO, 'frontier/dock/examples/scenario-reference.v1.json'), 'utf8'));
  assert.equal(canonicalize(scenario), canonicalize(dockScenario));
  assert.equal(scenario.scenarioHash, 'c6fda794de08e979b4e47cd3d8372e9d28c724ea31ef15fb0cf6982c962dcbb7');
  const scenarioPreview = adaptScenarioReference(scenario);
  assert.equal(canonicalize(reverseFixture(scenarioPreview)), canonicalize(scenario));
  const scenarioProof = validateScenarioReferences([scenario]);
  assert.equal(scenarioProof.executed, false);
  assert.equal(scenarioProof.canonicalTruthMutated, false);
  const alteredScenario = createScenarioReference({ ...withoutHash(dockScenario, 'scenarioHash'), seed: dockScenario.seed + 1 });
  assert.throws(() => adaptScenarioReference(alteredScenario), { code: 'ARENA_SCENARIO_IDENTITY_MISMATCH' });
  const surface = createProductSurfaceProjection(report, tournament.campaign, gitResolver);
  const surfacePreview = adaptProductSurfaceProjection(surface);
  assert.equal(canonicalize(reverseFixture(surfacePreview)), canonicalize(surface));
  assert.deepEqual(surface.controlIds, []);
  assert.equal(surface.bindingState, 'DIRECTOR_MOUNT_REQUIRED');
  assert.equal(Array.isArray(surface.evidence), true);
  assert.match(surface.summary, /selection pressure unavailable; final holdout not implemented/);
  assert.equal(surface.evidence.filter((datum) => datum.truthLabel === 'SYNTHETIC_ONLY').length, 4);
  assert.deepEqual(surface.evidence.filter((datum) => datum.truthLabel === 'MISSING').map((datum) => [datum.fieldId, datum.unavailableReason]), [
    ['selection-pressure-state', 'CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING'],
    ['final-holdout-state', 'NEW_Q_WHOLE_STRATEGY_GRANT_AND_REPLAY_BUNDLE_REQUIRED'],
  ]);
  const forgedSurface = clone(surface);
  forgedSurface.canonicalSource = 'attacker://unbound';
  assert.throws(() => adaptProductSurfaceProjection(forgedSurface), { code: 'ARENA_PRODUCT_SURFACE_AUTHORITY_WIDENING' });
  const rehashedShapeForgery = clone(surface);
  rehashedShapeForgery.summary = 'forged but shaped';
  assert.throws(() => adaptProductSurfaceProjection(rehashedShapeForgery), { code: 'ARENA_PRODUCT_SURFACE_IDENTITY_MISMATCH' });
});

test('product-surface validation binds a frozen campaign before resolver callbacks', () => {
  const mutableCampaign = clone(baseTournament().campaign);
  const report = evaluate(mutableCampaign);
  let mutated = false;
  const mutatingResolver = (reference) => {
    if (!mutated) {
      mutableCampaign.qValidationAuthority.holdoutAccessState = 'FORGED_AFTER_SNAPSHOT';
      mutated = true;
    }
    return gitResolver(reference);
  };
  const surface = createProductSurfaceProjection(report, mutableCampaign, mutatingResolver);
  assert.equal(mutated, true);
  assert.equal(surface.evidence.find((datum) => datum.fieldId === 'final-holdout-state').value, 'SEALED_REQUIRES_NEW_Q_GRANT_AND_REPLAY_BUNDLE');
  assert.doesNotThrow(() => adaptProductSurfaceProjection(surface));
});

test('cockpit projection binds report and campaign before its second resolver pass', () => {
  const campaign = clone(baseTournament().campaign);
  const mutableReport = clone(evaluate(campaign));
  const expectedReportHash = mutableReport.reportHash;
  const expectedCost = mutableReport.scorecards[0].costs.totalMicros;
  let calls = 0;
  const secondPassMutator = (reference) => {
    calls += 1;
    if (calls === 19) mutableReport.scorecards[0].costs.totalMicros = '999999';
    return gitResolver(reference);
  };
  const projection = projectArenaCockpit(mutableReport, campaign, secondPassMutator);
  assert.equal(calls > 19, true);
  assert.equal(mutableReport.scorecards[0].costs.totalMicros, '999999');
  assert.equal(projection.reportHash, expectedReportHash);
  assert.equal(projection.sections.find((section) => section.id === 'walk-forward-scorecards').rows[0].costs.totalMicros, expectedCost);
  assert.equal(projection.sections.find((section) => section.id === 'costs-non-action-recovery').rows[0].costs.totalMicros, expectedCost);
});

test('report comparison snapshots both reports before validating either one', () => {
  const leftCampaign = clone(baseTournament().campaign);
  const rightCampaign = clone(baseTournament().campaign);
  const mutableLeft = clone(evaluate(leftCampaign));
  const mutableRight = clone(evaluate(rightCampaign));
  const expectedReportHash = mutableLeft.reportHash;
  let calls = 0;
  const rightPassMutator = (reference) => {
    calls += 1;
    if (calls === 19) {
      mutableLeft.reportHash = '0'.repeat(64);
      mutableLeft.campaignHash = '1'.repeat(64);
    }
    return gitResolver(reference);
  };
  const comparison = compareTournamentReports(mutableLeft, mutableRight, { leftCampaign, rightCampaign, ownerResolver: rightPassMutator });
  assert.equal(calls > 19, true);
  assert.equal(comparison.sameCampaign, true);
  assert.equal(comparison.sameReport, true);
  assert.equal(comparison.leftReportHash, expectedReportHash);
  assert.equal(comparison.rightReportHash, expectedReportHash);
});

test('cockpit preview includes comparisons, evidence, costs, selection-pressure abstention, and limitations but no controls', () => {
  const tournament = baseTournament();
  const report = evaluate(tournament.campaign);
  const projection = projectArenaCockpit(report, tournament.campaign, gitResolver);
  const ids = projection.sections.map((section) => section.id);
  for (const required of ['same-event-comparison', 'opportunity-overlap-contention', 'selection-pressure', 'costs-non-action-recovery', 'evidence-drill-down', 'retirement-demotion-review', 'meta-allocation-review', 'limitations']) assert.equal(ids.includes(required), true);
  assert.equal(projection.mounted, false);
  assert.deepEqual(projection.controls, []);
  assert.equal(projection.truthClass, 'FIXTURE_PROJECTION');
  assert.equal(projection.promotionAuthorized, false);
  assert.equal(projection.sections.find((section) => section.id === 'selection-pressure').state, 'UNAVAILABLE');
  assert.equal(report.lifecycleAdvisories.every((advisory) => advisory.state !== 'PROPOSED_REVIEW'), true);
  assert.notEqual(report.metaAllocationAdvisory.state, 'PROPOSED_REVIEW');
  const evidence = projection.sections.find((section) => section.id === 'evidence-drill-down').value;
  assert.equal(evidence.strategies.every((entry) => entry.evidenceSnapshotRefs.length > 0 && entry.capitalRiskAssumptionRefs.length > 0 && entry.executionCostAndRecoveryRefs.length > 0), true);
  assert.equal(evidence.events.every((entry) => entry.eventContextHash && entry.outcomeFactHash), true);
  assert.equal(evidence.observations.every((entry) => entry.observationHash && entry.economicFactHash && entry.exposureFactHash && entry.ownerEvidenceRefs.length > 0), true);

  const tampered = clone(report);
  tampered.scorecards[0].falsePositiveCount += 1;
  assert.throws(() => validateStrategyArenaReport(tampered, tournament.campaign, gitResolver), { code: 'ARENA_RECORD_HASH_MISMATCH' });
  assert.throws(() => projectArenaCockpit(tampered, tournament.campaign, gitResolver), { code: 'ARENA_RECORD_HASH_MISMATCH' });
  const forged = clone(report);
  forged.ranking.automaticWinnerSelected = true;
  forged.ranking.canonicalLifecycleChanged = true;
  forged.sameEventComparison.oneSharedContextPerEvent = false;
  delete forged.reportHash;
  forged.reportHash = sha256(forged);
  assert.throws(() => validateStrategyArenaReport(forged, tournament.campaign, gitResolver), { code: 'ARENA_REPORT_DERIVATION_MISMATCH' });
  assert.throws(() => projectArenaCockpit(forged, tournament.campaign, gitResolver), { code: 'ARENA_REPORT_DERIVATION_MISMATCH' });
  const nullRanking = clone(report);
  nullRanking.ranking = null;
  delete nullRanking.reportHash;
  nullRanking.reportHash = sha256(nullRanking);
  assert.throws(() => validateStrategyArenaReport(nullRanking, tournament.campaign, gitResolver), { code: 'ARENA_RECORD_REQUIRED' });
  assert.throws(() => evaluateTournament(baseTournament().campaign), { code: 'ARENA_OWNER_RESOLVER_REQUIRED' });
  assert.throws(() => evaluateTournament(baseTournament().campaign, () => ({ gitObjectSha: '0'.repeat(40), contentSha256: '0'.repeat(64), projectionSha256: null })), { code: 'ARENA_Q_OWNER_PROJECTION_MISMATCH' });
});

test('report validation snapshots a hash-valid input before resolver callbacks', () => {
  const tournament = baseTournament();
  const expected = evaluate(tournament.campaign);
  const forged = clone(expected);
  forged.ranking.tiers = [...forged.ranking.tiers].reverse();
  delete forged.reportHash;
  forged.reportHash = sha256(forged);
  let mutated = false;
  const replacingResolver = (reference) => {
    if (!mutated) {
      for (const key of Object.keys(forged)) delete forged[key];
      Object.assign(forged, clone(expected));
      mutated = true;
    }
    return gitResolver(reference);
  };
  assert.throws(() => validateStrategyArenaReport(forged, tournament.campaign, replacingResolver), { code: 'ARENA_REPORT_DERIVATION_MISMATCH' });
  assert.equal(mutated, true);
});

test('all three released Dock facets validate and blocked, missing, or widened bindings fail closed', async () => {
  const ownerMap = JSON.parse(await readFile(resolve(REPO, 'frontier/dock/contracts/v1/canonical-owner-map.json'), 'utf8'));
  const moduleFacetMatrix = JSON.parse(await readFile(resolve(REPO, 'frontier/dock/contracts/v1/module-facet-matrix.json'), 'utf8'));
  const proof = validateArenaDockRelease({ ownerMap, moduleFacetMatrix, dockSha: DOCK_SHA });
  assert.deepEqual(proof.bindingHashes, [
    '1a28f00b6e2f9e042beb3923271caf2b0f376233fa7092e725ad07d15503a698',
    '35f74a00293a869adcb3cbb7dfa884d40cbd33afdf82b2ed4590cda048d28d19',
    '588e54eb6cafc8ca0114e3f11eac55801fc4b4957d1f6a32bfb797f9754ffa00',
  ]);
  const experimentBinding = ownerMap.facets.find((binding) => binding.facetClass === 'EXPERIMENT_PROVIDER');
  let bindingHashReads = 0;
  const unstableBinding = new Proxy(experimentBinding, {
    get(target, field, receiver) {
      if (field !== 'bindingHash') return Reflect.get(target, field, receiver);
      bindingHashReads += 1;
      return bindingHashReads <= 5 ? target.bindingHash : '0'.repeat(64);
    },
  });
  const snapshottedProof = validateArenaDockRelease({ ownerMap: { ...ownerMap, facets: ownerMap.facets.map((binding) => binding === experimentBinding ? unstableBinding : binding) }, moduleFacetMatrix, dockSha: DOCK_SHA });
  assert.deepEqual(snapshottedProof.bindingHashes, proof.bindingHashes);
  assert.equal(bindingHashReads, 1);
  const target = ownerMap.facets.find((binding) => binding.facetClass === 'SCENARIO_REFERENCE');
  const blocked = createProviderFacetBinding({ ...Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'bindingHash')), bindingStatus: 'BLOCKED', blockedReason: 'OWNER_UNAVAILABLE_FOR_TEST', insertionRequestRef: 'frontier/strategy-arena/INSERTION.md' });
  const blockedMap = { ...ownerMap, facets: ownerMap.facets.map((binding) => binding.facetClass === target.facetClass ? blocked : binding) };
  assert.throws(() => validateArenaDockRelease({ ownerMap: blockedMap, moduleFacetMatrix, dockSha: DOCK_SHA }), { code: 'ARENA_DOCK_ARTIFACT_HASH_MISMATCH' });
  assert.throws(() => validateArenaDockRelease({ ownerMap: { ...ownerMap, facets: ownerMap.facets.filter((binding) => binding.facetClass !== 'SCENARIO_REFERENCE') }, moduleFacetMatrix, dockSha: DOCK_SHA }), { code: 'ARENA_DOCK_ARTIFACT_HASH_MISMATCH' });
  assert.throws(() => createProviderFacetBinding({ ...Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'bindingHash')), authorityClass: 'PRODUCT_AUTHORITY' }), { code: 'FACET_AUTHORITY_FORBIDDEN' });
});

test('facet invocation is injected, fixture-only, and rejects cross-class, cross-operation, writes, mounts, promotion, and authority widening', async () => {
  const ownerMap = JSON.parse(await readFile(resolve(REPO, 'frontier/dock/contracts/v1/canonical-owner-map.json'), 'utf8'));
  const binding = ownerMap.facets.find((entry) => entry.facetClass === 'EXPERIMENT_PROVIDER');
  const request = { facetClass: binding.facetClass, operation: binding.operation, networkMode: 'FIXTURE_ONLY', authorityClass: 'NO_AUTHORITY', fixtureRef: REFS.q15ExperimentCard.ref };
  const output = invokeArenaFacet({ binding, request, handler: () => ({ truthClass: 'FIXTURE_PROJECTION', authorityClass: 'NO_AUTHORITY', canonical: false, networkMode: 'FIXTURE_ONLY', validated: true }) });
  assert.equal(output.validated, true);
  assert.throws(() => invokeArenaFacet({ binding: { ...binding, bindingHash: '0'.repeat(64) }, request, handler: () => output }), { code: 'ARENA_DOCK_BINDING_HASH_MISMATCH' });
  assert.throws(() => invokeArenaFacet({ binding, request: { ...request, operation: 'PROMOTE' }, handler: () => output }), { code: 'FACET_OPERATION_FORBIDDEN' });
  assert.throws(() => invokeArenaFacet({ binding, request: { ...request, facetClass: 'COCKPIT_PROJECTION' }, handler: () => output }), { code: 'FACET_CLASS_CROSSING' });
  assert.throws(() => invokeArenaFacet({ binding, request: { ...request, authorityClass: 'PRODUCT_AUTHORITY' }, handler: () => output }), { code: 'FACET_REQUEST_BOUNDARY_INVALID' });
  assert.throws(() => invokeArenaFacet({ binding, request, handler: () => ({ ...output, canonical: true }) }), { code: 'FIXTURE_OUTPUT_AUTHORITY_WIDENING' });
  const requestReads = { facetClass: 0, operation: 0, networkMode: 0, authorityClass: 0 };
  const unstableRequest = new Proxy(request, {
    get(target, field, receiver) {
      if (!Object.hasOwn(requestReads, field)) return Reflect.get(target, field, receiver);
      requestReads[field] += 1;
      const safeReads = ['facetClass', 'operation'].includes(field) ? 2 : 1;
      if (requestReads[field] <= safeReads) return Reflect.get(target, field, receiver);
      return { facetClass: 'COCKPIT_PROJECTION', operation: 'MOUNT', networkMode: 'LIVE', authorityClass: 'PRODUCT_AUTHORITY' }[field];
    },
  });
  let handlerRequest;
  invokeArenaFacet({ binding, request: unstableRequest, handler: (boundRequest) => { handlerRequest = boundRequest; return output; } });
  assert.deepEqual(handlerRequest, request);
  assert.deepEqual(requestReads, { facetClass: 1, operation: 1, networkMode: 1, authorityClass: 1 });
  const reads = { truthClass: 0, authorityClass: 0, canonical: 0, networkMode: 0 };
  const safeOutput = { truthClass: 'FIXTURE_PROJECTION', authorityClass: 'NO_AUTHORITY', canonical: false, networkMode: 'FIXTURE_ONLY' };
  const unstableOutput = new Proxy(safeOutput, {
    get(target, field, receiver) {
      if (!Object.hasOwn(reads, field)) return Reflect.get(target, field, receiver);
      reads[field] += 1;
      const safeReads = field === 'truthClass' ? 2 : 1;
      if (reads[field] <= safeReads) return Reflect.get(target, field, receiver);
      return { truthClass: 'LIVE', authorityClass: 'PRODUCT_AUTHORITY', canonical: true, networkMode: 'LIVE' }[field];
    },
  });
  assert.throws(() => invokeArenaFacet({ binding, request, handler: () => unstableOutput }), { code: 'FIXTURE_OUTPUT_CLASS_INVALID' });
  const report = evaluate(baseTournament().campaign);
  let routeTruthReads = 0;
  const shiftingRouteReport = new Proxy({ ...clone(report), truthClass: 'FIXTURE_PROJECTION' }, {
    get(target, field, receiver) {
      if (field !== 'truthClass') return Reflect.get(target, field, receiver);
      routeTruthReads += 1;
      return routeTruthReads <= 2 ? 'FIXTURE_PROJECTION' : 'ADVISORY';
    },
  });
  assert.throws(() => routeArenaAdvisory(shiftingRouteReport, 'READ_ONLY_PREVIEW'), { code: 'ADVISORY_CLASS_REQUIRED' });
  assert.equal(routeTruthReads, 1);
  for (const destination of ['PROMOTION', 'ALLOCATION', 'REGISTRY_WRITE', 'EXPOSURE_WRITE', 'OUTCOME_WRITE', 'CANARY', 'EARLY_STOP', 'ROLLBACK', 'SCENARIO_EXECUTION', 'COCKPIT_MOUNT', 'ORDER_EFFECT']) {
    assert.throws(() => routeArenaAdvisory(report, destination), { code: 'ADVISORY_EFFECT_FORBIDDEN' });
  }
});

test('runtime transport defaults closed and in-memory sandbox blocks escape without product writes', () => {
  const runtime = createFixtureRuntime();
  assert.deepEqual(runtime.transport, { networkMode: 'FIXTURE_ONLY', open: false });
  assert.equal(runtime.mutationEnabled, false);
  assert.throws(() => createFixtureRuntime({ networkMode: 'FIXTURE_ONLY', open: true }), { code: 'FIXTURE_TRANSPORT_REQUIRED' });
  const sandbox = new FixtureSandbox('fixture://strategy-arena/');
  sandbox.write('fixture://strategy-arena/report', { ok: true });
  assert.throws(() => sandbox.write('fixture://other/report', { ok: false }), { code: 'SANDBOX_ESCAPE_BLOCKED' });
});

test('resource proof processes real bounded fixture events and fails closed one event beyond the envelope', async () => {
  const resourceBudgetClaim = await json('fixtures/resource-budget-claim.v1.json');
  const maxSafeRateClaim = await json('fixtures/max-safe-rate-claim.v1.json');
  const events = Array.from({ length: 64 }, (_, index) => ({ eventId: `load-${String(index).padStart(3, '0')}`, fixture: true }));
  const atLimit = runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events });
  assert.equal(atLimit.state, 'WITHIN_FIXTURE_ENVELOPE');
  assert.equal(atLimit.processedEventCount, 64);
  assert.equal(atLimit.measured.peakQueueDepth, 1);
  assert.equal(atLimit.transportOpened, false);
  const beyond = runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events: [...events, { eventId: 'load-064', fixture: true }] });
  assert.equal(beyond.state, 'DEGRADATION_REQUESTED');
  assert.equal(beyond.exceeded.includes('EVENT_RATE'), true);
  assert.equal(beyond.acceptedEvents, 0);
  assert.equal(beyond.processedEventCount, 0);
  assert.equal(beyond.silentLoss, false);
  assert.equal(beyond.forgedGreen, false);
  const queueOverflow = runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events: events.slice(0, 2), queueBurst: 2 });
  assert.equal(queueOverflow.state, 'DEGRADATION_REQUESTED');
  assert.equal(queueOverflow.exceeded.includes('QUEUE'), true);
  assert.equal(queueOverflow.processedEventCount, 0);
  assert.throws(() => runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events: [events[0], events[0]] }), { code: 'ARENA_LOAD_EVENT_DUPLICATE' });
  assert.throws(() => runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events: [{ eventId: 'bad', fixture: false }] }), { code: 'ARENA_LOAD_EVENT_INVALID' });
  let fixtureReads = 0;
  const unstableEvent = new Proxy({ eventId: 'load-proxy', fixture: true }, {
    get(target, field, receiver) {
      if (field !== 'fixture') return Reflect.get(target, field, receiver);
      fixtureReads += 1;
      return fixtureReads === 1;
    },
  });
  const snapshottedLoad = runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events: [unstableEvent] });
  const stableLoad = runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events: [{ eventId: 'load-proxy', fixture: true }] });
  assert.equal(snapshottedLoad.fixtureProcessedDigest, stableLoad.fixtureProcessedDigest);
  assert.equal(fixtureReads, 1);
});

test('serialized descriptor, adapter maps, resource claims, insertion request, campaign, and previews pass reference validators', async () => {
  const descriptor = await json('contracts/v1/extension-descriptor.v1.json');
  const resource = await json('fixtures/resource-budget-claim.v1.json');
  const rate = await json('fixtures/max-safe-rate-claim.v1.json');
  const insertion = await json('fixtures/insertion-request.v1.json');
  const serializedQAuthority = await json('fixtures/q-validation-authority.v1.json');
  validateResourceBudgetClaim(resource);
  validateMaxSafeRateClaim(rate);
  validateResourceRateCompatibility(resource, rate);
  validateExtensionDescriptor(descriptor);
  assert.equal(canonicalize(descriptor.resourceBudgetClaim), canonicalize(resource));
  assert.equal(canonicalize(descriptor.maxSafeRateClaim), canonicalize(rate));
  validateQValidationAuthorityAgainstOwner(serializedQAuthority, gitResolver);
  const maps = createArenaAdapterMaps();
  for (const [name, path] of Object.entries({ experimentProvider: 'contracts/v1/experiment-provider-adapter-map.v1.json', scenarioReference: 'contracts/v1/scenario-reference-adapter-map.v1.json', cockpitProjection: 'contracts/v1/cockpit-projection-adapter-map.v1.json' })) {
    const serialized = await json(path);
    validateCanonicalAdapterMap(serialized);
    assert.equal(canonicalize(serialized), canonicalize(maps[name]));
  }
  const seams = [
    'frontier/scenario-bank:F12-ScenarioReferenceV1-provider-read',
    'git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exchangeTwin:read-only-L-scenario-recovery-effect-assumption-projection',
    'quant/generated/q14:validation-safe-folds-dataset-status-and-holdout-policy-leaf-projection',
    'quant/src/quant_edge/registry_ops:Q-owner-issued-campaign-bound-whole-strategy-selection-pressure-bundle-with-trial-ledger-and-multiplicity-evidence',
    'quant/src/quant_edge/registry_ops:read-only-experiment-card-and-owner-reviewed-StrategyArena-advisory-intake',
    'quant/src/quant_edge/validation:Q-owner-issued-whole-strategy-final-holdout-grant-and-immutable-replay-bundle-with-global-one-use',
    'server/src/capitalFoundation/allocation:read-only-capacity-assumption-projection-and-owner-reviewed-meta-allocation-advisory-intake',
    'server/src/capitalFoundation/economics:read-only-cost-assumption-projection',
    'server/src/engine/basis:read-only-frozen-strategy-package-export-and-owner-reviewed-lifecycle-advisory-intake',
    'server/src/engine/volume:read-only-frozen-strategy-package-export-and-owner-reviewed-lifecycle-advisory-intake',
    'server/src/foundation/execution:read-only-recovery-assumption-projection',
    'server/src/foundation/risk:read-only-risk-assumption-projection-and-owner-reviewed-meta-allocation-advisory-intake',
    'server/src/intelligenceFoundation/outcomes:read-only-outcome-contract-projection',
    'server/src/systemIntegration/supervisor:read-only-StrategyArena-cockpit-projection',
  ];
  validateInsertionRequest(insertion, seams);
  const campaign = await json('fixtures/tournament-campaign.v1.json');
  validateEvaluationCampaign(campaign);
  assert.equal(canonicalize(campaign.qValidationAuthority), canonicalize(serializedQAuthority));
  const report = evaluate(campaign);
  assert.equal(canonicalize(report), canonicalize(await json('preview/tournament-scorecard.v1.json')));
  assert.equal(canonicalize(createProductSurfaceProjection(report, campaign, gitResolver)), canonicalize(await json('preview/product-surface-projection.v1.json')));
});

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

test('JSON schema is draft 2020-12 and contract hash manifest covers every serialized artifact exactly', async () => {
  const schema = await json('contracts/v1/strategy-arena-v1.schema.json');
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'https://f-arena.invalid/frontier/strategy-arena/contracts/v1/strategy-arena-v1.schema.json');
  assert.equal(canonicalize(schema), canonicalize(strategyArenaSchema()));
  for (const required of ['StrategyEvaluationSnapshotV1', 'StrategyArenaEventContextV1', 'StrategyObservationV1', 'StrategyArenaCampaignV1', 'StrategyArenaReportV1']) assert.ok(schema.$defs[required]);
  for (const closedDefinition of ['SyntheticOutcomeProjectionV1', 'SyntheticEconomicProjectionV1', 'ShadowExposureProjectionV1', 'QValidationAuthorityProjectionV1', 'StrategyArenaPolicyV1', 'ScenarioReferenceV1', 'StrategyArenaScorecardV1', 'RankingV1', 'StrategyArenaReportV1']) assert.equal(schema.$defs[closedDefinition].additionalProperties, false, closedDefinition);
  const campaign = await json('fixtures/tournament-campaign.v1.json');
  const report = await json('preview/tournament-scorecard.v1.json');
  validateSchemaSubset(schema, schema.$defs.StrategyArenaCampaignV1, campaign);
  validateSchemaSubset(schema, schema.$defs.StrategyArenaReportV1, report);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.GitRef, `git:${BASE_SHA}:../server/x`), /pattern mismatch/);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.Micros, '1000000000001'), /pattern mismatch/);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaCampaignV1, { ...campaign, qHoldoutGrant: {} }), /unexpected field qHoldoutGrant/);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaReportV1, { ...report, promotionAuthorized: true }), /const mismatch/);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.ScenarioReferenceV1, { ...campaign.scenarioReferences[0], seed: 716 }), /const mismatch/);
  const unsafeQAuthority = clone(campaign.qValidationAuthority);
  unsafeQAuthority.validationFoldsRef.ref = `${unsafeQAuthority.sourceArtifactRef.ref}#/plan`;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.QValidationAuthorityProjectionV1, unsafeQAuthority), /const mismatch/);
  const incoherentUnknownOutcome = clone(campaign.eventContexts[0].outcome);
  incoherentUnknownOutcome.state = 'UNKNOWN';
  incoherentUnknownOutcome.outcomeClass = 'UNKNOWN';
  incoherentUnknownOutcome.ambiguityState = 'UNKNOWN';
  incoherentUnknownOutcome.reasonCodes = [];
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.SyntheticOutcomeProjectionV1, incoherentUnknownOutcome), /array below minItems/);
  const incoherentUnknownEconomics = clone(campaign.observations.find((row) => row.economics.state === 'AVAILABLE').economics);
  incoherentUnknownEconomics.state = 'UNKNOWN';
  incoherentUnknownEconomics.reasonCodes = [];
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.SyntheticEconomicProjectionV1, incoherentUnknownEconomics), /enum mismatch|array below minItems/);
  const falselyIncompleteEconomics = clone(campaign.observations.find((row) => row.economics.state === 'AVAILABLE').economics);
  falselyIncompleteEconomics.state = 'UNKNOWN';
  falselyIncompleteEconomics.accountingStatus = 'INCOMPLETE';
  falselyIncompleteEconomics.reasonCodes = ['OWNER_EVIDENCE_INCOMPLETE'];
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.SyntheticEconomicProjectionV1, falselyIncompleteEconomics), /anyOf matched 0 branches/);
  const declaredDivergence = clone(falselyIncompleteEconomics);
  declaredDivergence.accountingStatus = 'DIVERGENT';
  assert.doesNotThrow(() => validateSchemaSubset(schema, schema.$defs.SyntheticEconomicProjectionV1, declaredDivergence));
  const incoherentUnknownExposure = clone(campaign.observations.find((row) => row.shadowExposure.state === 'SHADOW_EXPOSED').shadowExposure);
  incoherentUnknownExposure.state = 'UNKNOWN';
  incoherentUnknownExposure.reasonCodes = [];
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.ShadowExposureProjectionV1, incoherentUnknownExposure), /expected null|const mismatch|array below minItems/);
  const impossibleExposed = clone(incoherentUnknownExposure);
  impossibleExposed.state = 'SHADOW_EXPOSED';
  impossibleExposed.openedAtMs = null;
  impossibleExposed.closedAtMs = null;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.ShadowExposureProjectionV1, impossibleExposed), /expected integer/);
  const acted = clone(campaign.observations.find((row) => row.decisionDisposition === 'ACTED'));
  const rejected = clone(campaign.observations.find((row) => row.decisionDisposition === 'REJECTED'));
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyObservationV1, { ...acted, economics: rejected.economics }), /const mismatch/);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyObservationV1, { ...acted, shadowExposure: rejected.shadowExposure }), /const mismatch/);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyObservationV1, { ...rejected, economics: acted.economics, shadowExposure: acted.shadowExposure }), /const mismatch/);
  const dataInvalid = clone(observation(baseTournament().basis, baseTournament().contexts[0], { disposition: 'DATA_INVALID' }));
  dataInvalid.servingPosture = 'ADVISORY';
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyObservationV1, dataInvalid), /const mismatch/);
  const unavailable = clone(economics('E-schema', 'snapshot.schema.v1', { state: 'UNKNOWN', overrides: { grossOutcomeMicros: null, costMicros: null, fixtureNetOutcomeMicros: null, accountingStatus: 'UNAVAILABLE', reasonCodes: ['UNAVAILABLE'] } }));
  unavailable.grossOutcomeMicros = '1';
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.SyntheticEconomicProjectionV1, unavailable), /expected null/);
  const longCutoff = clone(campaign.qValidationAuthority.folds[0]);
  longCutoff.validationEndCutoffNs = '9'.repeat(3_000);
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.QFoldProjectionV1, longCutoff), /above maxLength/);
  const comparableWithNullMetrics = { ...clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE')), metricValues: null };
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, comparableWithNullMetrics), /expected object/);
  const comparableWithMissingCost = clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE'));
  comparableWithMissingCost.costs.feesMicros = null;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, comparableWithMissingCost), /expected string/);
  for (const field of ['falsePositiveRatePpm', 'costSurvivalRatePpm']) {
    const missingRate = clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE'));
    missingRate[field] = null;
    assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, missingRate), /expected integer/);
  }
  const comparableWithoutActed = clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE'));
  comparableWithoutActed.decisions.ACTED = 0;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, comparableWithoutActed), /number below minimum/);
  const comparableWithoutNonActionQuality = clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE'));
  comparableWithoutNonActionQuality.nonActionQuality.qualityPpm = null;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, comparableWithoutNonActionQuality), /expected integer/);
  const comparableWithMissingPortfolio = clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE'));
  comparableWithMissingPortfolio.shadowPortfolio.fixtureNetOutcomeMicros = null;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, comparableWithMissingPortfolio), /expected string/);
  const comparableWithMissingStability = clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE'));
  comparableWithMissingStability.stability.worstSlice = null;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, comparableWithMissingStability), /expected object/);
  const abstainWithComparableProjections = clone(report.scorecards.find((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE'));
  abstainWithComparableProjections.comparability = 'ABSTAIN_UNKNOWN';
  abstainWithComparableProjections.unknownReasons = ['OWNER_EVIDENCE_UNKNOWN'];
  abstainWithComparableProjections.metricValues = null;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyArenaScorecardV1, abstainWithComparableProjections), /expected null/);
  const badLifecycle = { ...clone(report.lifecycleAdvisories[0]), state: 'PROPOSED_REVIEW', reviewClass: 'CONTINUE_RESEARCH' };
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyLifecycleAdvisoryV1, badLifecycle), /const mismatch/);
  const lifecycleWithoutSelectionBlocker = { ...clone(report.lifecycleAdvisories[0]), reasonCodes: ['OWNER_EVIDENCE_UNKNOWN'] };
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyLifecycleAdvisoryV1, lifecycleWithoutSelectionBlocker), /array below minContains/);
  const badMeta = { ...clone(report.metaAllocationAdvisory), state: 'PROPOSED_REVIEW', reviewClass: 'INSUFFICIENT_DIVERSE_CANDIDATES' };
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyMetaAllocationAdvisoryV1, badMeta), /enum mismatch/);
  const emptyNoProposal = { ...clone(report.metaAllocationAdvisory), candidateStrategies: [] };
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyMetaAllocationAdvisoryV1, emptyNoProposal), /array below minItems/);
  const duplicateMetaCandidate = clone(report.metaAllocationAdvisory);
  duplicateMetaCandidate.candidateStrategies.push(clone(duplicateMetaCandidate.candidateStrategies[0]));
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyMetaAllocationAdvisoryV1, duplicateMetaCandidate), /array items not unique/);
  const candidateWhileAbstaining = { ...clone(report.metaAllocationAdvisory), state: 'ABSTAIN_UNKNOWN', reviewClass: 'INSUFFICIENT_COMPARABLE_EVIDENCE' };
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.StrategyMetaAllocationAdvisoryV1, candidateWhileAbstaining), /array above maxItems/);
  const actedComparison = clone(report.sameEventComparison.comparisons[0].strategies.find((row) => row.decisionDisposition === 'ACTED'));
  actedComparison.fixtureNetOutcomeMicros = null;
  assert.throws(() => validateSchemaSubset(schema, schema.$defs.SameEventStrategyV1, actedComparison), /expected string/);

  const reasonBase = baseTournament();
  const widenedBasis = createStrategySnapshot({ ...withoutHash(reasonBase.basis, 'snapshotHash'), knownMissingInputs: Array.from({ length: 128 }, (_, index) => `missing-${String(index).padStart(3, '0')}`) });
  const widenedRows = reasonBase.campaign.observations.map((row) => {
    if (row.strategySnapshotHash !== reasonBase.basis.snapshotHash) return row;
    const context = reasonBase.contexts.find((entry) => entry.eventContextHash === row.eventContextHash);
    if (context.eventId === 'E1') return observation(widenedBasis, context, { disposition: 'DATA_INVALID' });
    return createStrategyObservation({ ...withoutHash(row, 'observationHash'), strategySnapshotHash: widenedBasis.snapshotHash });
  });
  const reasonCampaign = rebuildCampaign(reasonBase.campaign, { strategySnapshots: reasonBase.campaign.strategySnapshots.map((entry) => entry.snapshotId === reasonBase.basis.snapshotId ? widenedBasis : entry), observations: widenedRows });
  const reasonReport = evaluate(reasonCampaign);
  const reasonCard = reasonReport.scorecards.find((card) => card.snapshotId === widenedBasis.snapshotId);
  assert.equal(reasonCard.unknownReasons.length > 128, true);
  validateSchemaSubset(schema, schema.$defs.StrategyArenaReportV1, reasonReport);
  const artifactPaths = (await Promise.all(['contracts', 'fixtures', 'preview'].map((folder) => walk(resolve(ROOT, folder))))).flat().filter((path) => extname(path) === '.json').map((path) => relative(ROOT, path)).sort();
  const manifestLines = (await readFile(resolve(ROOT, 'contracts/CONTRACT_HASHES.sha256'), 'utf8')).trim().split('\n');
  assert.deepEqual(manifestLines.map((line) => line.slice(66)).sort(), artifactPaths);
  for (const line of manifestLines) {
    const [expected, path] = [line.slice(0, 64), line.slice(66)];
    assert.equal(rawSha256(await readFile(resolve(ROOT, path))), expected, path);
  }
});

test('source import graph, ambient effects, secret scan, and module bounds prove fixture isolation only', async () => {
  const sourceFiles = (await walk(resolve(ROOT, 'src'))).filter((path) => extname(path) === '.mjs');
  for (const path of sourceFiles) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /\b(?:Date\.now|new Date|Math\.random|setTimeout|setInterval|process\.env|fetch\s*\(|WebSocket|child_process|node:fs|node:http|node:https|node:net|node:dgram)\b/, relative(ROOT, path));
    assert.doesNotMatch(source, /import\s*\(/, relative(ROOT, path));
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.equal(specifier.startsWith('./') || specifier.startsWith('../../dock/src/'), true, `${relative(ROOT, path)} imports ${specifier}`);
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(path), specifier);
        assert.equal(target.startsWith(resolve(ROOT, 'src')) || target.startsWith(resolve(REPO, 'frontier/dock/src')), true, `resolved import escapes safe roots: ${target}`);
      }
    }
  }
  const allModuleFiles = await walk(ROOT);
  for (const path of allModuleFiles.filter((entry) => !entry.includes('/tests/'))) {
    const text = await readFile(path, 'utf8');
    assert.doesNotMatch(text, /(?:api[_-]?key|secret|private[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i, relative(ROOT, path));
  }
  assert.equal((await json('fixtures/tournament-campaign.v1.json')).strategySnapshots.length <= 8, true);
  assert.equal((await json('fixtures/tournament-campaign.v1.json')).observations.length <= 64, true);
});

test('hermetic import, intentional fixture crash, and process removal leave the repository unchanged', () => {
  const status = () => execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8' });
  const before = status();
  const moduleUrl = new URL('../src/index.mjs', import.meta.url).href;
  const importOnly = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('NETWORK_SENTINEL'); };
    globalThis.WebSocket = class { constructor() { throw new Error('TRANSPORT_SENTINEL'); } };
    const arena = await import(${JSON.stringify(moduleUrl)});
    const runtime = arena.createFixtureRuntime();
    if (runtime.transport.open !== false || runtime.mutationEnabled !== false) throw new Error('RUNTIME_BOUNDARY_DRIFT');
    process.stdout.write('FIXTURE_IMPORT_REMOVABLE');
  `], { cwd: REPO, encoding: 'utf8', timeout: 5_000 });
  assert.equal(importOnly.status, 0, importOnly.stderr);
  assert.equal(importOnly.stdout, 'FIXTURE_IMPORT_REMOVABLE');

  const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('NETWORK_SENTINEL'); };
    const arena = await import(${JSON.stringify(moduleUrl)});
    arena.createFixtureRuntime();
    process.stdout.write('FIXTURE_CRASH_REACHED');
    throw new Error('INTENTIONAL_FIXTURE_CRASH');
  `], { cwd: REPO, encoding: 'utf8', timeout: 5_000 });
  assert.notEqual(crashed.status, 0);
  assert.equal(crashed.stdout, 'FIXTURE_CRASH_REACHED');
  assert.match(crashed.stderr, /INTENTIONAL_FIXTURE_CRASH/);
  assert.equal(status(), before);
});
