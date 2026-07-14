import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { loadA3 } from './networkDeny.mjs';

const a3 = await loadA3();
const baseSha = '03857dcdaff8d8b12627d27ddcc97505da1f2f86';

function task(overrides = {}) {
  return {
    schema: 'AI_OPS_ISOLATED_PATCH_TASK_V1',
    taskId: 'patch-task-test-only',
    jobId: 'job-test-only',
    caseId: 'case-test-only',
    class: 'CLASS_C_ISOLATED_PATCH_ONLY',
    baseSha,
    sourceWorktreePath: '/tmp/source-test-only',
    isolatedWorktreePath: '/tmp/aiops-patch-workers/worker-test-only',
    isolatedWorktreeParent: '/tmp/aiops-patch-workers',
    allowedWriteRoots: [...a3.A3_EXCLUSIVE_PATCH_ROOTS],
    registeredTestIds: ['a3-focused-test'],
    maximumDurationMs: 300_000,
    maximumOutputBytes: 5_000_000,
    networkAccess: 'DENIED',
    ...overrides,
  };
}

function context(overrides = {}) {
  const registeredTests = [
    { testId: 'a3-focused-test', argv: ['npm', 'run', 'test:a3-focused-placeholder'] },
  ];
  const value = {
    expectedBaseSha: baseSha,
    expectedSourceWorktreePath: '/tmp/source-test-only',
    verifiedSourceWorktreeRealpath: '/tmp/source-test-only',
    verifiedSourceGitCommonDirRealpath: '/tmp/source-test-only/.git',
    verifiedIsolatedWorktreeParentRealpath: '/tmp/aiops-patch-workers',
    sourceIsolation: 'DEDICATED_DISPOSABLE_CLONE',
    canonicalPathEvidenceDigest: 'a'.repeat(64),
    canonicalPathEvidenceSignatureVerified: true,
    protectedWorktreePaths: [
      '/Users/cosmosgeek/Desktop/Main',
      '/Users/cosmosgeek/Desktop/current-main',
      '/Users/cosmosgeek/Desktop/i00-assembly',
    ],
    registeredTests,
    registeredTestRegistryDigest: a3.registeredTestRegistryDigest(registeredTests),
    registeredTestRegistrySignatureVerified: true,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'canonicalPathEvidenceDigest')) {
    try {
      value.canonicalPathEvidenceDigest = a3.patchCanonicalPathEvidenceDigest({
        schema: 'AI_OPS_PATCH_CANONICAL_PATH_EVIDENCE_V1',
        expectedSourceWorktreePath: value.expectedSourceWorktreePath,
        verifiedSourceWorktreeRealpath: value.verifiedSourceWorktreeRealpath,
        verifiedSourceGitCommonDirRealpath: value.verifiedSourceGitCommonDirRealpath,
        verifiedIsolatedWorktreeParentRealpath: value.verifiedIsolatedWorktreeParentRealpath,
        sourceIsolation: value.sourceIsolation,
        protectedWorktreePaths: value.protectedWorktreePaths,
      });
    } catch {
      // Malformed evidence remains deliberately unverifiable in hostile tests.
    }
  }
  return value;
}

function rawRegisteredTestRegistryDigest(rows) {
  const canonicalRows = rows.map((row) => ({ argv: row.argv, testId: row.testId }));
  return createHash('sha256').update(JSON.stringify(canonicalRows)).digest('hex');
}

