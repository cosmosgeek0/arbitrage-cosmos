#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const root = resolve(repo, 'verification/product-truth-20260716');
const manifest = resolve(root, 'MANIFEST.sha256');
const candidateIndex = process.argv.indexOf('--candidate');
const candidate = candidateIndex >= 0 ? process.argv[candidateIndex + 1] : null;
const verifyOnly = process.argv.includes('--verify-only');
if (!/^[a-f0-9]{40}$/u.test(candidate ?? '')) throw new Error('EXACT_FULL_CANDIDATE_SHA_REQUIRED');

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repo, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result;
}
function git(...args) { return runGit(args).stdout.trim(); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function readJson(name) { return JSON.parse(readFileSync(resolve(root, name), 'utf8')); }
function assertEqual(label, actual, expected) { if (actual !== expected) throw new Error(`${label}:${String(actual)}:${String(expected)}`); }

assertEqual('CANDIDATE_COMMIT', git('rev-parse', `${candidate}^{commit}`), candidate);
const candidateTree = git('rev-parse', `${candidate}^{tree}`);
const candidateParent = git('rev-parse', `${candidate}^`);
if (runGit(['merge-base', '--is-ancestor', candidate, 'HEAD'], { allowFailure: true }).status !== 0) {
  throw new Error('CANDIDATE_NOT_ANCESTOR_OF_EVIDENCE_HEAD');
}

const inputLock = readJson('INPUTS.lock');
const proof = readJson('C2_PROOF_BINDING.json');
const gate = readJson('C2_GATE_REPORT.json');
const findings = readJson('INDEPENDENT_FINDINGS.json');
const selection = readJson('EVIDENCE_SELECTION.json');
const aiOps = readJson('AI_OPS_C2_DISPOSITION.json');
const productAssurance = readJson('PRODUCT_ASSURANCE_C2_DISPOSITION.json');
const census = readJson('WORKTREE_CENSUS.json');
const disposition = readJson('ARTIFACT_DISPOSITION.json');
const binding = readJson('C2_EVIDENCE_BINDING.json');

for (const [label, actual] of [
  ['INPUT_LOCK', inputLock.candidate], ['PROOF', proof.candidate_sha], ['GATE', gate.candidate?.commit],
  ['FINDINGS', findings.candidate_sha], ['SELECTION', selection.source_candidate], ['AI_OPS', aiOps.candidate_sha],
  ['PRODUCT_ASSURANCE', productAssurance.candidate_sha], ['CENSUS', census.candidate_sha],
  ['DISPOSITION', disposition.candidate_sha], ['BINDING', binding.candidate_sha],
]) assertEqual(`${label}_CANDIDATE`, actual, candidate);
for (const [label, actual] of [
  ['INPUT_LOCK', inputLock.candidate_tree], ['PROOF', proof.candidate_tree], ['GATE', gate.candidate?.tree],
  ['CENSUS', census.candidate_tree_sha], ['BINDING', binding.candidate_tree],
]) assertEqual(`${label}_TREE`, actual, candidateTree);
assertEqual('PROOF_PARENT', proof.candidate_parent, candidateParent);
assertEqual('GATE_PARENT', gate.candidate?.parent, candidateParent);
assertEqual('BINDING_PARENT', binding.candidate_parent, candidateParent);
assertEqual('GATE_ALL_REQUIRED_COMMANDS', gate.all_required_commands_passed, true);
assertEqual('GATE_INDEPENDENT', gate.independent, false);
assertEqual('GATE_INDEPENDENT_TOKEN', gate.independent_token_issued, false);
assertEqual('FRESH_CLONE_CLEAN', gate.fresh_single_branch_clone?.final_clean, true);
assertEqual('FRESH_CLONE_HEAD', gate.fresh_single_branch_clone?.detached_head, candidate);
assertEqual('FRESH_CLONE_CURRENT_MAIN_ABSENT', gate.fresh_single_branch_clone?.current_main_ref_present, false);
assertEqual('CURRENT_MAIN_UNTOUCHED', gate.current_main?.touched_by_account_a, false);
assertEqual('CENSUS_UNKNOWN', census.unknown_count, 0);
assertEqual('BINDING_PASS0', binding.pass_0_gate, 'BLOCKED:C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED');

const requiredCommands = [
  [gate.local_checkout?.commands ?? [], 'npm test'],
  [gate.local_checkout?.commands ?? [], 'npm run test:all'],
  [gate.fresh_single_branch_clone?.commands ?? [], 'npm ci'],
  [gate.fresh_single_branch_clone?.commands ?? [], 'npm test'],
  [gate.fresh_single_branch_clone?.commands ?? [], 'npm run test:all'],
];
for (const [rows, command] of requiredCommands) {
  if (!rows.some((row) => row.command === command && row.exit_code === 0 && /^[a-f0-9]{64}$/u.test(row.output_sha256 ?? ''))) {
    throw new Error(`PASSING_GATE_COMMAND_MISSING:${command}`);
  }
}

for (const name of ['DIRECTIVE_COVERAGE_MATRIX.csv', 'CAPABILITY_TRUTH_MATRIX.csv']) {
  const text = readFileSync(resolve(root, name), 'utf8');
  if (text.includes('SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT')) throw new Error(`UNBOUND_MATRIX:${name}`);
  if (!text.includes(candidate)) throw new Error(`CANDIDATE_MISSING_FROM_MATRIX:${name}`);
}
for (const name of ['STATE.md', 'FINAL_VERDICT.md', 'AUTHORITY_RESOLUTION.md', 'CLEAN_CLONE_ACCEPTANCE.md']) {
  const text = readFileSync(resolve(root, name), 'utf8');
  if (!text.includes(candidate)) throw new Error(`CURRENT_VERDICT_NOT_CANDIDATE_BOUND:${name}`);
  if (text.includes('BASELINE_TRUTH_ACCEPTED:41752d6a87dc1cb1b933bb4460c9cabfc15ff694')) throw new Error(`REJECTED_OLD_TOKEN_IN_CURRENT_VERDICT:${name}`);
}

const diffPaths = git('diff', '--name-only', candidate, '--').split('\n').filter(Boolean);
for (const changed of diffPaths) {
  if (!changed.startsWith('verification/product-truth-20260716/')) throw new Error(`POST_C2_PATH_OUTSIDE_ALLOWLIST:${changed}`);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (!entry.isFile() || absolute === manifest) return [];
    return [absolute];
  });
}
function renderManifest() {
  const rows = walk(root)
    .sort((left, right) => relative(root, left).localeCompare(relative(root, right)))
    .map((absolute) => {
      const name = relative(root, absolute);
      const bytes = readFileSync(absolute);
      if (statSync(absolute).size !== bytes.length) throw new Error(`SIZE_DRIFT:${name}`);
      return `${sha256(bytes)}  ${name}`;
    });
  return `${rows.join('\n')}\n`;
}

const allClassified = new Set([
  ...disposition.current_authority.map((row) => row.artifact),
  ...disposition.historical_reference_only.map((row) => row.artifact),
]);
for (const absolute of walk(root)) {
  const name = relative(root, absolute);
  if (!allClassified.has(name)) throw new Error(`UNCLASSIFIED_CAMPAIGN_ARTIFACT:${name}`);
}

const rendered = renderManifest();
if (verifyOnly) {
  assertEqual('MANIFEST_BYTES', readFileSync(manifest, 'utf8'), rendered);
} else {
  writeFileSync(manifest, rendered);
}
process.stdout.write(`${JSON.stringify({ candidate, candidateTree, candidateParent, entry_count: rendered.trimEnd().split('\n').length, manifest_sha256: sha256(Buffer.from(rendered)), self_excluded: true, verified: verifyOnly })}\n`);
