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
function exactRefHead(output, expectedRef, label) {
  const rows = output.trim().split(/\r?\n/u).filter(Boolean);
  if (rows.length !== 1) throw new Error(`${label}_ROW_COUNT:${rows.length}`);
  const [head, ref, ...extra] = rows[0].split(/\s+/u);
  if (!/^[a-f0-9]{40}$/u.test(head ?? '') || ref !== expectedRef || extra.length !== 0) {
    throw new Error(`${label}_INVALID:${rows[0]}`);
  }
  return head;
}

assertEqual('CANDIDATE_COMMIT', git('rev-parse', `${candidate}^{commit}`), candidate);
const candidateTree = git('rev-parse', `${candidate}^{tree}`);
const candidateParent = git('rev-parse', `${candidate}^`);
if (runGit(['merge-base', '--is-ancestor', candidate, 'HEAD'], { allowFailure: true }).status !== 0) {
  throw new Error('CANDIDATE_NOT_ANCESTOR_OF_EVIDENCE_HEAD');
}

const inputLock = readJson('INPUTS.lock');
const custody = readJson('C2_CUSTODY_RECEIPT.json');
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
  ['INPUT_LOCK', inputLock.candidate], ['CUSTODY', custody.candidate_sha], ['PROOF', proof.candidate_sha], ['GATE', gate.candidate?.commit],
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
assertEqual('GATE_FAILURE', gate.failure, null);
assertEqual('GATE_INDEPENDENT', gate.independent, false);
assertEqual('GATE_INDEPENDENT_TOKEN', gate.independent_token_issued, false);
assertEqual('FRESH_CLONE_CLEAN', gate.fresh_single_branch_clone?.final_clean, true);
assertEqual('FRESH_CLONE_HEAD', gate.fresh_single_branch_clone?.detached_head, candidate);
assertEqual('FRESH_CLONE_CHECKOUT_COMMAND', gate.fresh_single_branch_clone?.checkout_command, `git checkout --detach ${candidate}`);
assertEqual('FRESH_CLONE_TRANSPORT', gate.fresh_single_branch_clone?.transport, 'LIVE_REMOTE_SINGLE_BRANCH_CLONE_NO_HARDLINKS');
assertEqual('FRESH_CLONE_CURRENT_MAIN_ABSENT', gate.fresh_single_branch_clone?.current_main_ref_present, false);
assertEqual('FRESH_CLONE_LOCAL_BRANCH_COUNT', gate.fresh_single_branch_clone?.branch_ref_count, 1);
assertEqual('FRESH_CLONE_REMOTE_BRANCH_COUNT', gate.fresh_single_branch_clone?.remote_tracking_branch_ref_count, 1);
assertEqual('FRESH_CLONE_NO_HARDLINKS', gate.fresh_single_branch_clone?.hardlink_audit?.passed, true);
assertEqual('FRESH_CLONE_NO_ALTERNATES', gate.fresh_single_branch_clone?.hardlink_audit?.alternates_present, false);
assertEqual('FRESH_CLONE_HARDLINKED_OBJECT_COUNT', gate.fresh_single_branch_clone?.hardlink_audit?.hardlinked_object_file_count, 0);
assertEqual('CURRENT_MAIN_UNTOUCHED', gate.current_main?.touched_by_account_a, false);
const currentMainValues = [
  gate.current_main?.before_local,
  gate.current_main?.before_origin,
  gate.current_main?.before_live_origin,
  gate.current_main?.after_local,
  gate.current_main?.after_origin,
  gate.current_main?.after_live_origin,
];
if (currentMainValues.some((value) => !/^[a-f0-9]{40}$/u.test(value ?? ''))
    || new Set(currentMainValues).size !== 1) {
  throw new Error('CURRENT_MAIN_IDENTITY_CHANGED_OR_INCOMPLETE');
}
assertEqual('CENSUS_UNKNOWN', census.unknown_count, 0);
assertEqual('CANONICAL_GATE_RESULT', gate.canonical_gate_result, 'PASS');
assertEqual('CLEAN_CLONE_RESULT', gate.clean_clone_result, 'BUILDER_PASS_NOT_INDEPENDENT_WAVE1B');

