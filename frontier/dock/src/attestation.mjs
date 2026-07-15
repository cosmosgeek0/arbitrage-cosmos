import { verify as verifySignature } from 'node:crypto';

import {
  cloneCanonical,
  contractError,
  deepFreeze,
  hashRecord,
  sha256,
} from './canonical.mjs';
import {
  DESCRIPTOR_CANONICALIZATION_ID,
  EXTENSION_ATTESTATION_V1_FIELDS,
  HASH_ALGORITHM,
} from './constants.mjs';
import {
  descriptorHashFor,
  validateExtensionDescriptor,
} from './records.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

function requireFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('ATTESTATION_INVALID', 'ExtensionAttestationV1 must be an object');
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) fail('ATTESTATION_FIELD_MISSING', `ExtensionAttestationV1.${field} is required`);
  }
}

function boundedString(value, name, maximum = 2_048) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) fail('ATTESTATION_STRING_INVALID', `${name} is invalid`);
}

export function validateExtensionAttestation(input) {
  requireFields(input, EXTENSION_ATTESTATION_V1_FIELDS);
  for (const field of [
    'descriptorCanonicalizationId',
    'descriptorHashAlgorithm',
    'descriptorHash',
    'signatureAlgorithm',
    'signerKeyId',
    'trustPolicyRef',
    'revocationRef',
    'signature',
    'attestationHash',
  ]) boundedString(input[field], `ExtensionAttestationV1.${field}`);
  if (input.descriptorCanonicalizationId !== DESCRIPTOR_CANONICALIZATION_ID) fail('CANONICALIZATION_ID_UNSUPPORTED', 'descriptor canonicalization is unsupported');
  if (input.descriptorHashAlgorithm !== HASH_ALGORITHM) fail('HASH_ALGORITHM_UNSUPPORTED', 'descriptor hash algorithm is unsupported');
  if (input.signatureAlgorithm !== 'ED25519') fail('SIGNATURE_ALGORITHM_UNSUPPORTED', 'only fixture Ed25519 verification is supported');
  if (!/^[a-f0-9]{64}$/.test(input.descriptorHash) || !/^[a-f0-9]{64}$/.test(input.attestationHash)) fail('ATTESTATION_HASH_INVALID', 'attestation hashes must be lowercase SHA-256');
  if (!Number.isSafeInteger(input.issuedAt) || !Number.isSafeInteger(input.expiresAt) || input.issuedAt < 0 || input.expiresAt <= input.issuedAt) {
    fail('ATTESTATION_TIME_INVALID', 'attestation issue and expiry times are invalid');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.signature)) fail('SIGNATURE_ENCODING_INVALID', 'attestation signature must be base64');
  if (input.attestationHash !== hashRecord(input, 'attestationHash')) fail('ATTESTATION_HASH_MISMATCH', 'attestationHash does not match canonical attestation bytes');
  return true;
}

export function createExtensionAttestation({
  descriptor,
  signerKeyId,
  trustPolicyRef,
  issuedAt,
  expiresAt,
  revocationRef,
  sign,
}) {
  validateExtensionDescriptor(descriptor);
  if (typeof sign !== 'function') fail('SIGNER_REQUIRED', 'an injected fixture signer is required');
  const descriptorHash = descriptorHashFor(descriptor);
  const signature = sign(Buffer.from(descriptorHash, 'utf8'));
  if (!(Buffer.isBuffer(signature) || signature instanceof Uint8Array)) fail('SIGNER_OUTPUT_INVALID', 'fixture signer must return bytes');
  const attestation = {
    descriptorCanonicalizationId: DESCRIPTOR_CANONICALIZATION_ID,
    descriptorHashAlgorithm: HASH_ALGORITHM,
    descriptorHash,
    signatureAlgorithm: 'ED25519',
    signerKeyId,
    trustPolicyRef,
    issuedAt,
    expiresAt,
    revocationRef,
    signature: Buffer.from(signature).toString('base64'),
  };
  attestation.attestationHash = hashRecord(attestation, 'attestationHash');
  validateExtensionAttestation(attestation);
  return deepFreeze(cloneCanonical(attestation));
}

export function verifyExtensionAttestation({ descriptor, attestation, trustPolicy, nowMs }) {
  validateExtensionDescriptor(descriptor);
  validateExtensionAttestation(attestation);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail('VERIFICATION_TIME_INVALID', 'verification time must be injected UTC milliseconds');
  if (descriptorHashFor(descriptor) !== attestation.descriptorHash) fail('DESCRIPTOR_TAMPERED', 'descriptor bytes do not match the attested hash');
  if (trustPolicy === null || typeof trustPolicy !== 'object' || Array.isArray(trustPolicy)) fail('TRUST_POLICY_INVALID', 'fixture trust policy is required');
  if (trustPolicy.policyRef !== attestation.trustPolicyRef) fail('TRUST_POLICY_MISMATCH', 'attestation trust policy reference is not accepted');
  if (!Array.isArray(trustPolicy.permittedAlgorithms) || !trustPolicy.permittedAlgorithms.includes(attestation.signatureAlgorithm)) {
    fail('SIGNATURE_ALGORITHM_DENIED', 'attestation signature algorithm is denied');
  }
  if (nowMs < attestation.issuedAt) fail('ATTESTATION_NOT_YET_VALID', 'attestation is not yet valid');
  if (nowMs >= attestation.expiresAt) fail('ATTESTATION_EXPIRED', 'attestation has expired');
  if ((trustPolicy.revokedKeyIds ?? []).includes(attestation.signerKeyId) || (trustPolicy.revokedRefs ?? []).includes(attestation.revocationRef)) {
    fail('ATTESTATION_REVOKED', 'attestation or signer has been revoked');
  }
  const key = trustPolicy.keys?.[attestation.signerKeyId];
  if (!key) fail('SIGNER_NOT_TRUSTED', 'attestation signer is not in the fixture trust policy');
  const valid = verifySignature(
    null,
    Buffer.from(attestation.descriptorHash, 'utf8'),
    key,
    Buffer.from(attestation.signature, 'base64'),
  );
  if (!valid) fail('SIGNATURE_INVALID', 'attestation signature validation failed');
  return deepFreeze({
    ok: true,
    descriptorHash: attestation.descriptorHash,
    attestationHash: attestation.attestationHash,
    signerKeyId: attestation.signerKeyId,
    trustMode: 'FIXTURE_KEYS_ONLY',
    productionTrustProven: false,
  });
}
