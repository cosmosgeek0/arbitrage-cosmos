#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const C2 = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
const C4 = '4c9143a0bcc331aa170e9e26b741240b39df8b9e';
const MANIFEST_JSON = 'verification/product-truth-20260716/C4_EVIDENCE_MANIFEST.json';
const MANIFEST_SHA = 'verification/product-truth-20260716/MANIFEST.sha256';

function run(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function measured(pathValue) {
  const absolute = resolve(ROOT, pathValue);
  const bytes = readFileSync(absolute);
  return {
    path: pathValue,
    sha256: sha256(bytes),
    byte_length: statSync(absolute).size,
  };
}

const parents = run(['show', '-s', '--format=%P', C4]).split(/\s+/u).filter(Boolean);
if (parents.length !== 1 || parents[0] !== C2) throw new Error('C4_DIRECT_PARENT_INVALID');

const tracked = run(['diff', '--name-only', C4]).split(/\r?\n/u).filter(Boolean);
const untracked = run(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/u).filter(Boolean);
const observed = [...new Set([...tracked, ...untracked])].sort();
const outOfScope = observed.filter((pathValue) => (
  !pathValue.startsWith('verification/product-truth-20260716/')
));
if (outOfScope.length > 0) throw new Error(`POST_C4_OUT_OF_SCOPE:${outOfScope[0]}`);

const artifactPaths = observed.filter((pathValue) => (
  pathValue !== MANIFEST_JSON && pathValue !== MANIFEST_SHA
));
const gate = JSON.parse(readFileSync(resolve(OUT, 'C4_LOCAL_GATE_REPORT.json'), 'utf8'));
const coverage = JSON.parse(readFileSync(resolve(OUT, 'C4_INPUT_COVERAGE.json'), 'utf8'));
const manifest = {
  schema: 'product-truth-c4-evidence-manifest.v1',
  source_candidate: C4,
  source_candidate_tree: run(['rev-parse', `${C4}^{tree}`]),
  expected_direct_parent: C2,
  observed_parents: parents,
  direct_parent_equality: true,
  post_c4_path_allowlist: ['verification/product-truth-20260716/**'],
  post_c4_out_of_scope_paths: [],
  evidence_disposition: 'REJECTED_LOCAL_GATE',
  all_local_required_commands_passed: gate.all_local_required_commands_passed,
  custody: gate.custody.status,
  custody_token_issued: gate.custody.token_issued,
  input_count: coverage.input_count,
  mapped_input_count: coverage.mapped_count,
  candidate_backed_byte_audit_count: coverage.candidate_backed_byte_audit_count,
  artifacts: artifactPaths.map(measured),
};
writeFileSync(resolve(ROOT, MANIFEST_JSON), `${JSON.stringify(manifest, null, 2)}\n`);

const shaEntries = [...artifactPaths, MANIFEST_JSON].sort().map((pathValue) => {
  const artifact = measured(pathValue);
  return `${artifact.sha256}  ${artifact.path}`;
});
writeFileSync(resolve(ROOT, MANIFEST_SHA), `${shaEntries.join('\n')}\n`);

process.stdout.write(`${JSON.stringify({
  source_candidate: C4,
  direct_parent: C2,
  artifact_count: manifest.artifacts.length,
  sha256_entry_count: shaEntries.length,
  evidence_disposition: manifest.evidence_disposition,
})}\n`);
