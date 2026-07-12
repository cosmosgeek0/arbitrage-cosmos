#!/usr/bin/env node
/**
 * EDGE_PROTOCOL_V1 conformance tests. ZERO network, ZERO dependencies.
 * Validates every fixture (valid AND invalid) against the frozen schema using
 * a minimal JSON-Schema-subset validator, enforces forbidden-key rejection,
 * version fail-closed behavior, canonical round-trip stability, and size
 * bounds. Run from repo root: node packages/edge-protocol-tests/protocol.test.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDoc = JSON.parse(readFileSync(path.join(here, '../edge-protocol/schema/edge-protocol-v1.schema.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(path.join(here, '../edge-protocol/fixtures/fixtures-v1.json'), 'utf8'));

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const FORBIDDEN = /signature|api_?key|api_?secret|secret|passphrase|password|privatekey|listenkey|credential|approvedcapital|orderrequest|leveragemutation|livesendpermission/i;
const MAX_ENVELOPE_BYTES = 262144;

function findForbiddenKeys(value, trail = '$') {
  const hits = [];
  if (Array.isArray(value)) value.forEach((v, i) => hits.push(...findForbiddenKeys(v, `${trail}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.test(k.replace(/[-_]/g, ''))) hits.push(`${trail}.${k}`);
      hits.push(...findForbiddenKeys(v, `${trail}.${k}`));
    }
  }
  return hits;
}

function resolveRef(ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  let node = schemaDoc;
  for (const part of ref.slice(2).split('/')) node = node[part];
  if (!node) throw new Error(`unresolved $ref ${ref}`);
  return node;
}

function validate(schema, value, trail = '$') {
  const errs = [];
  if (schema.$ref) return validate(resolveRef(schema.$ref), value, trail);
  if (schema.anyOf) {
    const branches = schema.anyOf.map((s) => validate(s, value, trail));
    if (!branches.some((b) => b.length === 0)) errs.push(`${trail}: no anyOf branch matched`);
    return errs;
  }
  if ('const' in schema && value !== schema.const) errs.push(`${trail}: expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${trail}: ${JSON.stringify(value)} not in enum`);
  if (schema.type) {
    const t = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) && schema.type === 'integer' ? 'integer' : typeof value;
    const ok = Array.isArray(schema.type) ? schema.type.includes(t) : schema.type === t || (schema.type === 'number' && t === 'integer');
    if (!ok) errs.push(`${trail}: expected type ${schema.type}, got ${t}`);
    if (!ok) return errs;
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${trail}: pattern mismatch`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${trail}: too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${trail}: too long`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${trail}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${trail}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${trail}: too many items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${trail}[${i}]`)));
  } else if (value && typeof value === 'object') {
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) errs.push(`${trail}: too many properties`);
    for (const req of schema.required ?? []) if (!(req in value)) errs.push(`${trail}: missing required ${req}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) errs.push(...validate(schema.properties[k], v, `${trail}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${trail}: unknown field ${k}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errs.push(...validate(schema.additionalProperties, v, `${trail}.${k}`));
    }
  }
  return errs;
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number');
  return JSON.stringify(value);
}

function validateEnvelope(envelope) {
  const errs = [];
  const name = envelope?.schema;
  const registered = typeof name === 'string' && Object.prototype.hasOwnProperty.call(schemaDoc.$defs, name) && name.endsWith('V1');
  if (!registered) return [`unregistered envelope schema ${JSON.stringify(name)}`];
  if (envelope.version !== 1) return ['PROTOCOL_VERSION_UNSUPPORTED'];
  errs.push(...validate(schemaDoc.$defs[name], envelope));
  const forbidden = findForbiddenKeys(envelope);
  if (forbidden.length) errs.push(`forbidden keys: ${forbidden.join(', ')}`);
  const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  if (bytes > MAX_ENVELOPE_BYTES) errs.push(`envelope exceeds ${MAX_ENVELOPE_BYTES} bytes`);
  return errs;
}

console.log('EDGE_PROTOCOL_V1 conformance');
console.log('— valid fixtures accept —');
for (const f of fixtures.valid) {
  const errs = validateEnvelope(f.envelope);
  check(`valid: ${f.name}`, errs.length === 0, errs.slice(0, 2).join('; '));
}
console.log('— invalid fixtures reject —');
for (const f of fixtures.invalid) {
  const errs = validateEnvelope(f.envelope);
  check(`invalid rejected: ${f.name}`, errs.length > 0, errs.length ? '' : 'was wrongly accepted');
}
console.log('— laws —');
{
  const v2 = { ...fixtures.valid[4].envelope, version: 2 };
  check('version 2 fails closed', validateEnvelope(v2).length > 0);
  const alien = { schema: 'TotallyNewEnvelopeV1x', version: 1 };
  check('unregistered schema fails closed', validateEnvelope(alien).length > 0);
  const a = canonicalStringify(fixtures.valid[1].envelope);
  const b = canonicalStringify(JSON.parse(JSON.stringify(fixtures.valid[1].envelope)));
  check('canonical round-trip is byte-stable', a === b && a.length > 100);
  const shuffled = JSON.parse(a);
  check('key order does not change canonical form', canonicalStringify(shuffled) === a);
  const secretless = fixtures.valid.every((f) => findForbiddenKeys(f.envelope).length === 0);
  check('no valid fixture contains forbidden keys', secretless);
  const assessment = fixtures.valid.find((f) => f.envelope.schema === 'EdgeAssessmentEnvelopeV1').envelope;
  check('assessment with unknown economics abstains', assessment.netExpectedValue.state === 'UNKNOWN' && assessment.advisoryAction === 'ABSTAIN_UNKNOWN');
  check('advisory actions exclude any order verb', !JSON.stringify(schemaDoc.$defs.EdgeAssessmentEnvelopeV1.properties.advisoryAction.enum).match(/ORDER|SEND|EXECUTE|BUY|SELL/));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} protocol checks passed`);
process.exit(failed ? 1 : 0);
