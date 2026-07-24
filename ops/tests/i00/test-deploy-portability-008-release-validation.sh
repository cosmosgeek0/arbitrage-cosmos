#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
I00_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../../i00" && pwd -P)"

node --input-type=module - \
  "$I00_ROOT/bin/verify-build-attestation.mjs" \
  "$I00_ROOT/bin/validate-release.mjs" <<'NODE'
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const verifierPath = process.argv[2];
const validatorPath = process.argv[3];
const {
  assertTrustedBuildPublicKey,
  expectedBuildAttestation,
  verifyBuildAttestation,
} = await import(pathToFileURL(verifierPath));

let assertions = 0;

function assert(condition, label) {
  if (!condition) throw new Error(label);
  assertions += 1;
}

function assertReject(operation, label) {
  let rejected = false;
  const originalExit = process.exit;
  const originalStderrWrite = process.stderr.write;
  process.exit = (code) => {
    throw new Error(`EXPECTED_EXIT_${code}`);
  };
  process.stderr.write = () => true;
  try {
    operation();
  } catch {
    rejected = true;
  } finally {
    process.exit = originalExit;
    process.stderr.write = originalStderrWrite;
  }
  assert(rejected, label);
}

const temporaryRoot = fs.realpathSync(fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), 'df32-release-validation-'),
));

function writePrivate(pathname, bytes) {
  fs.writeFileSync(pathname, bytes, { mode: 0o600 });
  fs.chmodSync(pathname, 0o600);
}

