#!/usr/bin/env node
import { createPublicKey, verify } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, isFullSha, isUtc, sha256File } from '../lib.mjs';

export const BUILD_ATTESTATION_TYPE = 'I00_PRODUCTION_BUILD_V1';
export const REQUIRED_BUILD_COMMANDS = Object.freeze([
  Object.freeze({ command: 'npm test', exitCode: 0 }),
  Object.freeze({ command: 'npm run test:all', exitCode: 0 }),
  Object.freeze({ command: 'bash ops/tests/i00/run-all.sh', exitCode: 0 }),
]);

const ATTESTATION_KEYS = Object.freeze([
  'schemaVersion', 'attestationType', 'testedSha', 'sourceTree',
  'testedReceiptSha256', 'packageLockSha256', 'runtimeDepsDigestSha256',
  'serverDistDigestSha256', 'webDistDigestSha256', 'requiredCommands',
  'testsCompletedAtUtc', 'buildCompletedAtUtc', 'builderIdentity',
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has an unexpected field set`);
  }
}

function regularBoundedFile(path, maximumBytes, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  if (stat.size === 0 || stat.size > maximumBytes) fail(`${label} has an invalid size`);
}

export function assertTrustedBuildPublicKey({ embeddedPublicKeyPath, trustedPublicKeyPath }) {
  const embedded = resolve(embeddedPublicKeyPath);
  const trusted = resolve(trustedPublicKeyPath);
  regularBoundedFile(embedded, 16 * 1024, 'embedded build attestation public key');
  regularBoundedFile(trusted, 16 * 1024, 'trusted build attestation public key');
  if (sha256File(embedded) !== sha256File(trusted)) {
    fail('embedded build attestation public key does not match the externally trusted key');
  }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMeasuredUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function expectedBuildAttestation({
  testedSha,
  sourceTree,
  testedReceiptSha256,
  packageLockSha256,
  runtimeDepsDigestSha256,
  serverDistDigestSha256,
  webDistDigestSha256,
  testsCompletedAtUtc,
  buildCompletedAtUtc,
  builderIdentity,
}) {
  return {
    schemaVersion: 1,
    attestationType: BUILD_ATTESTATION_TYPE,
    testedSha,
    sourceTree,
    testedReceiptSha256,
    packageLockSha256,
    runtimeDepsDigestSha256,
    serverDistDigestSha256,
    webDistDigestSha256,
    // F-116: requiredCommands is signed but built from this local constant -
    // it records what SHOULD have run, not what did. The artifact that
    // actually proves command execution is the tested receipt
    // (testedReceiptSha256 above), which binds the recorded test run.
    requiredCommands: REQUIRED_BUILD_COMMANDS.map((entry) => ({ ...entry })),
    testsCompletedAtUtc,
    buildCompletedAtUtc,
    builderIdentity,
  };
}

export function verifyBuildAttestation({
  attestationPath,
  signaturePath,
  publicKeyPath,
  expected,
}) {
  const attestationFile = resolve(attestationPath);
  const signatureFile = resolve(signaturePath);
  const publicKeyFile = resolve(publicKeyPath);
  regularBoundedFile(attestationFile, 64 * 1024, 'build attestation');
  regularBoundedFile(signatureFile, 1024, 'build attestation signature');
  regularBoundedFile(publicKeyFile, 16 * 1024, 'build attestation public key');

  const attestationBytes = readFileSync(attestationFile);
  let attestation;
  try {
    attestation = JSON.parse(attestationBytes.toString('utf8'));
  } catch (error) {
    fail(`build attestation is not valid JSON: ${error.message}`);
  }
  exactKeys(attestation, ATTESTATION_KEYS, 'build attestation');
  if (attestationBytes.toString('utf8') !== `${JSON.stringify(attestation, null, 2)}\n`) {
    fail('build attestation must use canonical indented JSON with one trailing newline');
  }
  if (attestation.schemaVersion !== 1 || attestation.attestationType !== BUILD_ATTESTATION_TYPE) {
    fail('build attestation schema/type is invalid');
  }
  if (!isFullSha(attestation.testedSha) || !isFullSha(attestation.sourceTree)) {
    fail('build attestation Git identities are invalid');
  }
  for (const field of [
    'testedReceiptSha256', 'packageLockSha256', 'runtimeDepsDigestSha256',
    'serverDistDigestSha256', 'webDistDigestSha256',
  ]) {
    if (!SHA256_PATTERN.test(attestation[field])) fail(`build attestation ${field} is invalid`);
  }
  if (!equalJson(attestation.requiredCommands, REQUIRED_BUILD_COMMANDS)) {
    fail('build attestation requiredCommands must be the exact ordered successful command set');
  }
  if (!isMeasuredUtc(attestation.testsCompletedAtUtc) || !isUtc(attestation.buildCompletedAtUtc)
      || Date.parse(attestation.testsCompletedAtUtc) > Date.parse(attestation.buildCompletedAtUtc)) {
    fail('build attestation UTC chronology is invalid');
  }
  if (typeof attestation.builderIdentity !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,255}$/.test(attestation.builderIdentity)
      || /(?:PLACEHOLDER|REPLACE|UNKNOWN|UNAVAILABLE|TBD)/i.test(attestation.builderIdentity)) {
    fail('build attestation builderIdentity is invalid or unresolved');
  }
  if (!expected || !equalJson(attestation, expected)) {
    fail('build attestation does not exactly bind the tested release inputs');
  }

  const publicKeyPem = readFileSync(publicKeyFile, 'utf8');
  if (publicKeyPem.includes('PRIVATE KEY')) fail('build attestation key must not contain private key material');
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch (error) {
    fail(`build attestation public key is invalid: ${error.message}`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') fail('build attestation public key must be Ed25519');
  const canonicalPublicKey = publicKey.export({ type: 'spki', format: 'pem' });
  if (publicKeyPem !== canonicalPublicKey) fail('build attestation public key must be canonical SPKI PEM');

  const signatureText = readFileSync(signatureFile, 'utf8');
  const signatureBase64 = signatureText.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64) || signatureText !== `${signatureBase64}\n`) {
    fail('build attestation signature must be canonical base64 with one trailing newline');
  }
  const signature = Buffer.from(signatureBase64, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== signatureBase64) {
    fail('build attestation signature is not a canonical Ed25519 signature');
  }
  if (!verify(null, attestationBytes, publicKey, signature)) {
    fail('build attestation Ed25519 signature verification failed');
  }

  return {
    status: 'VERIFIED_ED25519',
    algorithm: 'Ed25519',
    builderIdentity: attestation.builderIdentity,
    attestationSha256: sha256File(attestationFile),
    signatureSha256: sha256File(signatureFile),
    publicKeySha256: sha256File(publicKeyFile),
  };
}
