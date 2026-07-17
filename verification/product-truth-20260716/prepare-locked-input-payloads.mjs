#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTHORITY_PAYLOAD_SPECS,
  EXTERNAL_INPUT_SPECS,
  externalPayloadRelativePath,
} from './campaign-input-registry.mjs';

const campaignDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(campaignDirectory, '..', '..');
const metadataPath = path.join(campaignDirectory, 'LOCKED_INPUT_PAYLOADS.json');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobOid(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function readGitObject(commit, sourcePath) {
  return execFileSync('git', ['show', `${commit}:${sourcePath}`], {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function writeAndVerifyPayload(relativePath, sourceBytes, expected) {
  const absolutePath = path.join(campaignDirectory, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, sourceBytes);

  const writtenBytes = readFileSync(absolutePath);
  assertEqual(writtenBytes.equals(sourceBytes), true, `${relativePath} byte equality`);
  assertEqual(writtenBytes.length, expected.byteLength, `${relativePath} byte length`);
  assertEqual(sha256(writtenBytes), expected.sha256, `${relativePath} sha256`);
  assertEqual(gitBlobOid(writtenBytes), expected.gitBlob, `${relativePath} Git blob OID`);

  return writtenBytes;
}

function externalDisposition(spec) {
  if (spec.inputClass === 'SUPERSEDED_EXTERNAL') {
    return 'RETAINED_SUPERSEDED_PROVENANCE';
  }
  if (spec.authority === 'REFERENCE_ONLY') {
    return 'RETAINED_REFERENCE_ONLY';
  }
  if (spec.authority === 'ORCHESTRATION_ONLY') {
    return 'RETAINED_ORCHESTRATION_CONTEXT';
  }
  return 'ADMITTED_CONTROLLING_INPUT';
}

const payloadFrames = [];

const members = EXTERNAL_INPUT_SPECS.map((spec, index) => {
  const sourceBytes = readFileSync(spec.originalPath);
  const sourceSha256 = sha256(sourceBytes);
  const sourceGitBlob = gitBlobOid(sourceBytes);
  const payloadPath = externalPayloadRelativePath(spec, index);

  assertEqual(sourceSha256, spec.expectedSha256, `${spec.inputId} source sha256`);

  const writtenBytes = writeAndVerifyPayload(payloadPath, sourceBytes, {
    byteLength: sourceBytes.length,
    sha256: sourceSha256,
    gitBlob: sourceGitBlob,
  });

  payloadFrames.push(
    Buffer.concat([
      Buffer.from(`${spec.inputId}\0${writtenBytes.length}\0`, 'utf8'),
      writtenBytes,
    ]),
  );

  return {
    member_id: spec.inputId,
    input_id: spec.inputId,
    legacy_id: spec.legacyId,
    input_class: spec.inputClass,
    authority: spec.authority,
    original_path: spec.originalPath,
    payload_relative_path: payloadPath,
    byte_length: writtenBytes.length,
    sha256: sourceSha256,
    git_blob: sourceGitBlob,
    expected_sha256: spec.expectedSha256,
    disposition: externalDisposition(spec),
    ...(spec.supersededBy ? { superseded_by: spec.supersededBy } : {}),
    source: {
      kind: 'OWNER_LOCAL_FILE_CAPTURE',
      path: spec.originalPath,
    },
  };
});

const authorityMembers = AUTHORITY_PAYLOAD_SPECS.map((spec) => {
  const sourceBytes = readGitObject(spec.sourceCommit, spec.sourcePath);
  const sourceSha256 = sha256(sourceBytes);
  const sourceGitBlob = gitBlobOid(sourceBytes);

  assertEqual(sourceBytes.length, spec.expectedByteLength, `${spec.memberId} source byte length`);
  assertEqual(sourceSha256, spec.expectedSha256, `${spec.memberId} source sha256`);
  assertEqual(sourceGitBlob, spec.expectedGitBlob, `${spec.memberId} source Git blob OID`);

  const writtenBytes = writeAndVerifyPayload(spec.payloadRelativePath, sourceBytes, {
    byteLength: spec.expectedByteLength,
    sha256: spec.expectedSha256,
    gitBlob: spec.expectedGitBlob,
  });

  payloadFrames.push(
    Buffer.concat([
      Buffer.from(`${spec.memberId}\0${writtenBytes.length}\0`, 'utf8'),
      writtenBytes,
    ]),
  );

  return {
    member_id: spec.memberId,
    source_commit: spec.sourceCommit,
    source_path: spec.sourcePath,
    payload_relative_path: spec.payloadRelativePath,
    byte_length: writtenBytes.length,
    sha256: sourceSha256,
    git_blob: sourceGitBlob,
    expected_byte_length: spec.expectedByteLength,
    expected_sha256: spec.expectedSha256,
    expected_git_blob: spec.expectedGitBlob,
    disposition: 'BOUND_IMMUTABLE_AUTHORITY',
    source: {
      kind: 'IMMUTABLE_GIT_OBJECT',
      revision: `${spec.sourceCommit}:${spec.sourcePath}`,
    },
  };
});

const inventory = {
  members,
  authority_members: authorityMembers,
};

const metadata = {
  schema_version: 'locked-input-payloads/v1',
  preparation_state: 'SOURCE_PREPARED',
  truth_class: 'REHASHABLE_PAYLOAD_BYTES',
  candidate: null,
  generated_by: 'verification/product-truth-20260716/prepare-locked-input-payloads.mjs',
  totals: {
    external_input_members: members.length,
    authority_members: authorityMembers.length,
    payload_files: members.length + authorityMembers.length,
    byte_length:
      members.reduce((sum, member) => sum + member.byte_length, 0) +
      authorityMembers.reduce((sum, member) => sum + member.byte_length, 0),
  },
  inventory_sha256: sha256(Buffer.from(canonicalJson(inventory), 'utf8')),
  payload_set_sha256: sha256(Buffer.concat(payloadFrames)),
  ...inventory,
};

assertEqual(members.length, 23, 'external payload member count');
assertEqual(authorityMembers.length, 2, 'authority payload member count');
assertEqual(metadata.totals.payload_files, 25, 'total payload file count');

writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

const persistedMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
assertEqual(persistedMetadata.members.length, 23, 'persisted external payload member count');
assertEqual(persistedMetadata.authority_members.length, 2, 'persisted authority payload member count');
assertEqual(persistedMetadata.inventory_sha256, metadata.inventory_sha256, 'persisted inventory sha256');
assertEqual(persistedMetadata.payload_set_sha256, metadata.payload_set_sha256, 'persisted payload-set sha256');

process.stdout.write(
  `${JSON.stringify({
    result: 'SOURCE_PAYLOADS_PREPARED',
    external_payloads: members.length,
    authority_payloads: authorityMembers.length,
    total_payload_files: metadata.totals.payload_files,
    total_payload_bytes: metadata.totals.byte_length,
    inventory_sha256: metadata.inventory_sha256,
    payload_set_sha256: metadata.payload_set_sha256,
    metadata: path.relative(repositoryRoot, metadataPath),
  })}\n`,
);
