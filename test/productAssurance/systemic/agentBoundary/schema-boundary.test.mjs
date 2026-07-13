import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CLASS_CANDIDATES,
  SANDBOX_BINDING,
  SANDBOX_NOT_CONFIGURED,
  clone,
  validSchemaRecords,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.fixtures.mjs';
import {
  canonicalStringify,
  findForbiddenKeys,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/canonical.mjs';
import { createSchemaValidator } from './schema-validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(path.join(here, '../../../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json'), 'utf8'));
const validate = createSchemaValidator(schema);

test('every deterministic fixture record satisfies the closed v1 schema', () => {
  for (const record of validSchemaRecords()) {
    assert.deepEqual(validate(schema, record), [], `${record.schema}: ${validate(schema, record).join('; ')}`);
  }
});

test('schema fails closed on unknown fields and unsupported versions', () => {
  const extra = { ...clone(SANDBOX_BINDING), unexpectedRuntimeAuthority: true };
  assert.ok(validate(schema, extra).some((error) => error.includes('oneOf')));

  const v2 = { ...clone(SANDBOX_BINDING), version: 2 };
  assert.ok(validate(schema, v2).some((error) => error.includes('oneOf')));
});

test('Class A-D vocabulary is closed and cannot be widened by a fixture', () => {
  const invalid = { ...clone(CLASS_CANDIDATES.A), declaredClass: 'E' };
  assert.ok(validate(schema, invalid).length > 0);
  assert.deepEqual(Object.keys(CLASS_CANDIDATES).sort(), ['A', 'B', 'C', 'D']);
});

test('valid fixtures contain no secret-bearing payload field and canonical form is stable', () => {
  const records = validSchemaRecords();
  assert.deepEqual(findForbiddenKeys(records), []);
  const first = canonicalStringify(records);
  const second = canonicalStringify(JSON.parse(JSON.stringify(records)));
  assert.equal(first, second);
  assert.ok(first.length > 1_000);
});

test('sandbox schema permits only the deterministic stub and deny-all egress', () => {
  const binding = schema.$defs.ExternalSandboxBindingV1;
  assert.equal(binding.properties.providerMode.const, 'DETERMINISTIC_STUB');
  assert.equal(binding.properties.networkPolicy.const, 'DENY_ALL');
  assert.equal(binding.properties.egressAllowlist.maxItems, 0);
});

test('NOT_CONFIGURED sandbox is a closed complete absence state with no invented provider facts', () => {
  assert.deepEqual(validate(schema, SANDBOX_NOT_CONFIGURED), []);
  for (const invented of ['providerId', 'workloadIdentityRef', 'approvalRef', 'issuedAtMs', 'expiresAtMs', 'budget', 'allowedCapabilities']) {
    assert.equal(Object.hasOwn(SANDBOX_NOT_CONFIGURED, invented), false, invented);
  }
});
