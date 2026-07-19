#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EXACT_C9_CANDIDATE,
  EXACT_C9_TREE,
  EXACT_EVIDENCE_DESCENDANT_FILES,
  EXACT_EVIDENCE_OUTPUTS,
  EXACT_EVIDENCE_TOOLING_FILES,
  HISTORICAL_PAYLOAD_COMMIT_SPECS,
  REJECTED_CANDIDATE_SHAS,
  REQUIRED_C2_PARENT,
  SEALED_C9_SOURCE_PATHS,
  SEALED_GIT_OBJECT_PAYLOAD_BUNDLE_SHA256,
} from './campaign-input-registry.mjs';

const REJECTED_PREDECESSOR = '41752d6a87dc1cb1b933bb4460c9cabfc15ff694';
const REJECTED_PREDECESSOR_TREE = 'a770f9f393e6229252731cd5247e9a1abfd2e509';
const CAMPAIGN_RELATIVE_ROOT = 'verification/product-truth-20260716';
const EXACT_EVIDENCE_PATHS = Object.freeze(EXACT_EVIDENCE_DESCENDANT_FILES.map(
  (name) => `${CAMPAIGN_RELATIVE_ROOT}/${name}`,
));
const MANIFEST_JSON = 'MANIFEST.json';
const MANIFEST_SHA256 = 'MANIFEST.sha256';
const REQUIRED_MATRIX_COUNTS = Object.freeze({
  'DIRECTIVE_COVERAGE_MATRIX.csv': 153,
  'CAPABILITY_TRUTH_MATRIX.csv': 23,
  'COCKPIT_BINDING_MATRIX.csv': 178,
});
const EXACT_AUTHORITY_FILES = Object.freeze([
  'AI_OPS_C2_DISPOSITION.json',
  'INPUTS.lock',
  'DIRECTIVE_COVERAGE_MATRIX.csv',
  'CAPABILITY_TRUTH_MATRIX.csv',
  'COCKPIT_BINDING_MATRIX.csv',
  'C2_PROOF_BINDING.json',
  'EVIDENCE_SELECTION.json',
  'INDEPENDENT_FINDINGS.json',
  'LOCKED_INPUT_PAYLOADS.json',
  'MERGE_PROVENANCE.json',
  'PRODUCT_ASSURANCE_C2_DISPOSITION.json',
  'STATE.md',
  'WORKTREE_CENSUS.json',
]);
const BANNED_EXACT_EVIDENCE = Object.freeze([
  REJECTED_PREDECESSOR,
  REJECTED_PREDECESSOR_TREE,
  'SELF_COMMIT_UNBOUND',
  'SOURCE_COMMIT_CANNOT_SELF_NAME',
  'C2_NOT_YET_FROZEN',
  'exact-C2',
  'EXACT_C2_',
]);

const candidateIndex = process.argv.indexOf('--candidate');
const candidate = candidateIndex >= 0 ? process.argv[candidateIndex + 1] : null;
const verifyOnly = process.argv.includes('--verify-only');
if (!/^[a-f0-9]{40}$/u.test(candidate ?? '')) throw new Error('EXACT_FULL_CANDIDATE_SHA_REQUIRED');

function runGit(args, { allowFailure = false, cwd = process.cwd() } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result;
}

const repo = runGit(['rev-parse', '--show-toplevel']).stdout.trim();
const campaignRoot = resolve(repo, CAMPAIGN_RELATIVE_ROOT);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
if (resolve(scriptRoot) !== campaignRoot) {
  throw new Error('MANIFEST_GENERATOR_MUST_RUN_FROM_TARGET_REPOSITORY_TOOLING');
}
const manifestJsonPath = resolve(campaignRoot, MANIFEST_JSON);
const manifestSha256Path = resolve(campaignRoot, MANIFEST_SHA256);

