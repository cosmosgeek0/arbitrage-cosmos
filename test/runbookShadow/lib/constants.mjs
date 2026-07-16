import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(HERE, '../../..');
export const BASE_SHA = '492e3f69b054c85686bcfc4c09dbff4ababeda3f';
export const PACKET_ID = 'PORT-RUNBOOK';
export const PACKET_DISPOSITION = 'POST_LANDING_PORT_PRESTAGE';
export const TRUTH_LABEL = 'SYNTHETIC_ONLY';
export const AUTHORITY = 'SYNTHETIC_TEST';

export function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

export function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

export function drillDocument() {
  return readJson('fixtures/runbookShadow/drills.v1.json');
}

export function entryGateDocument() {
  return readJson('fixtures/runbookShadow/entry-gate.v1.json');
}

export function insertionRequestDocument() {
  return readJson('fixtures/runbookShadow/insertion-requests.v1.json');
}

export function drillDefinition(drillId) {
  const definition = drillDocument().drills.find((candidate) => candidate.id === drillId);
  if (!definition) throw new Error('RUNBOOK_PORT_DRILL_NOT_FOUND');
  return definition;
}

export const ZERO_EFFECT = Object.freeze({
  capitalEffect: '0',
  notionalEffect: '0',
  credentialReads: 0,
  networkAttempts: 0,
  orderCalls: 0,
  externalMutations: 0,
  deploymentCalls: 0,
});

export const EFFECT_EVIDENCE = Object.freeze({
  capitalEffect: 'DECLARED_ZERO_SYNTHETIC_DOMAIN',
  notionalEffect: 'DECLARED_ZERO_SYNTHETIC_DOMAIN',
  credentialReads: 'ENFORCED_NO_ENV_OR_CREDENTIAL_PATH',
  networkAttempts: 'OBSERVED_CANONICAL_EGRESS_TRIPWIRE_AND_RUNBOOK_SUPPLEMENT',
  orderCalls: 'ENFORCED_NO_MONEY_PATH_AND_SYNTHETIC_OWNER_INPUTS',
  externalMutations: 'ENFORCED_EXCLUSIVE_PATH_AND_LOCAL_HARNESS_SCOPE',
  deploymentCalls: 'ENFORCED_NO_OPS_OWNER_INVOCATION',
});
