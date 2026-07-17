import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { basename, isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { canonicalJson } from '../../intelligenceFoundation/contracts/ids.js';
import { isBoundedIdentifier, isGitCommitSha, isLowercaseSha256, isPlainRecord } from './contracts.js';

const PATCH_TASK_KEYS = Object.freeze([
  'schema', 'taskId', 'jobId', 'caseId', 'class', 'baseSha', 'sourceWorktreePath', 'isolatedWorktreePath', 'isolatedWorktreeParent',
  'allowedWriteRoots', 'registeredTestIds', 'maximumDurationMs', 'maximumOutputBytes', 'networkAccess',
]);

const PATCH_CONTEXT_KEYS = Object.freeze([
  'expectedBaseSha', 'expectedSourceWorktreePath', 'verifiedSourceWorktreeRealpath', 'verifiedSourceGitCommonDirRealpath',
  'verifiedIsolatedWorktreeParentRealpath', 'sourceIsolation', 'canonicalPathEvidenceDigest',
  'canonicalPathEvidenceSignatureVerified', 'protectedWorktreePaths', 'registeredTests', 'registeredTestRegistryDigest',
  'registeredTestRegistrySignatureVerified',
]);

const PATCH_CANONICAL_PATH_EVIDENCE_KEYS = Object.freeze([
  'schema', 'expectedSourceWorktreePath', 'verifiedSourceWorktreeRealpath', 'verifiedSourceGitCommonDirRealpath',
  'verifiedIsolatedWorktreeParentRealpath', 'sourceIsolation', 'protectedWorktreePaths',
]);

const MAX_CANONICAL_ABSOLUTE_PATH_LENGTH = 4096;
const MAX_REGISTERED_TEST_ARGUMENT_UTF8_BYTES = 1024;
const MAX_REGISTERED_TEST_ARGV_UTF8_BYTES = 8192;
const REQUIRED_PROTECTED_WORKTREE_BASENAMES = Object.freeze(['Main', 'current-main', 'i00-assembly']);

export const A3_EXCLUSIVE_PATCH_ROOTS = Object.freeze([
  'server/src/aiOps/adapters',
  'fixtures/aiOps/a3',
  'server/test/aiOps/a3',
]);

export interface IsolatedPatchTask {
  readonly schema: 'AI_OPS_ISOLATED_PATCH_TASK_V1';
  readonly taskId: string;
  readonly jobId: string;
  readonly caseId: string;
  readonly class: 'CLASS_C_ISOLATED_PATCH_ONLY';
  readonly baseSha: string;
  readonly sourceWorktreePath: string;
  readonly isolatedWorktreePath: string;
  readonly isolatedWorktreeParent: string;
  readonly allowedWriteRoots: readonly string[];
  readonly registeredTestIds: readonly string[];
  readonly maximumDurationMs: number;
  readonly maximumOutputBytes: number;
  readonly networkAccess: 'DENIED';
}

export interface RegisteredTestCommand {
  readonly testId: string;
  readonly argv: readonly string[];
}

export interface PatchWorkerContext {
  readonly expectedBaseSha: string;
  readonly expectedSourceWorktreePath: string;
  readonly verifiedSourceWorktreeRealpath: string;
  readonly verifiedSourceGitCommonDirRealpath: string;
  readonly verifiedIsolatedWorktreeParentRealpath: string;
  readonly sourceIsolation: 'DEDICATED_DISPOSABLE_CLONE';
  readonly canonicalPathEvidenceDigest: string;
  readonly canonicalPathEvidenceSignatureVerified: boolean;
  readonly protectedWorktreePaths: readonly string[];
  readonly registeredTests: readonly Readonly<RegisteredTestCommand>[];
  readonly registeredTestRegistryDigest: string;
  readonly registeredTestRegistrySignatureVerified: boolean;
}

export interface PatchCanonicalPathEvidence {
  readonly schema: 'AI_OPS_PATCH_CANONICAL_PATH_EVIDENCE_V1';
  readonly expectedSourceWorktreePath: string;
  readonly verifiedSourceWorktreeRealpath: string;
  readonly verifiedSourceGitCommonDirRealpath: string;
  readonly verifiedIsolatedWorktreeParentRealpath: string;
  readonly sourceIsolation: 'DEDICATED_DISPOSABLE_CLONE';
  readonly protectedWorktreePaths: readonly string[];
}

export interface IsolatedPatchPlan {
  readonly schema: 'AI_OPS_ISOLATED_PATCH_PLAN_V1';
  readonly planned: boolean;
  readonly authorityGranted: false;
  readonly runnerState: 'NOT_CONFIGURED';
  readonly worktreeCreateArgv: readonly string[] | null;
  readonly sourceWorktreePath: string | null;
  readonly testArgv: readonly (readonly string[])[];
  readonly allowedWriteRoots: readonly string[];
  readonly mainWriteAccess: 'DENIED';
  readonly mergeAccess: 'DENIED';
  readonly pushAccess: 'DENIED';
  readonly deploymentAccess: 'DENIED';
  readonly moneyPathAccess: 'DENIED';
  readonly networkAccess: 'DENIED';
  readonly networkContainment: 'REQUIRES_EXTERNAL_SANDBOX_PORT';
  readonly filesystemContainment: 'REQUIRES_EXTERNAL_SANDBOX_PORT';
  readonly reasonCodes: readonly string[];
}

function containedBy(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation !== '' && !relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation);
}

