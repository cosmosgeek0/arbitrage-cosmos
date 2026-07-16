import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  REASON_CODE_REGISTRY_SHA256,
  validateReasonCodeRegistrySnapshot,
} from '../../../../fixtures/productAssurance/systemic/observability/reason-code-registry.mjs';

const fixtureUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/cases/reason-code-registry.v1.json',
  import.meta.url,
);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('reason vocabulary fixture is exact, versioned, and canonical-hash-bound', async () => {
  const input = await fixture();
  assert.equal(input.registrySha256, REASON_CODE_REGISTRY_SHA256);
  assert.deepEqual(validateReasonCodeRegistrySnapshot(input), {
    schemaVersion: 'reason-code-registry.v1',
    registryId: 's5-conservation-stage-reasons',
    registryRevision: 1,
    registrySha256: REASON_CODE_REGISTRY_SHA256,
    codeCount: 6,
  });
});

test('reason vocabulary cannot be expanded or changed without the bound digest', async () => {
  const added = await fixture();
  added.entries.push({ code: 'CALLER_INVENTED_REASON', allowedContexts: ['TRANSITION'] });
  assert.throws(() => validateReasonCodeRegistrySnapshot(added), /canonical digest mismatch/);

  const changed = await fixture();
  changed.entries[0].allowedContexts.push('DISPOSITION');
  assert.throws(() => validateReasonCodeRegistrySnapshot(changed), /canonical digest mismatch/);
});
