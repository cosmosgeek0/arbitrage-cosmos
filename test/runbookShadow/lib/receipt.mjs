import { createHash } from 'node:crypto';

import {
  AUTHORITY,
  BASE_SHA,
  EFFECT_EVIDENCE,
  PACKET_DISPOSITION,
  PACKET_ID,
  TRUTH_LABEL,
  ZERO_EFFECT,
} from './constants.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function safeAssertion(assertion) {
  return Object.freeze({
    id: assertion.id,
    pass: assertion.pass === true,
    observed: assertion.observed ?? null,
  });
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function forbiddenClaimPath(value, trail = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = forbiddenClaimPath(value[index], `${trail}[${index}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (['acceptanceStatus', 'candidateReady', 'productionReady'].includes(key)) return `${trail}.${key}`;
    const hit = forbiddenClaimPath(child, `${trail}.${key}`);
    if (hit !== null) return hit;
  }
  return null;
}

function exactTrueBooleanRecord(value, expectedKeys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && same(Object.keys(value).sort(), [...expectedKeys].sort())
    && Object.values(value).every((entry) => entry === true);
}

function executableEvidenceReady(ownerEvidence, definition) {
  if (!exactTrueBooleanRecord(ownerEvidence?.evidenceChecks, definition.evidenceCheckIds)) return false;
  if (!exactTrueBooleanRecord(ownerEvidence?.contractBindings, definition.contractBindingIds)) return false;
  if (!same(ownerEvidence?.runtimeExecutions, definition.runtimeExecutionPlan)) return false;
  return ownerEvidence.expectedFailureObserved === true;
}

export function buildReceipt({ definition, injectedAtMs, assertions, ownerEvidence, networkAttempts, errorCode = null }) {
  const suppliedIds = new Set(assertions.map((assertion) => assertion.id));
  const missingAssertions = definition.assertionIds
    .filter((id) => !suppliedIds.has(id))
    .map((id) => ({ id, pass: false, observed: 'NOT_EVALUATED' }));
  const assertionItems = Object.freeze([...assertions, ...missingAssertions].map(safeAssertion));
  const passedAssertions = assertionItems.filter((assertion) => assertion.pass).length;
  const required = new Set(definition.assertionIds);
  const requiredPresent = missingAssertions.length === 0;
  const allPassed = requiredPresent
    && assertionItems.length >= required.size
    && passedAssertions === assertionItems.length
    && networkAttempts === 0
    && errorCode === null
    && executableEvidenceReady(ownerEvidence, definition);
  const result = allPassed ? 'PASS' : 'FAIL';
  const effects = Object.freeze({ ...ZERO_EFFECT, networkAttempts });

  return Object.freeze({
    schemaVersion: 1,
    packetId: PACKET_ID,
    packetDisposition: PACKET_DISPOSITION,
    baseSha: BASE_SHA,
    receiptId: `${PACKET_ID}-${definition.id.toUpperCase().replaceAll('-', '_')}-V1`,
    drillId: definition.id,
    title: definition.title,
    classification: definition.classification,
    result,
    exitCode: result === 'PASS' ? 0 : 1,
    injectedAtMs,
    command: Object.freeze(['node', definition.entrypoint]),
    truthLabel: TRUTH_LABEL,
    authority: AUTHORITY,
    expectedFailureObserved: ownerEvidence?.expectedFailureObserved === true,
    scenarioIds: Object.freeze([...definition.scenarioIds]),
    ownerEvidenceDigestSha256: digest(ownerEvidence ?? null),
    ownerEvidence: ownerEvidence ?? null,
    assertions: Object.freeze({
      passed: passedAssertions,
      total: assertionItems.length,
      requiredPresent,
      items: assertionItems,
    }),
    effects,
    effectEvidence: EFFECT_EVIDENCE,
    cockpitProjection: Object.freeze({ ...definition.projectionContract }),
    limitations: Object.freeze([...definition.limitations]),
    insertionRequestIds: Object.freeze([...definition.projectionContract.insertionRequestIds]),
    errorCode,
  });
}

export function validateReceipt(receipt, definition) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new TypeError('RECEIPT_OBJECT_REQUIRED');
  if (receipt.schemaVersion !== 1) throw new TypeError('RECEIPT_SCHEMA_UNSUPPORTED');
  const forbidden = forbiddenClaimPath(receipt);
  if (forbidden !== null) throw new TypeError(`RECEIPT_FORBIDDEN_CLAIM:${forbidden}`);
  if (receipt.packetId !== PACKET_ID || receipt.packetDisposition !== PACKET_DISPOSITION) throw new TypeError('RECEIPT_PACKET_MISMATCH');
  if (receipt.baseSha !== BASE_SHA) throw new TypeError('RECEIPT_BASE_MISMATCH');
  const expectedReceiptId = `${PACKET_ID}-${definition.id.toUpperCase().replaceAll('-', '_')}-V1`;
  if (receipt.receiptId !== expectedReceiptId
      || receipt.drillId !== definition.id
      || receipt.title !== definition.title
      || receipt.classification !== 'ADAPT_EXISTING') throw new TypeError('RECEIPT_DRILL_MISMATCH');
  if (!Number.isSafeInteger(receipt.injectedAtMs) || receipt.injectedAtMs < 0) throw new TypeError('RECEIPT_CLOCK_INVALID');
  if (!same(receipt.command, ['node', definition.entrypoint])) throw new TypeError('RECEIPT_COMMAND_MISMATCH');
  if (!['PASS', 'FAIL'].includes(receipt.result) || receipt.exitCode !== (receipt.result === 'PASS' ? 0 : 1)) throw new TypeError('RECEIPT_RESULT_INVALID');
  if (receipt.truthLabel !== TRUTH_LABEL || receipt.authority !== AUTHORITY) throw new TypeError('RECEIPT_SYNTHETIC_BOUNDARY_MISSING');
  if (!same(receipt.scenarioIds, definition.scenarioIds)) throw new TypeError('RECEIPT_SCENARIOS_MISMATCH');
  if (!same(receipt.cockpitProjection, definition.projectionContract)) throw new TypeError('RECEIPT_COCKPIT_CONTRACT_MISMATCH');
  if (!same(receipt.limitations, definition.limitations)) throw new TypeError('RECEIPT_LIMITATIONS_MISMATCH');
  if (!same(receipt.insertionRequestIds, definition.projectionContract.insertionRequestIds)) throw new TypeError('RECEIPT_INSERTION_REQUESTS_MISMATCH');
  if (!receipt.effects || typeof receipt.effects !== 'object' || Array.isArray(receipt.effects)) throw new TypeError('RECEIPT_EFFECTS_INVALID');
  if (!same(receipt.effectEvidence, EFFECT_EVIDENCE)) throw new TypeError('RECEIPT_EFFECT_EVIDENCE_INVALID');
  if (!same(Object.keys(receipt.effects).sort(), Object.keys(ZERO_EFFECT).sort())) throw new TypeError('RECEIPT_EFFECT_FIELDS_INVALID');
  if (receipt.effects.capitalEffect !== '0' || receipt.effects.notionalEffect !== '0') throw new TypeError('RECEIPT_NONZERO_CAPITAL');
  for (const field of ['credentialReads', 'orderCalls', 'externalMutations', 'deploymentCalls']) {
    if (receipt.effects[field] !== 0) throw new TypeError(`RECEIPT_NONZERO_EFFECT_${field}`);
  }
  if (!Number.isSafeInteger(receipt.effects.networkAttempts) || receipt.effects.networkAttempts < 0) throw new TypeError('RECEIPT_NETWORK_ATTEMPTS_INVALID');
  if (receipt.ownerEvidenceDigestSha256 !== digest(receipt.ownerEvidence ?? null)) throw new TypeError('RECEIPT_OWNER_EVIDENCE_DIGEST_MISMATCH');
  if (receipt.expectedFailureObserved !== (receipt.ownerEvidence?.expectedFailureObserved === true)) throw new TypeError('RECEIPT_EXPECTED_FAILURE_MISMATCH');
  if (!Array.isArray(receipt.assertions.items) || receipt.assertions.total !== receipt.assertions.items.length) throw new TypeError('RECEIPT_ASSERTIONS_INVALID');
  const assertionIds = receipt.assertions.items.map((assertion) => assertion.id);
  const ids = new Set(assertionIds);
  if (ids.size !== assertionIds.length) throw new TypeError('RECEIPT_ASSERTION_DUPLICATE');
  if (assertionIds.some((id) => !definition.assertionIds.includes(id) && id !== 'ADAPTER_EXECUTION')) throw new TypeError('RECEIPT_ASSERTION_UNKNOWN');
  const requiredPresent = definition.assertionIds.every((id) => receipt.assertions.items.some(
    (assertion) => assertion.id === id && assertion.observed !== 'NOT_EVALUATED',
  ));
  if (receipt.assertions.requiredPresent !== requiredPresent) throw new TypeError('RECEIPT_ASSERTION_PRESENCE_FORGED');
  const passed = receipt.assertions.items.filter((assertion) => assertion?.pass === true).length;
  if (receipt.assertions.passed !== passed) throw new TypeError('RECEIPT_ASSERTION_COUNT_FORGED');
  const scenarios = receipt.ownerEvidence?.scenarios;
  const scenarioEvidenceMatches = Array.isArray(scenarios)
    && scenarios.length === definition.scenarioIds.length
    && scenarios.every((scenario, index) => scenario?.id === definition.scenarioIds[index]
      && scenario?.terminal === definition.expectedTerminals[index]
      && scenario?.startedAtMs === receipt.injectedAtMs + (index * 10_000));
  const exactPassAssertions = same(assertionIds, definition.assertionIds)
    && passed === receipt.assertions.total;
  const computedResult = requiredPresent
    && exactPassAssertions
    && receipt.expectedFailureObserved
    && executableEvidenceReady(receipt.ownerEvidence, definition)
    && scenarioEvidenceMatches
    && receipt.effects.networkAttempts === 0
    && receipt.errorCode === null
    ? 'PASS'
    : 'FAIL';
  if (receipt.result !== computedResult) throw new TypeError('RECEIPT_FALSE_GREEN_OR_FALSE_RED');
  return true;
}