function makeFixture(name) {
  const root = path.join(temporaryRoot, name);
  fs.mkdirSync(root, { mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const expected = expectedBuildAttestation({
    testedSha: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    testedReceiptSha256: '1'.repeat(64),
    packageLockSha256: '2'.repeat(64),
    runtimeDepsDigestSha256: '3'.repeat(64),
    serverDistDigestSha256: '4'.repeat(64),
    webDistDigestSha256: '5'.repeat(64),
    testsCompletedAtUtc: '2026-07-23T10:00:00Z',
    buildCompletedAtUtc: '2026-07-23T10:01:00Z',
    builderIdentity: 'df32-linux-builder',
  });
  const attestationBytes = Buffer.from(`${JSON.stringify(expected, null, 2)}\n`);
  const signatureBytes = Buffer.from(
    `${sign(null, attestationBytes, privateKey).toString('base64')}\n`,
  );
  const paths = {
    attestationPath: path.join(root, 'build-attestation.json'),
    signaturePath: path.join(root, 'build-attestation.sig'),
    publicKeyPath: path.join(root, 'embedded-public.pem'),
    trustedPublicKeyPath: path.join(root, 'external-trusted-public.pem'),
  };
  writePrivate(paths.attestationPath, attestationBytes);
  writePrivate(paths.signaturePath, signatureBytes);
  writePrivate(paths.publicKeyPath, publicKeyPem);
  writePrivate(paths.trustedPublicKeyPath, publicKeyPem);
  return {
    root,
    expected,
    paths,
    bytes: {
      attestationPath: attestationBytes,
      signaturePath: signatureBytes,
      publicKeyPath: Buffer.from(publicKeyPem),
      trustedPublicKeyPath: Buffer.from(publicKeyPem),
    },
  };
}

function verifyFixture(fixture, overrides = {}) {
  return verifyBuildAttestation({
    ...fixture.paths,
    ...overrides,
    expected: fixture.expected,
  });
}

try {
  const positive = makeFixture('positive');
  const verified = verifyFixture(positive);
  assert(verified.status === 'VERIFIED_ED25519', 'valid attestation was rejected');
  assert(
    verifyBuildAttestation({
      attestationPath: positive.paths.attestationPath,
      signaturePath: positive.paths.signaturePath,
      publicKeyPath: positive.paths.publicKeyPath,
      expected: positive.expected,
    }).status === 'VERIFIED_ED25519',
    'assembly attestation verification without an external trust argument failed',
  );
  assert(
    verified.attestationSha256
      === createHash('sha256').update(positive.bytes.attestationPath).digest('hex'),
    'attestation digest did not come from verified descriptor bytes',
  );
  assert(
    verified.signatureSha256
      === createHash('sha256').update(positive.bytes.signaturePath).digest('hex'),
    'signature digest did not come from verified descriptor bytes',
  );
  assert(
    verified.publicKeySha256
      === createHash('sha256').update(positive.bytes.publicKeyPath).digest('hex'),
    'public-key digest did not come from verified descriptor bytes',
  );
  const trust = assertTrustedBuildPublicKey({
    embeddedPublicKeyPath: positive.paths.publicKeyPath,
    trustedPublicKeyPath: positive.paths.trustedPublicKeyPath,
  });
  assert(
    trust.embeddedPublicKeySha256 === trust.trustedPublicKeySha256,
    'trusted-key descriptor digests differ',
  );
  assertReject(
    () => verifyBuildAttestation({
      ...positive.paths,
      trustedPublicKeyPath: positive.paths.publicKeyPath,
      expected: positive.expected,
    }),
    'embedded key was accepted as external trust',
  );

  for (const field of [
    'attestationPath',
    'signaturePath',
    'publicKeyPath',
    'trustedPublicKeyPath',
  ]) {
    const fixture = makeFixture(`alias-${field}`);
    const real = `${fixture.paths[field]}.real`;
    fs.renameSync(fixture.paths[field], real);
    fs.symlinkSync(real, fixture.paths[field]);
    assertReject(
      () => verifyFixture(fixture),
      `${field} symlink alias was accepted`,
    );
  }

  const parentAlias = makeFixture('parent-alias');
  const aliasRoot = path.join(temporaryRoot, 'parent-alias-link');
  fs.symlinkSync(parentAlias.root, aliasRoot, 'dir');
  assertReject(
    () => verifyFixture(parentAlias, {
      trustedPublicKeyPath: path.join(aliasRoot, 'external-trusted-public.pem'),
    }),
    'trusted-key ancestor alias was accepted',
  );

  const originalOpenSync = fs.openSync;
  for (const field of [
    'attestationPath',
    'signaturePath',
    'publicKeyPath',
    'trustedPublicKeyPath',
  ]) {
    const fixture = makeFixture(`swap-${field}`);
    const target = fixture.paths[field];
    const parked = `${target}.parked`;
    const rogue = `${target}.rogue`;
    writePrivate(rogue, Buffer.from('hostile replacement\n'));
    let swapped = false;
    fs.openSync = function swapBeforeDescriptorOpen(pathname, ...rest) {
      if (pathname === target && !swapped) {
        swapped = true;
        fs.renameSync(target, parked);
        fs.renameSync(rogue, target);
        const descriptor = originalOpenSync.call(fs, pathname, ...rest);
        fs.renameSync(target, rogue);
        fs.renameSync(parked, target);
        return descriptor;
      }
      return originalOpenSync.call(fs, pathname, ...rest);
    };
    syncBuiltinESMExports();
    try {
      assertReject(
        () => verifyFixture(fixture),
        `${field} pathname swap was accepted`,
      );
      assert(swapped, `${field} swap hook was not exercised`);
    } finally {
      fs.openSync = originalOpenSync;
      syncBuiltinESMExports();
    }
  }

  const validatorSource = fs.readFileSync(validatorPath, 'utf8');
  assert(
    !validatorSource.includes('process.env.I00_TRUSTED_BUILD_PUBLIC_KEY'),
    'ambient trusted-key selection remains in validate-release',
  );
  assert(
    validatorSource.includes("args['trusted-build-public-key']"),
    'explicit trusted-key argument is not required by validate-release',
  );

  process.stdout.write(`OK (${assertions} assertions)\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
NODE
