import {
  assertArray,
  assertBoundedString,
  assertClosedRecord,
  assertEnum,
  assertSafeInteger,
  assertSha256,
  assertUnique,
} from './reference-helpers.mjs';
import {
  canonicalJson,
  sha256CanonicalJson,
  sha256CanonicalJsonExcluding,
} from './canonical-sha256.mjs';

const CONTEXTS = Object.freeze(['TRANSITION', 'DISPOSITION']);
const ENTRIES = Object.freeze([
  Object.freeze({ code: 'DROP_CONFLICT', allowedContexts: Object.freeze(['TRANSITION']) }),
  Object.freeze({ code: 'DUPLICATE_RECONCILED', allowedContexts: Object.freeze(['TRANSITION', 'DISPOSITION']) }),
  Object.freeze({ code: 'DUPLICATE_REPLAY', allowedContexts: Object.freeze(['TRANSITION']) }),
  Object.freeze({ code: 'MATERIAL_DROP_ATTEMPT', allowedContexts: Object.freeze(['TRANSITION', 'DISPOSITION']) }),
  Object.freeze({ code: 'PROCESSING_LATE', allowedContexts: Object.freeze(['TRANSITION', 'DISPOSITION']) }),
  Object.freeze({ code: 'UNRESOLVED_EXPORT_ACK', allowedContexts: Object.freeze(['TRANSITION', 'DISPOSITION']) }),
]);
const PAYLOAD = Object.freeze({
  schemaVersion: 'reason-code-registry.v1',
  registryId: 's5-conservation-stage-reasons',
  registryRevision: 1,
  entries: ENTRIES,
});

export const REASON_CODE_REGISTRY_SHA256 = 'b7566667d11bd720663ede56d0f3405fbf45cd53b2c71abd8e231dc2fbe1bc68';

function assertIdentifier(value, path) {
  assertBoundedString(value, path, 1, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) throw new TypeError(`${path} is not a stable identifier`);
}

function embeddedDigest() {
  return sha256CanonicalJson(PAYLOAD);
}

function assertEmbeddedRegistryIntegrity() {
  if (embeddedDigest() !== REASON_CODE_REGISTRY_SHA256) {
    throw new TypeError('embedded reason-code registry digest mismatch');
  }
}

export function reasonCodeRegistryMetadata() {
  assertEmbeddedRegistryIntegrity();
  return {
    schemaVersion: PAYLOAD.schemaVersion,
    registryId: PAYLOAD.registryId,
    registryRevision: PAYLOAD.registryRevision,
    registrySha256: REASON_CODE_REGISTRY_SHA256,
    codeCount: ENTRIES.length,
  };
}

export function assertReasonCodeMembership(value, context, path) {
  assertEmbeddedRegistryIntegrity();
  assertEnum(context, CONTEXTS, `${path}.context`);
  const entry = ENTRIES.find((candidate) => candidate.code === value);
  if (entry === undefined) throw new TypeError(`${path} is not registered in ${PAYLOAD.registryId}`);
  if (!entry.allowedContexts.includes(context)) {
    throw new TypeError(`${path} is not registered for ${context}`);
  }
}

export function validateReasonCodeRegistrySnapshot(snapshot) {
  assertClosedRecord(snapshot, 'reasonRegistry', [
    'schemaVersion', 'registryId', 'registryRevision', 'registrySha256', 'entries',
  ]);
  assertEnum(snapshot.schemaVersion, [PAYLOAD.schemaVersion], 'reasonRegistry.schemaVersion');
  assertEnum(snapshot.registryId, [PAYLOAD.registryId], 'reasonRegistry.registryId');
  assertSafeInteger(snapshot.registryRevision, 'reasonRegistry.registryRevision', 1, 1_000_000);
  if (snapshot.registryRevision !== PAYLOAD.registryRevision) throw new TypeError('reasonRegistry.registryRevision mismatch');
  assertSha256(snapshot.registrySha256, 'reasonRegistry.registrySha256');
  assertArray(snapshot.entries, 'reasonRegistry.entries', 128);
  if (snapshot.entries.length === 0) throw new TypeError('reasonRegistry.entries must not be empty');
  snapshot.entries.forEach((entry, index) => {
    const path = `reasonRegistry.entries[${index}]`;
    assertClosedRecord(entry, path, ['code', 'allowedContexts']);
    assertIdentifier(entry.code, `${path}.code`);
    assertArray(entry.allowedContexts, `${path}.allowedContexts`, 2);
    if (entry.allowedContexts.length === 0) throw new TypeError(`${path}.allowedContexts must not be empty`);
    entry.allowedContexts.forEach((context, child) => assertEnum(context, CONTEXTS, `${path}.allowedContexts[${child}]`));
    assertUnique(entry.allowedContexts, (context) => context, `${path}.allowedContexts`);
  });
  assertUnique(snapshot.entries, (entry) => entry.code, 'reasonRegistry.entries');
  const derived = sha256CanonicalJsonExcluding(snapshot, 'registrySha256');
  if (derived !== snapshot.registrySha256 || derived !== REASON_CODE_REGISTRY_SHA256) {
    throw new TypeError('reasonRegistry canonical digest mismatch');
  }
  if (canonicalJson(snapshot.entries) !== canonicalJson(ENTRIES)) {
    throw new TypeError('reasonRegistry entries do not match the bound packet vocabulary');
  }
  return reasonCodeRegistryMetadata();
}