describe('A3 Class-C isolated patch planner', () => {
  it('returns a locked detached exact-SHA plan but never executes it', () => {
    const plan = a3.planIsolatedPatchWorker(task(), context());
    assert.equal(plan.planned, true);
    assert.equal(plan.runnerState, 'NOT_CONFIGURED');
    assert.equal(plan.authorityGranted, false);
    assert.deepEqual(plan.worktreeCreateArgv, [
      'git', '-C', '/tmp/source-test-only', '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--lock',
      '/tmp/aiops-patch-workers/worker-test-only', baseSha,
    ]);
    assert.equal(plan.mainWriteAccess, 'DENIED');
    assert.equal(plan.mergeAccess, 'DENIED');
    assert.equal(plan.pushAccess, 'DENIED');
    assert.equal(plan.deploymentAccess, 'DENIED');
    assert.equal(plan.moneyPathAccess, 'DENIED');
    assert.equal(plan.networkAccess, 'DENIED');
    assert.equal(plan.networkContainment, 'REQUIRES_EXTERNAL_SANDBOX_PORT');
    assert.equal(plan.filesystemContainment, 'REQUIRES_EXTERNAL_SANDBOX_PORT');
  });

  it('rejects protected worktrees, base drift, shared paths and unregistered commands', () => {
    const protectedPlan = a3.planIsolatedPatchWorker(task({
      isolatedWorktreePath: '/Users/cosmosgeek/Desktop/Main/a3-worker',
      isolatedWorktreeParent: '/Users/cosmosgeek/Desktop/Main',
    }), context());
    assert.equal(protectedPlan.planned, false);
    assert.match(protectedPlan.reasonCodes.join(','), /PATCH_TARGET_TOUCHES_PROTECTED_WORKTREE/);

    const hostile = a3.planIsolatedPatchWorker(task({
      baseSha: 'f'.repeat(40),
      allowedWriteRoots: ['server/src/index.ts'],
      registeredTestIds: ['arbitrary-command'],
      networkAccess: 'ALLOWED',
    }), context());
    const reasons = hostile.reasonCodes.join(',');
    assert.equal(hostile.worktreeCreateArgv, null);
    assert.match(reasons, /PATCH_BASE_SHA_MISMATCH/);
    assert.match(reasons, /PATCH_WRITE_ROOT_FORBIDDEN/);
    assert.match(reasons, /PATCH_TEST_NOT_REGISTERED/);
    assert.match(reasons, /PATCH_NETWORK_MUST_BE_DENIED/);
  });

  it('rejects a protected or ambient source and dangerous registered commands', () => {
    const mainSource = a3.planIsolatedPatchWorker(task({
      sourceWorktreePath: '/Users/cosmosgeek/Desktop/Main',
    }), context({
      expectedSourceWorktreePath: '/Users/cosmosgeek/Desktop/Main',
      verifiedSourceWorktreeRealpath: '/Users/cosmosgeek/Desktop/Main',
      verifiedSourceGitCommonDirRealpath: '/Users/cosmosgeek/Desktop/Main/.git',
    }));
    assert.match(mainSource.reasonCodes.join(','), /PATCH_SOURCE_TOUCHES_PROTECTED_WORKTREE/);

    const mainWithoutCallerProtection = a3.planIsolatedPatchWorker(task({
      sourceWorktreePath: '/Users/cosmosgeek/Desktop/Main',
    }), context({
      expectedSourceWorktreePath: '/Users/cosmosgeek/Desktop/Main',
      verifiedSourceWorktreeRealpath: '/Users/cosmosgeek/Desktop/Main',
      verifiedSourceGitCommonDirRealpath: '/Users/cosmosgeek/Desktop/Main/.git',
      protectedWorktreePaths: [],
    }));
    assert.equal(mainWithoutCallerProtection.planned, false);
    assert.match(mainWithoutCallerProtection.reasonCodes.join(','), /PATCH_SOURCE_NAME_FORBIDDEN/);

    const dangerousTests = [{ testId: 'a3-focused-test', argv: ['git', 'push', 'origin', 'main'] }];
    const dangerous = a3.planIsolatedPatchWorker(task(), context({
      registeredTests: dangerousTests,
      registeredTestRegistryDigest: a3.registeredTestRegistryDigest(dangerousTests),
    }));
    assert.equal(dangerous.planned, false);
    assert.match(dangerous.reasonCodes.join(','), /PATCH_TEST_NOT_REGISTERED/);

    const unsigned = a3.planIsolatedPatchWorker(task(), context({ registeredTestRegistrySignatureVerified: false }));
    assert.match(unsigned.reasonCodes.join(','), /PATCH_TEST_REGISTRY_UNVERIFIED/);

    const truthySignature = a3.planIsolatedPatchWorker(task(), context({ registeredTestRegistrySignatureVerified: 'YES' }));
    assert.equal(truthySignature.planned, false);
    assert.match(truthySignature.reasonCodes.join(','), /PATCH_TEST_REGISTRY_UNVERIFIED/);
  });

  it('rejects ancestors that could reach protected worktrees', () => {
    const ancestorSource = a3.planIsolatedPatchWorker(task({
      sourceWorktreePath: '/Users/cosmosgeek/Desktop',
    }), context({
      expectedSourceWorktreePath: '/Users/cosmosgeek/Desktop',
      verifiedSourceWorktreeRealpath: '/Users/cosmosgeek/Desktop',
      verifiedSourceGitCommonDirRealpath: '/Users/cosmosgeek/Desktop/.git',
    }));
    assert.equal(ancestorSource.planned, false);
    assert.match(ancestorSource.reasonCodes.join(','), /PATCH_SOURCE_TOUCHES_PROTECTED_WORKTREE/);

    const ancestorTargetParent = a3.planIsolatedPatchWorker(task({
      isolatedWorktreePath: '/Users/cosmosgeek/Desktop/a3-workers/worker-test-only',
      isolatedWorktreeParent: '/Users/cosmosgeek/Desktop',
    }), context({
      verifiedIsolatedWorktreeParentRealpath: '/Users/cosmosgeek/Desktop',
    }));
    assert.equal(ancestorTargetParent.planned, false);
    assert.match(ancestorTargetParent.reasonCodes.join(','), /PATCH_PARENT_TOUCHES_PROTECTED_WORKTREE/);

    const emptyProtectionDesktopSource = a3.planIsolatedPatchWorker(task({
      sourceWorktreePath: '/Users/cosmosgeek/Desktop',
    }), context({
      expectedSourceWorktreePath: '/Users/cosmosgeek/Desktop',
      verifiedSourceWorktreeRealpath: '/Users/cosmosgeek/Desktop',
      verifiedSourceGitCommonDirRealpath: '/Users/cosmosgeek/Desktop/.git',
      protectedWorktreePaths: [],
    }));
    assert.equal(emptyProtectionDesktopSource.planned, false);
    assert.match(emptyProtectionDesktopSource.reasonCodes.join(','), /PATCH_PROTECTED_WORKTREE_SET_NOT_CLOSED/);

    const missingProtectionDesktopParent = a3.planIsolatedPatchWorker(task({
      isolatedWorktreePath: '/Users/cosmosgeek/Desktop/a3-workers/worker-test-only',
      isolatedWorktreeParent: '/Users/cosmosgeek/Desktop',
    }), context({
      verifiedIsolatedWorktreeParentRealpath: '/Users/cosmosgeek/Desktop',
      protectedWorktreePaths: [
        '/Users/cosmosgeek/Desktop/Main',
        '/Users/cosmosgeek/Desktop/current-main',
      ],
    }));
    assert.equal(missingProtectionDesktopParent.planned, false);
    assert.match(missingProtectionDesktopParent.reasonCodes.join(','), /PATCH_PROTECTED_WORKTREE_SET_NOT_CLOSED/);

    const signedContext = context();
    const tamperedProtectedSet = a3.planIsolatedPatchWorker(task(), {
      ...signedContext,
      protectedWorktreePaths: ['/private/tmp/Main', '/private/tmp/current-main', '/private/tmp/i00-assembly'],
    });
    assert.equal(tamperedProtectedSet.planned, false);
    assert.match(tamperedProtectedSet.reasonCodes.join(','), /PATCH_CANONICAL_PATH_EVIDENCE_UNVERIFIED/);
  });

  it('fails closed instead of throwing on malformed collection fields', () => {
    for (const malformed of [
      task({ allowedWriteRoots: null }),
      task({ allowedWriteRoots: {} }),
      task({ registeredTestIds: null }),
      task({ registeredTestIds: {} }),
    ]) {
      assert.doesNotThrow(() => a3.planIsolatedPatchWorker(malformed, context()));
      assert.equal(a3.planIsolatedPatchWorker(malformed, context()).planned, false);
    }

    const contextWithUnexpectedField = context({ attackerControlledUnexpectedField: true });
    const unexpectedContextPlan = a3.planIsolatedPatchWorker(task(), contextWithUnexpectedField);
    assert.equal(unexpectedContextPlan.planned, false);
    assert.match(unexpectedContextPlan.reasonCodes.join(','), /PATCH_CONTEXT_SCHEMA_NOT_CLOSED/);

    const oversizedRegistryRows = Array.from({ length: 33 }, (_, index) => ({
      testId: `bounded-registry-${index}`,
      argv: ['node', `test/aiOps/providerAdapters/bounded-${index}.test.mjs`],
    }));
    let registryLengthReads = 0;
    const hostileLengthRegistry = new Proxy(oversizedRegistryRows, {
      get(target, property, receiver) {
        if (property === 'length') {
          registryLengthReads += 1;
          return registryLengthReads === 1 ? 1 : Reflect.get(target, property, receiver);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(() => a3.registeredTestRegistryDigest(hostileLengthRegistry), /exceeds bound|bounded closed data rows/);

    let rootsLengthReads = 0;
    const hostileLengthRoots = new Proxy([...a3.A3_EXCLUSIVE_PATCH_ROOTS, 'server/src/index.ts'], {
      get(target, property, receiver) {
        if (property === 'length') {
          rootsLengthReads += 1;
          return rootsLengthReads === 1 ? 1 : Reflect.get(target, property, receiver);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const hostileRootsPlan = a3.planIsolatedPatchWorker(task({ allowedWriteRoots: hostileLengthRoots }), context());
    assert.equal(hostileRootsPlan.planned, false);
    assert.match(hostileRootsPlan.reasonCodes.join(','), /PATCH_WRITE_ROOTS_COLLECTION_INVALID|PATCH_WRITE_ROOTS_NOT_EXACTLY_A3/);
  });

  it('rejects NUL-bearing, oversized and non-canonical absolute path evidence', () => {
    for (const overrides of [
      { sourceWorktreePath: '/tmp/source-test-only\u0000/escape' },
      { isolatedWorktreePath: '/tmp/aiops-patch-workers/worker-test-only\u0000/escape' },
      { isolatedWorktreeParent: '/tmp/aiops-patch-workers\u0000/escape' },
      { sourceWorktreePath: '/tmp/../tmp/source-test-only' },
      { sourceWorktreePath: `/${'a'.repeat(4096)}` },
    ]) {
      const plan = a3.planIsolatedPatchWorker(task(overrides), context());
      assert.equal(plan.planned, false);
      assert.match(plan.reasonCodes.join(','), /PATCH_WORKTREE_PATH_NOT_CANONICAL_ABSOLUTE/);
    }

    for (const overrides of [
      { expectedSourceWorktreePath: '/tmp/source-test-only\u0000/escape' },
      { verifiedSourceWorktreeRealpath: '/tmp/source-test-only\u0000/escape' },
      { verifiedSourceGitCommonDirRealpath: '/tmp/source-test-only/.git\u0000/escape' },
      { verifiedIsolatedWorktreeParentRealpath: '/tmp/aiops-patch-workers\u0000/escape' },
    ]) {
      assert.equal(a3.planIsolatedPatchWorker(task(), context(overrides)).planned, false);
    }

    const protectedPathWithNul = a3.planIsolatedPatchWorker(task(), context({
      protectedWorktreePaths: ['/Users/cosmosgeek/Desktop/Main\u0000/escape'],
    }));
    assert.equal(protectedPathWithNul.planned, false);
    assert.match(protectedPathWithNul.reasonCodes.join(','), /PATCH_PROTECTED_WORKTREE_LIST_INVALID/);
  });

  it('rejects path aliases, nested targets, accessor TOCTOU and command-option escapes', () => {
    const sourceAlias = a3.planIsolatedPatchWorker(task({
      sourceWorktreePath: '/tmp/a3-main-alias-test-only',
    }), context({
      expectedSourceWorktreePath: '/tmp/a3-main-alias-test-only',
      verifiedSourceWorktreeRealpath: '/Users/cosmosgeek/Desktop/Main',
      verifiedSourceGitCommonDirRealpath: '/Users/cosmosgeek/Desktop/Main/.git',
      protectedWorktreePaths: [],
    }));
    assert.equal(sourceAlias.planned, false);
    assert.match(sourceAlias.reasonCodes.join(','), /PATCH_SOURCE_REALPATH_MISMATCH|PATCH_GIT_COMMON_DIR_NAME_FORBIDDEN/);

    const parentAlias = a3.planIsolatedPatchWorker(task({
      isolatedWorktreePath: '/tmp/a3-parent-alias-test-only/worker',
      isolatedWorktreeParent: '/tmp/a3-parent-alias-test-only',
    }), context({ verifiedIsolatedWorktreeParentRealpath: '/Users/cosmosgeek/Desktop/Main' }));
    assert.equal(parentAlias.planned, false);
    assert.match(parentAlias.reasonCodes.join(','), /PATCH_PARENT_REALPATH_MISMATCH|PATCH_PARENT_NAME_FORBIDDEN/);

    const nested = a3.planIsolatedPatchWorker(task({
      isolatedWorktreePath: '/tmp/source-test-only/nested-worker',
      isolatedWorktreeParent: '/tmp/source-test-only',
    }), context({ verifiedIsolatedWorktreeParentRealpath: '/tmp/source-test-only' }));
    assert.equal(nested.planned, false);
    assert.match(nested.reasonCodes.join(','), /PATCH_WORKTREES_NOT_DISJOINT/);

    const accessorTask = task();
    Object.defineProperty(accessorTask, 'sourceWorktreePath', { enumerable: true, get: () => '/tmp/source-test-only' });
    assert.equal(a3.planIsolatedPatchWorker(accessorTask, context()).planned, false);

    const escapedCommands = [
      ['node', 'test/../../../tmp/evil.mjs'],
      ['node', '--eval=1', 'test/ok.mjs'],
      ['node', '--import=data:text/javascript,void 0', 'test/ok.mjs'],
      ['node', '--require=/tmp/evil.cjs', 'test/ok.mjs'],
      ['npm', 'run', 'build', '--', '--config', '/tmp/evil.mjs'],
    ];
    for (const argv of escapedCommands) {
      const rows = [{ testId: 'a3-focused-test', argv }];
      const plan = a3.planIsolatedPatchWorker(task(), context({
        registeredTests: rows,
        registeredTestRegistryDigest: a3.registeredTestRegistryDigest(rows),
      }));
      assert.equal(plan.planned, false, argv.join(' '));
      assert.match(plan.reasonCodes.join(','), /PATCH_TEST_NOT_REGISTERED/);
    }
  });

  it('rejects registered test argv that exceed per-argument or total UTF-8 bounds before planning', () => {
    const oversizedArgvRows = [
      { testId: 'a3-focused-test', argv: ['npm', 'run', `test:${'a'.repeat(100_000)}`] },
      { testId: 'a3-focused-test', argv: ['node', `test/${'a'.repeat(100_000)}.mjs`] },
      {
        testId: 'a3-focused-test',
        argv: ['node', ...Array.from({ length: 10 }, (_, index) => `test/${index}-${'a'.repeat(900)}.mjs`)],
      },
    ];
    for (const row of oversizedArgvRows) {
      const rows = [row];
      assert.throws(() => a3.registeredTestRegistryDigest(rows), /argv bounds/);
      const plan = a3.planIsolatedPatchWorker(task(), context({
        registeredTests: rows,
        registeredTestRegistryDigest: rawRegisteredTestRegistryDigest(rows),
      }));
      assert.equal(plan.planned, false);
      assert.match(plan.reasonCodes.join(','), /PATCH_TEST_REGISTRY_SHAPE_INVALID|PATCH_TEST_NOT_REGISTERED/);
    }
  });
});