function isBoundedCanonicalAbsolutePath(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_CANONICAL_ABSOLUTE_PATH_LENGTH
    || value.includes('\u0000')
  ) return false;
  try {
    return isAbsolute(value) && resolve(value) === value;
  } catch {
    return false;
  }
}

function isSafeRelativeRoot(value: string): boolean {
  return !isAbsolute(value)
    && value === normalize(value)
    && value.length > 0
    && value !== '.'
    && !value.startsWith(`..${sep}`)
    && !value.includes('\u0000');
}

function overlapsProtectedPath(candidate: string, protectedPath: string): boolean {
  const normalizedCandidate = resolve(candidate);
  const normalizedProtected = resolve(protectedPath);
  return normalizedCandidate === normalizedProtected
    || containedBy(normalizedProtected, normalizedCandidate)
    || containedBy(normalizedCandidate, normalizedProtected);
}

function snapshotDataRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length > 64) return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotStringArray(value: unknown, maximum: number): readonly string[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const preliminaryLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (preliminaryLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(preliminaryLengthDescriptor, 'value')) return null;
    const length = preliminaryLengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const finalLengthDescriptor = descriptors['length'];
    if (finalLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(finalLengthDescriptor, 'value')
      || finalLengthDescriptor.value !== length || Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')
      || Object.keys(descriptors).length !== length + 1) return null;
    const snapshot: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotArray(value: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const preliminaryLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (preliminaryLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(preliminaryLengthDescriptor, 'value')) return null;
    const length = preliminaryLengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const finalLengthDescriptor = descriptors['length'];
    if (finalLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(finalLengthDescriptor, 'value')
      || finalLengthDescriptor.value !== length || Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')
      || Object.keys(descriptors).length !== length + 1) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function patchCanonicalPathEvidenceDigest(evidence: Readonly<PatchCanonicalPathEvidence>): string {
  const evidenceSnapshot = snapshotDataRecord(evidence);
  if (
    evidenceSnapshot === null
    || Object.keys(evidenceSnapshot).sort().join('\u0000') !== [...PATCH_CANONICAL_PATH_EVIDENCE_KEYS].sort().join('\u0000')
    || evidenceSnapshot.schema !== 'AI_OPS_PATCH_CANONICAL_PATH_EVIDENCE_V1'
    || evidenceSnapshot.sourceIsolation !== 'DEDICATED_DISPOSABLE_CLONE'
    || !isBoundedCanonicalAbsolutePath(evidenceSnapshot.expectedSourceWorktreePath)
    || !isBoundedCanonicalAbsolutePath(evidenceSnapshot.verifiedSourceWorktreeRealpath)
    || !isBoundedCanonicalAbsolutePath(evidenceSnapshot.verifiedSourceGitCommonDirRealpath)
    || !isBoundedCanonicalAbsolutePath(evidenceSnapshot.verifiedIsolatedWorktreeParentRealpath)
  ) throw new TypeError('canonical patch path evidence is invalid');
  const protectedWorktreePaths = snapshotStringArray(evidenceSnapshot.protectedWorktreePaths, REQUIRED_PROTECTED_WORKTREE_BASENAMES.length);
  if (protectedWorktreePaths === null || !protectedWorktreePaths.every(isBoundedCanonicalAbsolutePath)) {
    throw new TypeError('canonical patch protected-worktree evidence is invalid');
  }
  return createHash('sha256').update(canonicalJson({
    schema: evidenceSnapshot.schema,
    expectedSourceWorktreePath: evidenceSnapshot.expectedSourceWorktreePath,
    verifiedSourceWorktreeRealpath: evidenceSnapshot.verifiedSourceWorktreeRealpath,
    verifiedSourceGitCommonDirRealpath: evidenceSnapshot.verifiedSourceGitCommonDirRealpath,
    verifiedIsolatedWorktreeParentRealpath: evidenceSnapshot.verifiedIsolatedWorktreeParentRealpath,
    sourceIsolation: evidenceSnapshot.sourceIsolation,
    protectedWorktreePaths: [...protectedWorktreePaths].sort(),
  })).digest('hex');
}

function hasForbiddenWorktreeComponent(candidate: string): boolean {
  const forbidden = new Set(['main', 'current-main', 'i00-assembly']);
  return resolve(candidate).toLowerCase().split(sep).some((segment) => forbidden.has(segment));
}

export function registeredTestRegistryDigest(rows: readonly Readonly<RegisteredTestCommand>[]): string {
  const rowSnapshots = snapshotArray(rows, 32);
  if (rowSnapshots === null) throw new TypeError('registered test registry exceeds bound');
  const normalizedRows: RegisteredTestCommand[] = [];
  for (const rawRow of rowSnapshots) {
    const row = snapshotDataRecord(rawRow);
    const argv = row === null ? null : snapshotStringArray(row.argv, 32);
    if (
      row === null
      || Object.keys(row).sort().join('\u0000') !== ['argv', 'testId'].join('\u0000')
      || !isBoundedIdentifier(row.testId)
      || argv === null
      || !hasBoundedRegisteredTestArgv(argv)
    ) throw new TypeError('registered test registry row is invalid or exceeds argv bounds');
    normalizedRows.push(Object.freeze({ testId: row.testId, argv: Object.freeze([...argv]) }));
  }
  return createHash('sha256').update(canonicalJson(normalizedRows)).digest('hex');
}

function hasBoundedRegisteredTestArgv(argv: readonly string[]): boolean {
  let totalUtf8Bytes = 0;
  for (const argument of argv) {
    if (argument.length === 0 || argument.length > MAX_REGISTERED_TEST_ARGUMENT_UTF8_BYTES) return false;
    const argumentUtf8Bytes = Buffer.byteLength(argument, 'utf8');
    if (argumentUtf8Bytes > MAX_REGISTERED_TEST_ARGUMENT_UTF8_BYTES) return false;
    totalUtf8Bytes += argumentUtf8Bytes;
    if (totalUtf8Bytes > MAX_REGISTERED_TEST_ARGV_UTF8_BYTES) return false;
  }
  return true;
}

function safeRegisteredTestArgv(argv: readonly string[]): boolean {
  if (
    !Array.isArray(argv)
    || argv.length < 2
    || !hasBoundedRegisteredTestArgv(argv)
    || argv.some((argument) => typeof argument !== 'string' || argument.includes('\u0000'))
  ) return false;
  if (argv.some((argument) => /(?:https?:\/\/|git@|\b(?:curl|wget|ssh|scp|rsync|deploy|push|publish|release)\b)/iu.test(argument))) return false;
  if (argv[0] === 'npm') {
    if (argv[1] === 'test') return argv.length === 2;
    return argv.length === 3
      && argv[1] === 'run'
      && /^(?:test|typecheck|build)(?::[A-Za-z0-9._-]+)*$/u.test(argv[2]);
  }
  if (argv[0] !== 'node') return false;
  let testPathCount = 0;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--test' || argument === '--test-concurrency=1' || /^(?:--test-reporter=)(?:spec|dot|tap)$/u.test(argument)) continue;
    if (argument === '--import') {
      if (argv[++index] !== './server/test/private-egress-tripwire.mjs') return false;
      continue;
    }
    if (argument.startsWith('-') || isAbsolute(argument) || normalize(argument) !== argument || argument.startsWith('..')) return false;
    if (!/^(?:server\/test|test\/)[A-Za-z0-9_./*-]+\.mjs$/u.test(argument)) return false;
    const normalized = normalize(argument);
    if (!(normalized.startsWith('server/test/') || normalized.startsWith('test/'))) return false;
    testPathCount += 1;
  }
  return testPathCount > 0;
}

export function planIsolatedPatchWorker(
  task: Readonly<IsolatedPatchTask>,
  context: Readonly<PatchWorkerContext>,
): Readonly<IsolatedPatchPlan> {
  const taskSnapshot = snapshotDataRecord(task);
  const contextSnapshot = snapshotDataRecord(context);
  if (taskSnapshot === null || contextSnapshot === null) {
    return Object.freeze({
      schema: 'AI_OPS_ISOLATED_PATCH_PLAN_V1',
      planned: false,
      authorityGranted: false,
      runnerState: 'NOT_CONFIGURED',
      worktreeCreateArgv: null,
      sourceWorktreePath: null,
      testArgv: Object.freeze([]),
      allowedWriteRoots: Object.freeze([]),
      mainWriteAccess: 'DENIED',
      mergeAccess: 'DENIED',
      pushAccess: 'DENIED',
      deploymentAccess: 'DENIED',
      moneyPathAccess: 'DENIED',
      networkAccess: 'DENIED',
      networkContainment: 'REQUIRES_EXTERNAL_SANDBOX_PORT',
      filesystemContainment: 'REQUIRES_EXTERNAL_SANDBOX_PORT',
      reasonCodes: Object.freeze(['PATCH_TASK_OR_CONTEXT_NOT_PLAIN_OBJECT']),
    });
  }
  task = taskSnapshot as unknown as Readonly<IsolatedPatchTask>;
  context = contextSnapshot as unknown as Readonly<PatchWorkerContext>;
  const reasons: string[] = [];
  let validatedSource: string | null = null;
  let validatedTarget: string | null = null;
  if (task.schema !== 'AI_OPS_ISOLATED_PATCH_TASK_V1') reasons.push('PATCH_TASK_SCHEMA_UNSUPPORTED');
  if (
    Object.getOwnPropertySymbols(task).length > 0
    || Object.keys(task).sort().join('\u0000') !== [...PATCH_TASK_KEYS].sort().join('\u0000')
  ) reasons.push('PATCH_TASK_SCHEMA_NOT_CLOSED');
  if (Object.keys(context).sort().join('\u0000') !== [...PATCH_CONTEXT_KEYS].sort().join('\u0000')) {
    reasons.push('PATCH_CONTEXT_SCHEMA_NOT_CLOSED');
  }
  for (const [label, value] of [['taskId', task.taskId], ['jobId', task.jobId], ['caseId', task.caseId]] as const) {
    if (!isBoundedIdentifier(value)) reasons.push(`PATCH_${label.toUpperCase()}_INVALID`);
  }
  if (task.class !== 'CLASS_C_ISOLATED_PATCH_ONLY') reasons.push('PATCH_CLASS_NOT_C');
  if (!isGitCommitSha(task.baseSha) || !isGitCommitSha(context.expectedBaseSha) || task.baseSha !== context.expectedBaseSha) reasons.push('PATCH_BASE_SHA_MISMATCH');
  if (
    !isBoundedCanonicalAbsolutePath(task.sourceWorktreePath)
    || !isBoundedCanonicalAbsolutePath(task.isolatedWorktreePath)
    || !isBoundedCanonicalAbsolutePath(task.isolatedWorktreeParent)
  ) {
    reasons.push('PATCH_WORKTREE_PATH_NOT_CANONICAL_ABSOLUTE');
  } else {
    const source = task.sourceWorktreePath;
    const target = task.isolatedWorktreePath;
    const parent = task.isolatedWorktreeParent;
    validatedSource = source;
    validatedTarget = target;
    if (source === target || !containedBy(parent, target)) reasons.push('PATCH_WORKTREE_NOT_NEW_CHILD');
    if (containedBy(source, target) || containedBy(target, source)) reasons.push('PATCH_WORKTREES_NOT_DISJOINT');
    if (!isBoundedCanonicalAbsolutePath(context.expectedSourceWorktreePath) || source !== context.expectedSourceWorktreePath) {
      reasons.push('PATCH_SOURCE_WORKTREE_MISMATCH');
    }
    if (
      !isBoundedCanonicalAbsolutePath(context.verifiedSourceWorktreeRealpath)
      || source !== context.verifiedSourceWorktreeRealpath
    ) reasons.push('PATCH_SOURCE_REALPATH_MISMATCH');
    if (
      !isBoundedCanonicalAbsolutePath(context.verifiedIsolatedWorktreeParentRealpath)
      || parent !== context.verifiedIsolatedWorktreeParentRealpath
    ) reasons.push('PATCH_PARENT_REALPATH_MISMATCH');
    if (
      !isBoundedCanonicalAbsolutePath(context.verifiedSourceGitCommonDirRealpath)
      || !containedBy(source, context.verifiedSourceGitCommonDirRealpath)
    ) reasons.push('PATCH_SOURCE_NOT_DEDICATED_CLONE');
    const protectedWorktreePathsSnapshot = snapshotStringArray(
      context.protectedWorktreePaths,
      REQUIRED_PROTECTED_WORKTREE_BASENAMES.length,
    );
    const protectedWorktreePaths = protectedWorktreePathsSnapshot?.filter(isBoundedCanonicalAbsolutePath) ?? [];
    if (protectedWorktreePathsSnapshot === null || protectedWorktreePaths.length !== protectedWorktreePathsSnapshot.length) {
      reasons.push('PATCH_PROTECTED_WORKTREE_LIST_INVALID');
    }
    const protectedWorktreeBasenames = protectedWorktreePaths.map((protectedPath) => basename(protectedPath));
    if (
      protectedWorktreePaths.length !== REQUIRED_PROTECTED_WORKTREE_BASENAMES.length
      || new Set(protectedWorktreePaths).size !== protectedWorktreePaths.length
      || new Set(protectedWorktreeBasenames).size !== REQUIRED_PROTECTED_WORKTREE_BASENAMES.length
      || protectedWorktreeBasenames.sort().join('\u0000') !== [...REQUIRED_PROTECTED_WORKTREE_BASENAMES].sort().join('\u0000')
    ) reasons.push('PATCH_PROTECTED_WORKTREE_SET_NOT_CLOSED');
    let observedCanonicalPathEvidenceDigest: string | null = null;
    try {
      observedCanonicalPathEvidenceDigest = patchCanonicalPathEvidenceDigest({
        schema: 'AI_OPS_PATCH_CANONICAL_PATH_EVIDENCE_V1',
        expectedSourceWorktreePath: context.expectedSourceWorktreePath,
        verifiedSourceWorktreeRealpath: context.verifiedSourceWorktreeRealpath,
        verifiedSourceGitCommonDirRealpath: context.verifiedSourceGitCommonDirRealpath,
        verifiedIsolatedWorktreeParentRealpath: context.verifiedIsolatedWorktreeParentRealpath,
        sourceIsolation: context.sourceIsolation,
        protectedWorktreePaths,
      });
    } catch {
      // Invalid path evidence remains untrusted and cannot authorize a plan.
    }
    if (
      context.canonicalPathEvidenceSignatureVerified !== true
      || !isLowercaseSha256(context.canonicalPathEvidenceDigest)
      || observedCanonicalPathEvidenceDigest === null
      || context.canonicalPathEvidenceDigest !== observedCanonicalPathEvidenceDigest
    ) reasons.push('PATCH_CANONICAL_PATH_EVIDENCE_UNVERIFIED');
    if (protectedWorktreePaths.some((protectedPath) => overlapsProtectedPath(source, protectedPath))) {
      reasons.push('PATCH_SOURCE_TOUCHES_PROTECTED_WORKTREE');
    }
    if (protectedWorktreePaths.some((protectedPath) => overlapsProtectedPath(target, protectedPath))) {
      reasons.push('PATCH_TARGET_TOUCHES_PROTECTED_WORKTREE');
    }
    if (
      isBoundedCanonicalAbsolutePath(context.verifiedSourceGitCommonDirRealpath)
      && protectedWorktreePaths.some((protectedPath) => overlapsProtectedPath(context.verifiedSourceGitCommonDirRealpath, protectedPath))
    ) reasons.push('PATCH_GIT_COMMON_DIR_TOUCHES_PROTECTED_WORKTREE');
    if (
      isBoundedCanonicalAbsolutePath(context.verifiedIsolatedWorktreeParentRealpath)
      && protectedWorktreePaths.some((protectedPath) => overlapsProtectedPath(context.verifiedIsolatedWorktreeParentRealpath, protectedPath))
    ) reasons.push('PATCH_PARENT_TOUCHES_PROTECTED_WORKTREE');
    if (hasForbiddenWorktreeComponent(source)) reasons.push('PATCH_SOURCE_NAME_FORBIDDEN');
    if (hasForbiddenWorktreeComponent(target)) reasons.push('PATCH_TARGET_NAME_FORBIDDEN');
    if (isBoundedCanonicalAbsolutePath(context.verifiedSourceGitCommonDirRealpath)
      && hasForbiddenWorktreeComponent(context.verifiedSourceGitCommonDirRealpath)) reasons.push('PATCH_GIT_COMMON_DIR_NAME_FORBIDDEN');
    if (isBoundedCanonicalAbsolutePath(context.verifiedIsolatedWorktreeParentRealpath)
      && hasForbiddenWorktreeComponent(context.verifiedIsolatedWorktreeParentRealpath)) reasons.push('PATCH_PARENT_NAME_FORBIDDEN');
  }
  if (task.networkAccess !== 'DENIED') reasons.push('PATCH_NETWORK_MUST_BE_DENIED');
  const testRegistrySnapshot = snapshotArray(context.registeredTests, 32);
  const registeredTests: Readonly<RegisteredTestCommand>[] = [];
  if (testRegistrySnapshot !== null) {
    for (const rawRow of testRegistrySnapshot) {
      const row = snapshotDataRecord(rawRow);
      const argv = row === null ? null : snapshotStringArray(row.argv, 32);
      if (
        row === null
        || Object.keys(row).sort().join('\u0000') !== ['argv', 'testId'].join('\u0000')
        || !isBoundedIdentifier(row.testId)
        || argv === null
        || !hasBoundedRegisteredTestArgv(argv)
      ) continue;
      registeredTests.push(Object.freeze({ testId: row.testId, argv: Object.freeze([...argv]) }));
    }
  }
  if (testRegistrySnapshot === null || registeredTests.length !== testRegistrySnapshot.length) {
    reasons.push('PATCH_TEST_REGISTRY_SHAPE_INVALID');
  }
  if (new Set(registeredTests.map((row) => row.testId)).size !== registeredTests.length) reasons.push('PATCH_TEST_REGISTRY_DUPLICATE_ID');
  let observedRegistryDigest: string | null = null;
  try {
    observedRegistryDigest = registeredTestRegistryDigest(registeredTests);
  } catch {
    reasons.push('PATCH_TEST_REGISTRY_CANONICALIZATION_FAILED');
  }
  if (
    context.registeredTestRegistrySignatureVerified !== true
    || observedRegistryDigest === null
    || context.registeredTestRegistryDigest !== observedRegistryDigest
  ) reasons.push('PATCH_TEST_REGISTRY_UNVERIFIED');
  if (!Number.isSafeInteger(task.maximumDurationMs) || task.maximumDurationMs <= 0 || task.maximumDurationMs > 1_800_000) {
    reasons.push('PATCH_DURATION_BOUND_INVALID');
  }
  if (!Number.isSafeInteger(task.maximumOutputBytes) || task.maximumOutputBytes <= 0 || task.maximumOutputBytes > 50_000_000) {
    reasons.push('PATCH_OUTPUT_BOUND_INVALID');
  }
  const allowedWriteRootsSnapshot = snapshotStringArray(task.allowedWriteRoots, A3_EXCLUSIVE_PATCH_ROOTS.length);
  const allowedWriteRoots = allowedWriteRootsSnapshot ?? [];
  if (allowedWriteRootsSnapshot === null) {
    reasons.push('PATCH_WRITE_ROOTS_COLLECTION_INVALID');
  }
  if (new Set(allowedWriteRoots).size !== allowedWriteRoots.length || allowedWriteRoots.length === 0) {
    reasons.push('PATCH_WRITE_ROOTS_NOT_UNIQUE_OR_EMPTY');
  }
  for (const root of allowedWriteRoots) {
    if (!isSafeRelativeRoot(root) || !A3_EXCLUSIVE_PATCH_ROOTS.includes(root)) reasons.push(`PATCH_WRITE_ROOT_FORBIDDEN:${root}`);
  }
  const registeredTestIdsSnapshot = snapshotStringArray(task.registeredTestIds, 32);
  const registeredTestIds = registeredTestIdsSnapshot ?? [];
  if (registeredTestIdsSnapshot === null) {
    reasons.push('PATCH_TEST_IDS_COLLECTION_INVALID');
  }
  if (new Set(registeredTestIds).size !== registeredTestIds.length || registeredTestIds.length === 0) {
    reasons.push('PATCH_TEST_IDS_NOT_UNIQUE_OR_EMPTY');
  }
  const tests = new Map(registeredTests.map((row) => [row.testId, row]));
  const selected: readonly (readonly string[])[] = registeredTestIds.flatMap((testId) => {
    const row = tests.get(testId);
    if (row === undefined || !isBoundedIdentifier(testId) || !safeRegisteredTestArgv(row.argv)) {
      reasons.push(`PATCH_TEST_NOT_REGISTERED:${testId}`);
      return [];
    }
    return [Object.freeze([...row.argv])];
  });

  const planned = reasons.length === 0;
  return Object.freeze({
    schema: 'AI_OPS_ISOLATED_PATCH_PLAN_V1',
    planned,
    authorityGranted: false,
    runnerState: 'NOT_CONFIGURED',
    worktreeCreateArgv: planned
      ? Object.freeze(['git', '-C', validatedSource as string, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--lock', validatedTarget as string, task.baseSha])
      : null,
    sourceWorktreePath: planned ? validatedSource : null,
    testArgv: planned ? Object.freeze(selected) : Object.freeze([]),
    allowedWriteRoots: Object.freeze([...allowedWriteRoots]),
    mainWriteAccess: 'DENIED',
    mergeAccess: 'DENIED',
    pushAccess: 'DENIED',
    deploymentAccess: 'DENIED',
    moneyPathAccess: 'DENIED',
    networkAccess: 'DENIED',
    networkContainment: 'REQUIRES_EXTERNAL_SANDBOX_PORT',
    filesystemContainment: 'REQUIRES_EXTERNAL_SANDBOX_PORT',
    reasonCodes: Object.freeze(planned ? ['DECLARATIVE_PLAN_ONLY_RUNNER_NOT_CONFIGURED'] : reasons),
  });
}
