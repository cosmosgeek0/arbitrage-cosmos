import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  projectAiOpsPassiveStatus,
} from '../../../dist/aiOps/projections/passiveStatus.js';
import {
  AI_OPS_CAPABILITY_RELIABILITY_TARGETS,
} from '../../../dist/aiOps/reliability/runbooks.js';
import {
  AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES,
} from '../../../dist/aiOps/manifests/artifacts.js';

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}

test('source-bound AI Operations projection preserves absent operational truth', () => {
  const projection = projectAiOpsPassiveStatus();
  const secondProjection = projectAiOpsPassiveStatus();

  assert.equal(projectAiOpsPassiveStatus.length, 0);
  assert.equal(projection.schema, 'AI_OPS_PASSIVE_STATUS_PROJECTION_V1');
  assert.equal(projection.projectionKind, 'SOURCE_BOUND_PASSIVE_READ_ONLY');
  assert.equal(projection.configurationState, 'NOT_CONFIGURED');
  assert.equal(projection.mountState, 'NOT_MOUNTED');
  assert.equal(projection.activityState, 'UNKNOWN');
  assert.deepEqual(projection.caseCounts, {
    ACTIVE: null,
    PAUSED: null,
    COMPLETED: null,
    FAILED: null,
  });
  assert.deepEqual(projection.operationalCases, []);
  assert.deepEqual(projection.runtimeContract, {
    posture: 'SHADOW_SPECULATIVE',
    operationalRuntimeEvidence: 'NOT_MOUNTED',
    shadowIncidentAcceptedForOperationalStatus: false,
    acceptedForOperationalStatus: false,
  });
  assert.equal(projection.observedAtMs, null);

  assert.equal(projection.reliability.state, 'UNSIGNED_INACTIVE');
  assert.equal(
    projection.reliability.targetCount,
    AI_OPS_CAPABILITY_RELIABILITY_TARGETS.length,
  );
  assert.equal(projection.reliability.activeTargetCount, 0);
  assert.equal(projection.reliability.authorityGranted, false);
  assert.deepEqual(projection.reliability.blockerCodes, [
    'AI_OPS_RELIABILITY_TARGETS_UNSIGNED_INACTIVE',
  ]);
  assert.deepEqual(
    projection.blockers,
    AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES
      .map((dependency) => ({
        code: dependency.dependencyId,
        state: dependency.currentState,
        detail: dependency.requirement,
        source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
      }))
      .sort((left, right) => (
        left.code < right.code ? -1 : left.code > right.code ? 1 : 0
      )),
  );
  assert.equal(new Set(projection.blockers.map(({ code }) => code)).size, 9);
  assert.equal(projection.actionAuthority, 'NONE');
  assert.equal(projection.selfHealingClaim, 'NONE');
  assert.equal(projection.providerCallPerformed, false);
  assert.deepEqual(secondProjection, projection);
  assertDeeplyFrozen(projection);
});

test('passive projection source has no transport, process, persistence, or environment seam', async () => {
  const source = await readFile(
    new URL('../../../src/aiOps/projections/passiveStatus.ts', import.meta.url),
    'utf8',
  );

  assert.deepEqual(
    [...source.matchAll(/\bfrom\s+'([^']+)'/gu)].map((match) => match[1]),
    [
      '../manifests/artifacts.js',
      '../reliability/runbooks.js',
      '../runtime/types.js',
    ],
  );
  assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls|fs)/u);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.doesNotMatch(source, /\bprocess\.(?:env|exit|kill)\b/u);
  assert.doesNotMatch(source, /\b(?:Date\.now|Math\.random|setInterval|setTimeout)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|write|save|execute|spawn|execFile)\s*\(/iu);
});