function git(...args) {
  return runGit(args, { cwd: repo }).stdout.trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlob(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function currentToolingBindings() {
  return EXACT_EVIDENCE_TOOLING_FILES.map((name) => {
    const bytes = readCampaignBytes(name);
    return {
      path: name,
      sha256: sha256(bytes),
      git_blob: gitBlob(bytes),
      byte_length: bytes.length,
    };
  });
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}:${JSON.stringify(actual)}:${JSON.stringify(expected)}`);
}

function readCampaignBytes(relativePath) {
  return readFileSync(resolve(campaignRoot, relativePath));
}

function readCampaignText(relativePath) {
  return readCampaignBytes(relativePath).toString('utf8');
}

function readCampaignJson(relativePath) {
  try {
    return JSON.parse(readCampaignText(relativePath));
  } catch (error) {
    throw new Error(`INVALID_JSON:${relativePath}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function sorted(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function parseCsv(text, name) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error(`MALFORMED_CSV_QUOTE:${name}`);
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error(`UNTERMINATED_CSV_QUOTE:${name}`);
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }
  if (rows.length < 2) throw new Error(`EMPTY_MATRIX:${name}`);
  return rows;
}

function assertExactMatrix(name, expectedCount) {
  const rows = parseCsv(readCampaignText(name), name);
  const header = rows[0];
  const candidateColumn = header.indexOf('candidate_sha');
  if (candidateColumn < 0) throw new Error(`MATRIX_CANDIDATE_COLUMN_MISSING:${name}`);
  if (header.lastIndexOf('candidate_sha') !== candidateColumn) {
    throw new Error(`MATRIX_CANDIDATE_COLUMN_DUPLICATED:${name}`);
  }

  const dataRows = rows.slice(1);
  assertEqual(`${name}_ROW_COUNT`, dataRows.length, expectedCount);
  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    assertEqual(`${name}_ROW_${index + 1}_COLUMN_COUNT`, row.length, header.length);
    assertEqual(`${name}_ROW_${index + 1}_CANDIDATE`, row[candidateColumn], candidate);
  }
}

assertEqual('CANDIDATE_COMMIT', git('rev-parse', `${candidate}^{commit}`), candidate);
assertEqual('EXACT_C9_CANDIDATE', candidate, EXACT_C9_CANDIDATE);
if (REJECTED_CANDIDATE_SHAS.includes(candidate)) {
  throw new Error(`REJECTED_CANDIDATE_RELABEL_ATTEMPT:${candidate}`);
}
const candidateTree = git('rev-parse', `${candidate}^{tree}`);
assertEqual('EXACT_C9_TREE', candidateTree, EXACT_C9_TREE);
const candidateCommitRow = git('rev-list', '--parents', '-n', '1', candidate).split(/\s+/u);
assertEqual('CANDIDATE_PARENT_COUNT', candidateCommitRow.length - 1, 1);
const candidateParent = candidateCommitRow[1];
assertEqual('CANDIDATE_SOLE_DIRECT_PARENT', candidateParent, REQUIRED_C2_PARENT);
if (!git('show', `${candidate}:STATE.md`).includes('| Account A correction candidate C9 |')) {
  throw new Error('C9_SOURCE_STATE_MARKER_MISSING');
}

if (runGit(['merge-base', '--is-ancestor', candidate, 'HEAD'], { allowFailure: true, cwd: repo }).status !== 0) {
  throw new Error('CANDIDATE_NOT_ANCESTOR_OF_EVIDENCE_HEAD');
}

const inputLock = readCampaignJson('INPUTS.lock');
const proof = readCampaignJson('C2_PROOF_BINDING.json');
const selection = readCampaignJson('EVIDENCE_SELECTION.json');
const lockedPayloads = readCampaignJson('LOCKED_INPUT_PAYLOADS.json');
const provenance = readCampaignJson('MERGE_PROVENANCE.json');
const census = readCampaignJson('WORKTREE_CENSUS.json');

