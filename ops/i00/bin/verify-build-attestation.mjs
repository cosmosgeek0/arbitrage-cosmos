#!/usr/bin/env node
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fail, isFullSha, isUtc } from '../lib.mjs';

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

function exactCanonicalFilePath(path, label) {
  if (typeof path !== 'string' || path === '/' || !isAbsolute(path)
      || resolve(path) !== path || /[\u0000-\u001f\u007f]/u.test(path)) {
    fail(`${label} path must be one absolute lexical canonical path`);
  }
  return path;
}

function regularFileIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    links: stat.nlink.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  });
}

function sameRegularFileIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.links === right.links
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function inspectNamedRegularFile(path, maximumBytes, label) {
  const absolute = exactCanonicalFilePath(path, label);
  let stat;
  try {
    stat = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
    fail(`${label} must be one regular non-symlink file with exactly one link`);
  }
  if (stat.size === 0n || stat.size > BigInt(maximumBytes)) {
    fail(`${label} has an invalid size`);
  }
  let physical;
  try {
    physical = realpathSync.native(absolute);
  } catch (error) {
    fail(`${label} cannot be physically canonicalized: ${error.message}`);
  }
  if (physical !== absolute) {
    fail(`${label} path or one of its ancestors is not physically canonical`);
  }
  return Object.freeze({
    absolute,
    identity: regularFileIdentity(stat),
  });
}

function openStableBoundedFile(path, maximumBytes, label) {
  const namedBefore = inspectNamedRegularFile(path, maximumBytes, label);
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    fail(`${label} cannot be opened with mandatory no-follow semantics`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      namedBefore.absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || openedBefore.isSymbolicLink()
        || openedBefore.nlink !== 1n
        || !sameRegularFileIdentity(
          regularFileIdentity(openedBefore),
          namedBefore.identity,
        )) {
      fail(`${label} identity changed before descriptor read`);
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    if (!sameRegularFileIdentity(
      regularFileIdentity(openedAfter),
      namedBefore.identity,
    ) || BigInt(bytes.length) !== openedAfter.size) {
      fail(`${label} identity changed during descriptor read`);
    }
    const namedAfter = inspectNamedRegularFile(
      namedBefore.absolute,
      maximumBytes,
      label,
    );
    if (!sameRegularFileIdentity(namedAfter.identity, namedBefore.identity)) {
      fail(`${label} named identity changed during descriptor read`);
    }
    return Object.freeze({
      absolute: namedBefore.absolute,
      descriptor,
      identity: namedBefore.identity,
      maximumBytes,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof Error && error.message.startsWith(`${label} `)) {
      throw error;
    }
    fail(`${label} stable no-follow read failed: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

function recheckStableOpenFile(evidence, label) {
  const openedAfterUse = fstatSync(evidence.descriptor, { bigint: true });
  if (!sameRegularFileIdentity(
    regularFileIdentity(openedAfterUse),
    evidence.identity,
  )) {
    fail(`${label} descriptor identity changed before verification completed`);
  }
  const namedAfterUse = inspectNamedRegularFile(
    evidence.absolute,
    evidence.maximumBytes,
    label,
  );
  if (!sameRegularFileIdentity(namedAfterUse.identity, evidence.identity)) {
    fail(`${label} named identity changed before verification completed`);
  }
}

function closeStableOpenFiles(evidence) {
  for (const item of [...evidence].reverse()) {
    if (item !== undefined) closeSync(item.descriptor);
  }
}

export function assertTrustedBuildPublicKey({
  embeddedPublicKeyPath,
  trustedPublicKeyPath,
}) {
  const opened = [];
  try {
    const embedded = openStableBoundedFile(
      embeddedPublicKeyPath,
      16 * 1024,
      'embedded build attestation public key',
    );
    opened.push(embedded);
    const trusted = openStableBoundedFile(
      trustedPublicKeyPath,
      16 * 1024,
      'trusted build attestation public key',
    );
    opened.push(trusted);
    if (embedded.absolute === trusted.absolute
        || sameRegularFileIdentity(embedded.identity, trusted.identity)) {
      fail('externally trusted build key must be distinct from the embedded key');
    }
    if (!embedded.bytes.equals(trusted.bytes)) {
      fail('embedded build attestation public key does not match the externally trusted key');
    }
    recheckStableOpenFile(embedded, 'embedded build attestation public key');
    recheckStableOpenFile(trusted, 'trusted build attestation public key');
    return Object.freeze({
      embeddedPublicKeySha256: embedded.sha256,
      trustedPublicKeySha256: trusted.sha256,
    });
  } finally {
    closeStableOpenFiles(opened);
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
  trustedPublicKeyPath,
  expected,
}) {
  const opened = [];
  try {
    const attestationFile = openStableBoundedFile(
      attestationPath,
      64 * 1024,
      'build attestation',
    );
    opened.push(attestationFile);
    const signatureFile = openStableBoundedFile(
      signaturePath,
      1024,
      'build attestation signature',
    );
    opened.push(signatureFile);
    const publicKeyFile = openStableBoundedFile(
      publicKeyPath,
      16 * 1024,
      'build attestation public key',
    );
    opened.push(publicKeyFile);
    let trustedPublicKeyFile;
    if (trustedPublicKeyPath !== undefined) {
      trustedPublicKeyFile = openStableBoundedFile(
        trustedPublicKeyPath,
        16 * 1024,
        'trusted build attestation public key',
      );
      opened.push(trustedPublicKeyFile);
      if (publicKeyFile.absolute === trustedPublicKeyFile.absolute
          || sameRegularFileIdentity(
            publicKeyFile.identity,
            trustedPublicKeyFile.identity,
          )) {
        fail('externally trusted build key must be distinct from the embedded key');
      }
      if (!publicKeyFile.bytes.equals(trustedPublicKeyFile.bytes)) {
        fail('embedded build attestation public key does not match the externally trusted key');
      }
    }

    const attestationBytes = attestationFile.bytes;
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

    const publicKeyPem = publicKeyFile.bytes.toString('utf8');
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

    const signatureText = signatureFile.bytes.toString('utf8');
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

    recheckStableOpenFile(attestationFile, 'build attestation');
    recheckStableOpenFile(signatureFile, 'build attestation signature');
    recheckStableOpenFile(publicKeyFile, 'build attestation public key');
    if (trustedPublicKeyFile !== undefined) {
      recheckStableOpenFile(
        trustedPublicKeyFile,
        'trusted build attestation public key',
      );
    }
    return {
      status: 'VERIFIED_ED25519',
      algorithm: 'Ed25519',
      builderIdentity: attestation.builderIdentity,
      attestationSha256: attestationFile.sha256,
      signatureSha256: signatureFile.sha256,
      publicKeySha256: publicKeyFile.sha256,
    };
  } finally {
    closeStableOpenFiles(opened);
  }
}