const custodyRef = `refs/heads/${custody.remote?.branch ?? ''}`;
assertEqual('CUSTODY_SCHEMA', custody.schema, 'product-truth-c2-custody-receipt.v1');
assertEqual('CUSTODY_SATISFIED', custody.custody_satisfied, true);
assertEqual('CUSTODY_REMOTE_REF', custody.remote?.ref, custodyRef);
assertEqual('CUSTODY_REMOTE_NAME', custody.remote?.name, 'origin');
assertEqual('CUSTODY_REMOTE_HEAD', custody.remote?.observed_head, candidate);
assertEqual('CUSTODY_BUNDLE_HEAD', custody.bundle?.observed_head, candidate);
assertEqual('INPUT_LOCK_CUSTODY', inputLock.current_c2_custody?.custody_satisfied, true);
assertEqual('GATE_CUSTODY_RESULT', gate.custody?.result, custody.result);
assertEqual('GATE_CUSTODY_REMOTE', gate.custody?.remote_head, candidate);
assertEqual('GATE_CUSTODY_BUNDLE', gate.custody?.bundle_sha256, custody.bundle?.sha256);
const expectedClonePrefix = `git clone --no-hardlinks --single-branch --branch truth-campaign-20260716 ${custody.remote?.url} `;
if (!gate.fresh_single_branch_clone?.clone_command?.startsWith(expectedClonePrefix)) {
  throw new Error('FRESH_CLONE_LITERAL_COMMAND_INVALID');
}
assertEqual('FRESH_CLONE_LOCAL_REFS', JSON.stringify(gate.fresh_single_branch_clone?.local_branch_refs), JSON.stringify(['refs/heads/truth-campaign-20260716']));
assertEqual('FRESH_CLONE_REMOTE_REFS', JSON.stringify(gate.fresh_single_branch_clone?.remote_tracking_branch_refs), JSON.stringify(['refs/remotes/origin/truth-campaign-20260716']));

const liveRemote = runGit(['ls-remote', '--exit-code', '--refs', custody.remote.name, custody.remote.ref]);
assertEqual('LIVE_REMOTE_CANDIDATE', exactRefHead(liveRemote.stdout, custody.remote.ref, 'LIVE_REMOTE_CANDIDATE'), candidate);
const bundlePath = custody.bundle?.path;
if (typeof bundlePath !== 'string' || !statSync(bundlePath).isFile()) throw new Error('CUSTODY_BUNDLE_FILE_MISSING');
runGit(['bundle', 'verify', '--quiet', bundlePath]);
const liveBundleHead = runGit(['bundle', 'list-heads', bundlePath, custody.bundle.branch_ref]);
assertEqual('LIVE_BUNDLE_CANDIDATE', exactRefHead(liveBundleHead.stdout, custody.bundle.branch_ref, 'LIVE_BUNDLE_CANDIDATE'), candidate);
assertEqual('LIVE_BUNDLE_SHA256', sha256(readFileSync(bundlePath)), custody.bundle.sha256);
assertEqual('BINDING_CUSTODY_RECEIPT', binding.custody_receipt_sha256, sha256(readFileSync(resolve(root, 'C2_CUSTODY_RECEIPT.json'))));

const requiredCommands = [
  [gate.local_checkout?.commands ?? [], 'npm ci'],
  [gate.local_checkout?.commands ?? [], 'npm test'],
  [gate.local_checkout?.commands ?? [], 'npm run test:all'],
  [gate.fresh_single_branch_clone?.commands ?? [], 'npm ci'],
  [gate.fresh_single_branch_clone?.commands ?? [], 'npm test'],
  [gate.fresh_single_branch_clone?.commands ?? [], 'npm run test:all'],
];
for (const [rows, command] of requiredCommands) {
  const row = rows.find((candidateRow) => candidateRow.command === command);
  const testCountValid = command === 'npm ci' || (row?.test_count !== null && row?.test_count > 0);
  if (row === undefined || row.exit_code !== 0 || !testCountValid
      || !Number.isFinite(Date.parse(row.started_at_utc ?? ''))
      || !Number.isFinite(Date.parse(row.ended_at_utc ?? ''))
      || !/^[a-f0-9]{64}$/u.test(row.output_sha256 ?? '')
      || (row.unexpected_skip_markers ?? []).length !== 0) {
    throw new Error(`PASSING_GATE_COMMAND_MISSING:${command}`);
  }
}

const pass0Token = `BASELINE_TRUTH_ACCEPTED:${candidate}`;
assertEqual('BINDING_PASS0', binding.pass_0_gate, pass0Token);

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
for (const name of ['STATE.md', 'FINAL_VERDICT.md', 'AUTHORITY_RESOLUTION.md']) {
  if (!readFileSync(resolve(root, name), 'utf8').includes(pass0Token)) throw new Error(`PASS0_TOKEN_MISSING:${name}`);
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