assertEqual('INPUT_LOCK_CANDIDATE', inputLock.candidate, candidate);
assertEqual('INPUT_LOCK_TREE', inputLock.candidate_tree, candidateTree);
assertEqual('INPUT_LOCK_PARENT', inputLock.candidate_parent, candidateParent);
assertEqual('PROOF_CANDIDATE', proof.candidate_sha, candidate);
assertEqual('PROOF_TREE', proof.candidate_tree, candidateTree);
assertEqual('PROOF_PARENT', proof.candidate_parent, candidateParent);
assertEqual('SELECTION_CANDIDATE', selection.source_candidate, candidate);
assertEqual('SELECTION_TREE', selection.source_candidate_tree, candidateTree);
assertEqual('SELECTION_PARENT', selection.source_candidate_parent, candidateParent);
assertEqual('SELECTION_SCHEMA', selection.schema, 'product-truth-c9-evidence-selection.v5');
assertEqual(
  'SELECTION_POST_CANDIDATE_ALLOWLIST',
  JSON.stringify(sorted(selection.post_candidate_path_allowlist)),
  JSON.stringify(sorted(EXACT_EVIDENCE_PATHS)),
);
assertEqual('SELECTION_GENERATED_OUTPUT_COUNT', selection.exact_generated_output_count, EXACT_EVIDENCE_OUTPUTS.length);
assertEqual('SELECTION_GENERATED_OUTPUTS', JSON.stringify(selection.exact_generated_outputs), JSON.stringify(EXACT_EVIDENCE_OUTPUTS));
assertEqual('SELECTION_TOOLING_COUNT', selection.exact_tooling_file_count, EXACT_EVIDENCE_TOOLING_FILES.length);
assertEqual('SELECTION_TOOLING_FILES', JSON.stringify(selection.exact_tooling_files), JSON.stringify(EXACT_EVIDENCE_TOOLING_FILES));
assertEqual('SELECTION_DESCENDANT_PATH_COUNT', selection.exact_descendant_path_count, EXACT_EVIDENCE_DESCENDANT_FILES.length);
const toolingBindings = currentToolingBindings();
assertEqual('SELECTION_TOOLING_BINDINGS', JSON.stringify(selection.tooling_bindings), JSON.stringify(toolingBindings));
assertEqual(
  'SELECTION_TOOLING_BUNDLE_SHA256',
  selection.tooling_bundle_sha256,
  sha256(Buffer.from(canonicalJson(toolingBindings), 'utf8')),
);
assertEqual(
  'LOCKED_PAYLOAD_BUNDLE_SHA256',
  lockedPayloads.sealed_git_object_payload_bundle_sha256,
  SEALED_GIT_OBJECT_PAYLOAD_BUNDLE_SHA256,
);
assertEqual(
  'SELECTION_PAYLOAD_BUNDLE',
  JSON.stringify(selection.sealed_git_object_payload_bundle),
  JSON.stringify({
    path: `${CAMPAIGN_RELATIVE_ROOT}/LOCKED_INPUT_PAYLOADS.json`,
    sha256: SEALED_GIT_OBJECT_PAYLOAD_BUNDLE_SHA256,
    sealed_machine_evidence_files: SEALED_C9_SOURCE_PATHS.length,
    raw_historical_commit_objects: HISTORICAL_PAYLOAD_COMMIT_SPECS.length + 1,
    authority_granted: false,
  }),
);
assertEqual('PROVENANCE_CANDIDATE', provenance.candidate_sha, candidate);
assertEqual('PROVENANCE_TREE', provenance.candidate_tree_sha, candidateTree);
assertEqual('PROVENANCE_PARENT', provenance.candidate_parent_sha, candidateParent);
assertEqual('CENSUS_CANDIDATE', census.candidate_sha, candidate);
assertEqual('CENSUS_TREE', census.candidate_tree_sha, candidateTree);
if (Object.hasOwn(census, 'candidate_parent_sha')) {
  assertEqual('CENSUS_PARENT', census.candidate_parent_sha, candidateParent);
}

for (const [name, expectedCount] of Object.entries(REQUIRED_MATRIX_COUNTS)) {
  assertExactMatrix(name, expectedCount);
}

for (const name of EXACT_AUTHORITY_FILES) {
  const text = readCampaignText(name);
  for (const rejected of BANNED_EXACT_EVIDENCE) {
    if (text.includes(rejected)) throw new Error(`BANNED_EXACT_EVIDENCE:${name}:${rejected}`);
  }
}

if (verifyOnly) {
  const evidenceHead = git('rev-parse', 'HEAD^{commit}');
  const evidenceParentRow = git('rev-list', '--parents', '-n', '1', evidenceHead).split(/\s+/u);
  assertEqual('EVIDENCE_PARENT_COUNT', evidenceParentRow.length - 1, 1);
  assertEqual('EVIDENCE_SOLE_DIRECT_PARENT', evidenceParentRow[1], candidate);
  const postCandidatePaths = git('diff', '--name-only', candidate, '--')
    .split('\n')
    .filter(Boolean)
    .sort();
  const fullEvidencePaths = [...EXACT_EVIDENCE_PATHS].sort();
  if (JSON.stringify(fullEvidencePaths) !== JSON.stringify(postCandidatePaths)) {
    throw new Error(`POST_CANDIDATE_EXACT_EVIDENCE_PATHS:${JSON.stringify(postCandidatePaths)}`);
  }
}

function trackedCampaignPaths() {
  const output = runGit(
    ['ls-files', '--cached', '-z', '--', `${CAMPAIGN_RELATIVE_ROOT}/`],
    { cwd: repo },
  ).stdout;
  const excluded = new Set([
    `${CAMPAIGN_RELATIVE_ROOT}/${MANIFEST_JSON}`,
    `${CAMPAIGN_RELATIVE_ROOT}/${MANIFEST_SHA256}`,
  ]);
  const requiredToolingPaths = EXACT_EVIDENCE_TOOLING_FILES.map(
    (name) => `${CAMPAIGN_RELATIVE_ROOT}/${name}`,
  );
  return sorted(new Set([
    ...output.split('\0').filter((path) => path && !excluded.has(path)),
    ...requiredToolingPaths,
  ]));
}

function manifestEntry(repositoryRelativePath) {
  if (repositoryRelativePath.includes('\n') || repositoryRelativePath.includes('\r')) {
    throw new Error(`MANIFEST_PATH_HAS_LINE_BREAK:${JSON.stringify(repositoryRelativePath)}`);
  }
  const absolutePath = resolve(repo, repositoryRelativePath);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile()) throw new Error(`TRACKED_CAMPAIGN_ENTRY_NOT_REGULAR_FILE:${repositoryRelativePath}`);
  const bytes = readFileSync(absolutePath);
  assertEqual(`BYTE_LENGTH:${repositoryRelativePath}`, stat.size, bytes.length);
  return {
    path: repositoryRelativePath.slice(`${CAMPAIGN_RELATIVE_ROOT}/`.length),
    sha256: sha256(bytes),
    byte_length: bytes.length,
    git_blob: gitBlob(bytes),
  };
}

const entries = trackedCampaignPaths().map(manifestEntry);
if (entries.length === 0) throw new Error('EMPTY_TRACKED_CAMPAIGN_FILE_SET');
const inventoryLines = entries.map(
  (entry) => `${entry.path}\0${entry.sha256}\0${entry.byte_length}\0${entry.git_blob}`,
);
const manifestObject = {
  schema: 'product-truth-manifest.v5',
  candidate_sha: candidate,
  candidate_tree_sha: candidateTree,
  candidate_parent_sha: candidateParent,
  candidate_parent_count: 1,
  required_direct_parent_sha: REQUIRED_C2_PARENT,
  scope: `${CAMPAIGN_RELATIVE_ROOT}/** tracked files at generation time`,
  exclusions: [MANIFEST_JSON, MANIFEST_SHA256],
  compatibility_manifest: MANIFEST_SHA256,
  exact_generated_output_count: EXACT_EVIDENCE_OUTPUTS.length,
  exact_generated_outputs: [...EXACT_EVIDENCE_OUTPUTS],
  exact_tooling_file_count: EXACT_EVIDENCE_TOOLING_FILES.length,
  exact_tooling_files: [...EXACT_EVIDENCE_TOOLING_FILES],
  exact_descendant_path_count: EXACT_EVIDENCE_DESCENDANT_FILES.length,
  exact_descendant_paths: [...EXACT_EVIDENCE_DESCENDANT_FILES],
  tooling_bundle_sha256: selection.tooling_bundle_sha256,
  sealed_git_object_payload_bundle_sha256: SEALED_GIT_OBJECT_PAYLOAD_BUNDLE_SHA256,
  entry_count: entries.length,
  inventory_sha256: sha256(Buffer.from(`${inventoryLines.join('\n')}\n`, 'utf8')),
  entries,
};
const renderedJson = `${JSON.stringify(manifestObject, null, 2)}\n`;

const compatibilityEntries = [
  ...entries,
  {
    path: MANIFEST_JSON,
    sha256: sha256(Buffer.from(renderedJson, 'utf8')),
    byte_length: Buffer.byteLength(renderedJson, 'utf8'),
    git_blob: gitBlob(Buffer.from(renderedJson, 'utf8')),
  },
];
const renderedSha256 = `${compatibilityEntries
  .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  .map((entry) => `${entry.sha256}  ${entry.path}`)
  .join('\n')}\n`;

if (renderedJson.includes(REJECTED_PREDECESSOR) || renderedJson.includes('SELF_COMMIT_UNBOUND')) {
  throw new Error('BANNED_VALUE_IN_MANIFEST_JSON');
}

if (verifyOnly) {
  assertEqual('MANIFEST_JSON_BYTES', readFileSync(manifestJsonPath, 'utf8'), renderedJson);
  assertEqual('MANIFEST_SHA256_BYTES', readFileSync(manifestSha256Path, 'utf8'), renderedSha256);
} else {
  writeFileSync(manifestJsonPath, renderedJson);
  writeFileSync(manifestSha256Path, renderedSha256);
}

process.stdout.write(`${JSON.stringify({
  candidate,
  candidate_tree: candidateTree,
  candidate_parent: candidateParent,
  candidate_parent_count: 1,
  generated_output_count: EXACT_EVIDENCE_OUTPUTS.length,
  tooling_file_count: EXACT_EVIDENCE_TOOLING_FILES.length,
  descendant_path_count: EXACT_EVIDENCE_DESCENDANT_FILES.length,
  entry_count: entries.length,
  manifest_json_sha256: sha256(Buffer.from(renderedJson, 'utf8')),
  manifest_sha256_sha256: sha256(Buffer.from(renderedSha256, 'utf8')),
  verified: verifyOnly,
})}\n`);
