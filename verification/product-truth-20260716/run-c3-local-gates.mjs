#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const REPORT_PATH = resolve(OUT, 'C3_LOCAL_GATE_REPORT.json');
const REPORT_RELATIVE = 'verification/product-truth-20260716/C3_LOCAL_GATE_REPORT.json';
const BRANCH = 'truth-campaign-20260716';
const C2 = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const candidate = argument('--candidate');
if (!FULL_SHA.test(candidate ?? '')) throw new Error('EXACT_FULL_C3_SHA_REQUIRED');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function shellWord(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandText(command, args) {
  return [command, ...args].map(shellWord).join(' ');
}

function outputTail(value, maximumLines = 80) {
  return value.split(/\r?\n/u).filter(Boolean).slice(-maximumLines);
}

function emittedTestEvidence(output) {
  const explicitSummaries = [];
  const passingRatios = [];
  const skipSummaries = [];
  const unexpectedSkipMarkers = [];
  for (const line of output.split(/\r?\n/u)) {
    let match = line.match(/^\s*(?:#|ℹ|i)\s*tests\s+(\d+)\s*$/iu);
    if (match !== null) explicitSummaries.push({ line: line.trim(), count: Number(match[1]) });
    match = line.match(/^\s*Tests:\s*(\d+)\s+passed(?:,\s*(\d+)\s+total)?/iu);
    if (match !== null) {
      explicitSummaries.push({ line: line.trim(), count: Number(match[2] ?? match[1]) });
    }
    match = line.match(/(?:^|[=\s])(?<passed>\d+)\s+passed(?:\s+in\s+[\d.]+s|[,\s=]|$)/iu);
    if (match?.groups?.passed !== undefined && !/^\s*Tests:/iu.test(line)) {
      explicitSummaries.push({ line: line.trim(), count: Number(match.groups.passed) });
    }
    for (const ratio of line.matchAll(/\b(\d+)\/(\d+)\b/gu)) {
      const passed = Number(ratio[1]);
      const total = Number(ratio[2]);
      if (passed === total && total > 0) passingRatios.push({ line: line.trim(), passed, total });
    }
    match = line.match(/^\s*(?:#|ℹ|i)\s*(skipped|todo)\s+(\d+)\s*$/iu);
    if (match !== null) {
      const count = Number(match[2]);
      skipSummaries.push({ line: line.trim(), kind: match[1].toLowerCase(), count });
      if (count > 0) unexpectedSkipMarkers.push(line.trim());
    }
    if (/^\s*(?:not\s+)?ok\b.*#\s*(?:SKIP|TODO)\b/iu.test(line)) {
      unexpectedSkipMarkers.push(line.trim());
    }
    match = line.match(/(?:^|[,\s=])(?<count>[1-9]\d*)\s+skipped(?:[,\s=]|$)/iu);
    if (match?.groups?.count !== undefined) unexpectedSkipMarkers.push(line.trim());
  }
  const uniqueRatios = [...new Map(
    passingRatios.map((row) => [`${row.line}\0${row.passed}\0${row.total}`, row]),
  ).values()];
  const testCount = explicitSummaries.length > 0
    ? explicitSummaries.reduce((total, row) => total + row.count, 0)
    : uniqueRatios.reduce((total, row) => total + row.total, 0);
  return {
    test_count: testCount > 0 ? testCount : null,
    test_count_basis: explicitSummaries.length > 0
      ? 'SUM_OF_EXACT_EMITTED_TEST_SUMMARY_COUNTS'
      : 'SUM_OF_UNIQUE_EXACT_PASSING_RATIO_TOTALS',
    explicit_test_summaries: explicitSummaries,
    passing_ratio_evidence: uniqueRatios,
    skip_summaries: skipSummaries,
    unexpected_skip_markers: [...new Set(unexpectedSkipMarkers)],
  };
}

function firstCausalError(stderr, stdout) {
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /^(?:fatal:|npm error|error:|AssertionError|not ok\b|✖\s)/iu.test(line))
    ?? lines.find((line) => /(?:fatal|error|failed|failure|missing|not found|assert)/iu.test(line))
    ?? lines[0]
    ?? 'COMMAND_FAILED_WITHOUT_OUTPUT';
}

async function capture(command, args, {
  cwd = ROOT,
  kind = 'probe',
  expectedExitCodes = [0],
} = {}) {
  const rendered = commandText(command, args);
  const startedAt = new Date().toISOString();
  process.stderr.write(`[c3-local] START ${rendered}\n`);
  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const heartbeat = setInterval(() => {
    process.stderr.write(`[c3-local] RUNNING ${rendered}\n`);
  }, 30_000);
  const { exitCode, signal } = await new Promise((accept, reject) => {
    child.on('error', reject);
    child.on('close', (code, closeSignal) => accept({ exitCode: code ?? 1, signal: closeSignal }));
  });
  clearInterval(heartbeat);
  const endedAt = new Date().toISOString();
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  const combined = Buffer.concat([stdout, stderr]);
  const text = `${stdout.toString('utf8')}\n${stderr.toString('utf8')}`;
  const testEvidence = kind === 'test' ? emittedTestEvidence(text) : {
    test_count: 0,
    test_count_basis: 'NOT_A_TEST_COMMAND',
    explicit_test_summaries: [],
    passing_ratio_evidence: [],
    skip_summaries: [],
    unexpected_skip_markers: [],
  };
  const record = {
    command: rendered,
    argv: [command, ...args],
    cwd,
    started_at_utc: startedAt,
    ended_at_utc: endedAt,
    exit_code: exitCode,
    signal,
    stdout_sha256: sha256(stdout),
    stderr_sha256: sha256(stderr),
    output_sha256: sha256(combined),
    output_digest_rule: 'SHA256_OF_STDOUT_BYTES_THEN_STDERR_BYTES',
    stdout_byte_length: stdout.length,
    stderr_byte_length: stderr.length,
    ...testEvidence,
    expected_exit_codes: expectedExitCodes,
    exit_code_expected: expectedExitCodes.includes(exitCode),
  };
  if (!record.exit_code_expected) {
    record.stdout_tail = outputTail(stdout.toString('utf8'));
    record.stderr_tail = outputTail(stderr.toString('utf8'));
  }
  process.stderr.write(`[c3-local] END exit=${exitCode} output=${record.output_sha256} ${rendered}\n`);
  return { record, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
}

const report = {
  schema: 'product-truth-c3-pre-custody-local-gate.v1',
  generated_at_utc: new Date().toISOString(),
  actor_role: 'ACCOUNT_A_CANDIDATE_WRITER',
  independent: false,
  independent_token_issued: false,
  source_candidate: {
    immutable_c2: C2,
    c2_disposition: 'REJECTED_CLEAN_CLONE_IMMUTABLE',
    c3: candidate,
    c3_tree: null,
    c3_parent: null,
    branch: BRANCH,
  },
  evidence_path: REPORT_RELATIVE,
  preflight: { commands: [] },
  census: { commands: [], result: 'NOT_RUN' },
  canonical_gate: { setup_commands: [], commands: [], diagnostic_commands: [], cleanup_commands: [], result: 'NOT_RUN' },
  literal_clean_clone: { setup_commands: [], topology_commands: [], commands: [], diagnostic_commands: [], cleanup_actions: [], result: 'NOT_RUN' },
  current_main: { before: null, after: null, changed_during_gate: null },
  custody: {
    status: 'C3_CUSTODY_REQUIRED_NOT_ATTEMPTED',
    c2_custody_transfers_to_c3: false,
    live_remote_clean_clone_run: false,
    bundle_receipt_recorded: false,
  },
  all_local_required_commands_passed: false,
  failure: null,
};

function flushReport() {
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

function failClosed(record, causalError) {
  report.failure = {
    command: record?.command ?? 'INTERNAL_EVIDENCE_VALIDATION',
    exit_code: record?.exit_code ?? 1,
    first_causal_error: causalError,
    affected_evidence_path: REPORT_RELATIVE,
    observed_at_utc: new Date().toISOString(),
  };
  flushReport();
  const error = new Error(causalError);
  error.reported = true;
  throw error;
}

function requirePassing(result, { requireTestEvidence = false } = {}) {
  const { record, stderr, stdout } = result;
  if (!record.exit_code_expected) failClosed(record, firstCausalError(stderr, stdout));
  if (!SHA256.test(record.output_sha256)) failClosed(record, 'OUTPUT_DIGEST_MISSING_OR_INVALID');
  if (requireTestEvidence && (!Number.isInteger(record.test_count) || record.test_count <= 0)) {
    failClosed(record, 'MISSING_EXACT_TEST_COUNT_EVIDENCE');
  }
  if (requireTestEvidence && record.unexpected_skip_markers.length > 0) {
    failClosed(record, `UNEXPECTED_TEST_SKIP:${record.unexpected_skip_markers[0]}`);
  }
}

function parseSingleSha(value, label) {
  const sha = value.trim();
  if (!FULL_SHA.test(sha)) failClosed(null, `${label}_INVALID:${sha}`);
  return sha;
}

function parseStatusPaths(output) {
  return output.split('\0').filter(Boolean).map((entry) => {
    const value = entry.slice(3);
    const arrow = value.lastIndexOf(' -> ');
    return arrow === -1 ? value : value.slice(arrow + 4);
  }).sort();
}

function listObjectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return listObjectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

function hardlinkAudit(clonePath) {
  const observedAt = new Date().toISOString();
  const objectRoot = resolve(clonePath, '.git/objects');
  const files = listObjectFiles(objectRoot);
  const linked = files.filter((file) => statSync(file).nlink > 1);
  const maxLinkCount = files.reduce((maximum, file) => Math.max(maximum, statSync(file).nlink), 0);
  const alternatesPath = resolve(objectRoot, 'info/alternates');
  return {
    observed_at_utc: observedAt,
    clone_flags: ['--no-local', '--no-hardlinks'],
    object_files_checked: files.length,
    max_link_count: maxLinkCount,
    hardlinked_object_file_count: linked.length,
    hardlinked_object_files: linked.map((file) => file.slice(clonePath.length + 1)),
    alternates_path: alternatesPath,
    alternates_present: existsSync(alternatesPath),
    passed: files.length > 0 && linked.length === 0 && !existsSync(alternatesPath),
  };
}

function validateCensus() {
  const censusPath = resolve(OUT, 'WORKTREE_CENSUS.json');
  const censusBytes = readFileSync(censusPath);
  const census = JSON.parse(censusBytes.toString('utf8'));
  const tombstones = census.removed_safe_tombstones ?? [];
  const names = tombstones.map((entry) => entry.worktree_name).sort();
  const expectedNames = ['prep-act', 'shard-prov', 'shard-sec', 'v-clean', 'v-cockpit'].sort();
  const noOutput = tombstones
    .filter((entry) => entry.worktree_name === 'shard-sec' || entry.worktree_name === 'v-cockpit');
  const outputs = tombstones.flatMap((entry) => entry.outputs ?? []);
  const valid = census.candidate_sha === candidate
    && census.candidate_tree_sha === report.source_candidate.c3_tree
    && census.expected_registered_worktree_count === census.registered_worktree_count
    && census.live_policy_name_count === census.registered_worktree_count
    && census.registered_worktree_count > 0
    && census.unknown_count === 0
    && census.removed_safe_tombstone_count === 5
    && JSON.stringify(names) === JSON.stringify(expectedNames)
    && tombstones.every((entry) => entry.classification === 'REMOVED_SAFE')
    && noOutput.length === 2
    && noOutput.every((entry) => entry.accepted_output_state === 'NO_ACCEPTED_OUTPUT'
      && Array.isArray(entry.outputs) && entry.outputs.length === 0)
    && outputs.length === 4
    && outputs.every((entry) => entry.source_commit === '0e4b364849075a454d7dd624ca068c238f4196c2'
      && entry.candidate_commit === candidate
      && entry.byte_exact === true
      && entry.source_git_blob === entry.candidate_git_blob
      && entry.source_sha256 === entry.candidate_sha256
      && entry.source_bytes === entry.candidate_bytes);
  if (!valid) failClosed(null, 'C3_WORKTREE_CENSUS_INVALID');
  return {
    path: 'verification/product-truth-20260716/WORKTREE_CENSUS.json',
    sha256: sha256(censusBytes),
    byte_length: censusBytes.length,
    registered_worktree_count: census.registered_worktree_count,
    expected_count_basis: census.expected_count_basis,
    removed_safe_tombstone_count: census.removed_safe_tombstone_count,
    unknown_count: census.unknown_count,
  };
}

const MODE_DIAGNOSTIC = [
  'import { collectDonorEqualityEvidence, evaluateDonorEquality } from "./test/i00/donor-equality.mjs";',
  'const observation = collectDonorEqualityEvidence({ candidateRef: "HEAD" });',
  'const proof = evaluateDonorEquality(observation);',
  'const receiptBound = observation.receiptBound ?? null;',
  'process.stdout.write(`${JSON.stringify({ candidate: proof.candidate, evidence_mode: observation.evidenceMode, counts: proof.counts, status: proof.status, failures: proof.failures, receipt_authority: receiptBound?.authority ?? null, clone_boundary: receiptBound?.cloneBoundary ?? null, unavailable_donor_ids: receiptBound?.unavailableDonorIds ?? [], unavailable_exclusion_ids: receiptBound?.unavailableExclusionIds ?? [] })}\\n`);',
  'if (proof.status !== "PASS") process.exitCode = 1;',
].join(' ');

async function donorModeDiagnostic(directory, expectedMode, bucket) {
  const result = await capture(
    'node',
    ['--input-type=module', '-e', MODE_DIAGNOSTIC],
    { cwd: directory },
  );
  bucket.push(result.record);
  requirePassing(result);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    failClosed(result.record, 'DONOR_MODE_DIAGNOSTIC_JSON_INVALID');
  }
  result.record.test_count = parsed?.counts?.expected ?? null;
  result.record.test_count_basis = 'DONOR_EQUALITY_EXPECTED_COUNT';
  const commonValid = parsed?.candidate?.sha === candidate
    && parsed?.status === 'PASS'
    && JSON.stringify(parsed?.counts) === JSON.stringify({
      expected: 16,
      discovered: 16,
      accepted: 16,
      integrated: 16,
    })
    && Array.isArray(parsed?.failures)
    && parsed.failures.length === 0
    && parsed.evidence_mode === expectedMode;
  if (!commonValid) failClosed(result.record, `DONOR_MODE_DIAGNOSTIC_INVALID:${expectedMode}`);
  if (expectedMode === 'TRACKED_RECEIPT_SINGLE_BRANCH') {
    const receiptValid = parsed.receipt_authority?.sourceCommit === C2
      && parsed.receipt_authority?.observedSha256
        === 'ce1d7d386a017bb1359a17d139e1d126200d85f9d2c0cd674be7f3081c028ecc'
      && parsed.clone_boundary?.qualifiesForReceiptBoundMode === true
      && JSON.stringify(parsed.unavailable_donor_ids) === JSON.stringify(['DASHBOARD-SHELL'])
      && JSON.stringify(parsed.unavailable_exclusion_ids) === JSON.stringify(['PREVERIFY']);
    if (!receiptValid) failClosed(result.record, 'RECEIPT_BOUND_DONOR_DIAGNOSTIC_INVALID');
  }
  return parsed;
}

async function runBattery(directory, phase) {
  const target = phase === 'CANONICAL' ? report.canonical_gate : report.literal_clean_clone;
  for (const [command, args, kind] of [
    ['npm', ['ci'], 'install'],
    ['npm', ['test'], 'test'],
    ['npm', ['run', 'test:all'], 'test'],
  ]) {
    const result = await capture(command, args, { cwd: directory, kind });
    target.commands.push(result.record);
    requirePassing(result, { requireTestEvidence: kind === 'test' });
  }
}

async function currentMainSnapshot(bucket) {
  const local = await capture('git', ['rev-parse', 'refs/heads/current-main']);
  const cached = await capture('git', ['rev-parse', 'refs/remotes/origin/current-main']);
  bucket.push(local.record, cached.record);
  requirePassing(local);
  requirePassing(cached);
  return {
    local: parseSingleSha(local.stdout, 'CURRENT_MAIN_LOCAL'),
    cached_origin: parseSingleSha(cached.stdout, 'CURRENT_MAIN_CACHED_ORIGIN'),
  };
}

let canonicalPath = null;
let cloneTempRoot = null;

async function main() {
  flushReport();
  const branch = await capture('git', ['branch', '--show-current']);
  const head = await capture('git', ['rev-parse', 'HEAD']);
  const tree = await capture('git', ['rev-parse', `${candidate}^{tree}`]);
  const parent = await capture('git', ['rev-parse', `${candidate}^`]);
  const branchRef = await capture('git', ['rev-parse', `refs/heads/${BRANCH}`]);
  const cachedCampaign = await capture('git', ['rev-parse', `refs/remotes/origin/${BRANCH}`]);
  const c2Type = await capture('git', ['cat-file', '-t', C2]);
  const c2Ancestor = await capture('git', ['merge-base', '--is-ancestor', C2, candidate]);
  const status = await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  report.preflight.commands.push(
    branch.record,
    head.record,
    tree.record,
    parent.record,
    branchRef.record,
    cachedCampaign.record,
    c2Type.record,
    c2Ancestor.record,
    status.record,
  );
  for (const result of [branch, head, tree, parent, branchRef, cachedCampaign, c2Type, c2Ancestor, status]) {
    requirePassing(result);
  }
  if (branch.stdout.trim() !== BRANCH) failClosed(branch.record, `WRONG_BRANCH:${branch.stdout.trim()}`);
  if (head.stdout.trim() !== candidate || branchRef.stdout.trim() !== candidate) {
    failClosed(head.record, `SOURCE_HEAD_OR_BRANCH_NOT_EXACT_C3:${head.stdout.trim()}`);
  }
  if (c2Type.stdout.trim() !== 'commit') failClosed(c2Type.record, 'IMMUTABLE_C2_OBJECT_INVALID');
  const dirtyPaths = parseStatusPaths(status.stdout);
  const outOfScope = dirtyPaths.filter((pathValue) => (
    !pathValue.startsWith('verification/product-truth-20260716/')
  ));
  if (outOfScope.length > 0) failClosed(status.record, `OUT_OF_SCOPE_DIRTY_PATH:${outOfScope[0]}`);
  report.preflight.dirty_paths = dirtyPaths;
  report.preflight.out_of_scope_dirty_paths = outOfScope;
  report.source_candidate.c3_tree = parseSingleSha(tree.stdout, 'C3_TREE');
  report.source_candidate.c3_parent = parseSingleSha(parent.stdout, 'C3_PARENT');
  report.source_candidate.cached_origin_campaign_head = parseSingleSha(
    cachedCampaign.stdout,
    'CACHED_ORIGIN_CAMPAIGN',
  );
  report.source_candidate.cached_origin_is_c3 = cachedCampaign.stdout.trim() === candidate;
  report.current_main.before = await currentMainSnapshot(report.preflight.commands);
  flushReport();

  const censusRun = await capture(
    'node',
    ['verification/product-truth-20260716/generate-worktree-census.mjs', candidate],
  );
  report.census.commands.push(censusRun.record);
  requirePassing(censusRun);
  let censusSummary;
  try {
    censusSummary = JSON.parse(censusRun.stdout);
  } catch {
    failClosed(censusRun.record, 'CENSUS_SUMMARY_JSON_INVALID');
  }
  censusRun.record.test_count = censusSummary.registered_worktrees;
  censusRun.record.test_count_basis = 'LIVE_REGISTERED_WORKTREE_COUNT';
  report.census.artifact = validateCensus();
  report.census.result = 'PASS_LIVE_GIT_DERIVED_WITH_REMOVED_SAFE_TOMBSTONES';
  flushReport();

  canonicalPath = mkdtempSync(join(dirname(ROOT), '.truth-a-c3-canonical-'));
  rmSync(canonicalPath, { recursive: true, force: true });
  const worktreeAdd = await capture('git', ['worktree', 'add', '--detach', canonicalPath, candidate]);
  report.canonical_gate.setup_commands.push(worktreeAdd.record);
  requirePassing(worktreeAdd);
  try {
    const canonicalHead = await capture('git', ['rev-parse', 'HEAD'], { cwd: canonicalPath });
    report.canonical_gate.setup_commands.push(canonicalHead.record);
    requirePassing(canonicalHead);
    if (canonicalHead.stdout.trim() !== candidate) {
      failClosed(canonicalHead.record, `CANONICAL_CHECKOUT_NOT_EXACT_C3:${canonicalHead.stdout.trim()}`);
    }
    report.canonical_gate.detached_head = candidate;
    await runBattery(canonicalPath, 'CANONICAL');
    report.canonical_gate.donor_evidence = await donorModeDiagnostic(
      canonicalPath,
      'LIVE_FULL_WORKSPACE',
      report.canonical_gate.diagnostic_commands,
    );
    const canonicalClean = await capture('git', ['status', '--porcelain=v1'], { cwd: canonicalPath });
    report.canonical_gate.setup_commands.push(canonicalClean.record);
    requirePassing(canonicalClean);
    report.canonical_gate.final_clean = canonicalClean.stdout.trim() === '';
    if (!report.canonical_gate.final_clean) {
      failClosed(canonicalClean.record, 'CANONICAL_CHECKOUT_NOT_CLEAN_AFTER_GATE');
    }
    report.canonical_gate.result = 'PASS';
  } finally {
    if (canonicalPath !== null && existsSync(canonicalPath)) {
      const worktreeRemove = await capture('git', ['worktree', 'remove', '--force', canonicalPath]);
      report.canonical_gate.cleanup_commands.push(worktreeRemove.record);
      requirePassing(worktreeRemove);
    }
    flushReport();
  }

  cloneTempRoot = mkdtempSync(join(tmpdir(), 'truth-a-c3-local-clone-'));
  const clonePath = resolve(cloneTempRoot, 'clone');
  const clone = await capture('git', [
    'clone',
    '--no-local',
    '--no-hardlinks',
    '--single-branch',
    '--branch',
    BRANCH,
    ROOT,
    clonePath,
  ]);
  report.literal_clean_clone.setup_commands.push(clone.record);
  requirePassing(clone);
  try {
    const detach = await capture('git', ['checkout', '--detach', candidate], { cwd: clonePath });
    report.literal_clean_clone.setup_commands.push(detach.record);
    requirePassing(detach);
    const topologyCommands = [
      await capture('git', ['rev-parse', 'HEAD'], { cwd: clonePath }),
      await capture('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: clonePath, expectedExitCodes: [1] }),
      await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: clonePath }),
      await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], { cwd: clonePath }),
      await capture('git', ['for-each-ref', '--format=%(refname)', 'refs'], { cwd: clonePath }),
      await capture('git', ['config', '--get-all', 'remote.origin.fetch'], { cwd: clonePath }),
      await capture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: clonePath }),
      await capture('git', ['rev-parse', '--is-shallow-repository'], { cwd: clonePath }),
      await capture('git', ['show-ref', '--verify', '--quiet', 'refs/heads/current-main'], { cwd: clonePath, expectedExitCodes: [1] }),
      await capture('git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/current-main'], { cwd: clonePath, expectedExitCodes: [1] }),
      await capture('git', ['cat-file', '-e', '692501587617d4880303fbd747d93e63c376f088^{commit}'], { cwd: clonePath, expectedExitCodes: [128] }),
      await capture('git', ['cat-file', '-e', '46b2f1e31edf9f75aec7203e952a56f9869a2971^{commit}'], { cwd: clonePath, expectedExitCodes: [128] }),
      await capture('git', ['cat-file', '-e', 'a0c0c2e5ef3180aa720488463643433cefeb65e5^{commit}'], { cwd: clonePath }),
    ];
    report.literal_clean_clone.topology_commands.push(
      ...topologyCommands.map((result) => result.record),
    );
    for (const result of topologyCommands) requirePassing(result);
    const [detachedHead, symbolicHead, localRefsResult, remoteRefsResult, allRefsResult, fetchResult,
      worktreeResult, shallowResult, localCurrentMain, remoteCurrentMain,
      dashboardObject, preverifyObject, mergeDonorObject] = topologyCommands;
    const localRefs = localRefsResult.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const remoteRefs = remoteRefsResult.stdout.trim().split(/\r?\n/u)
      .filter((ref) => ref !== 'refs/remotes/origin/HEAD' && ref !== '');
    const currentMainPresent = allRefsResult.stdout.split(/\r?\n/u).some((ref) => (
      ref === 'refs/heads/current-main' || ref === 'refs/remotes/origin/current-main'
    ));
    const hardlinks = hardlinkAudit(clonePath);
    Object.assign(report.literal_clean_clone, {
      transport: 'LOCAL_SOURCE_NO_LOCAL_NO_HARDLINKS_SINGLE_BRANCH',
      source_repository: ROOT,
      clone_command: clone.record.command,
      checkout_command: detach.record.command,
      detached_head: detachedHead.stdout.trim(),
      detached_symbolic_ref_probe_exit_code: symbolicHead.record.exit_code,
      local_branch_refs: localRefs,
      remote_tracking_branch_refs: remoteRefs,
      branch_ref_count: localRefs.length,
      remote_tracking_branch_ref_count: remoteRefs.length,
      fetch_refspec: fetchResult.stdout.trim(),
      worktree_porcelain_sha256: worktreeResult.record.stdout_sha256,
      shallow: shallowResult.stdout.trim() === 'true',
      current_main_ref_present: currentMainPresent,
      local_current_main_probe_exit_code: localCurrentMain.record.exit_code,
      remote_current_main_probe_exit_code: remoteCurrentMain.record.exit_code,
      dashboard_donor_object_probe_exit_code: dashboardObject.record.exit_code,
      preverify_object_probe_exit_code: preverifyObject.record.exit_code,
      reachable_merge_donor_probe_exit_code: mergeDonorObject.record.exit_code,
      hardlink_audit: hardlinks,
    });
    const topologyValid = detachedHead.stdout.trim() === candidate
      && symbolicHead.record.exit_code === 1
      && JSON.stringify(localRefs) === JSON.stringify([`refs/heads/${BRANCH}`])
      && JSON.stringify(remoteRefs) === JSON.stringify([`refs/remotes/origin/${BRANCH}`])
      && fetchResult.stdout.trim() === `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`
      && shallowResult.stdout.trim() === 'false'
      && !currentMainPresent
      && localCurrentMain.record.exit_code === 1
      && remoteCurrentMain.record.exit_code === 1
      && dashboardObject.record.exit_code === 128
      && preverifyObject.record.exit_code === 128
      && mergeDonorObject.record.exit_code === 0
      && hardlinks.passed === true;
    if (!topologyValid) failClosed(detachedHead.record, 'LITERAL_CLEAN_CLONE_TOPOLOGY_INVALID');

    await runBattery(clonePath, 'CLEAN_CLONE');
    report.literal_clean_clone.donor_evidence = await donorModeDiagnostic(
      clonePath,
      'TRACKED_RECEIPT_SINGLE_BRANCH',
      report.literal_clean_clone.diagnostic_commands,
    );
    const cloneClean = await capture('git', ['status', '--porcelain=v1'], { cwd: clonePath });
    report.literal_clean_clone.topology_commands.push(cloneClean.record);
    requirePassing(cloneClean);
    report.literal_clean_clone.final_clean = cloneClean.stdout.trim() === '';
    if (!report.literal_clean_clone.final_clean) {
      failClosed(cloneClean.record, 'LITERAL_CLEAN_CLONE_NOT_CLEAN_AFTER_BATTERY');
    }
    report.literal_clean_clone.result = 'BUILDER_LOCAL_SOURCE_PASS_NOT_FINAL_LIVE_REMOTE';
  } finally {
    if (cloneTempRoot !== null && existsSync(cloneTempRoot)) {
      const startedAt = new Date().toISOString();
      rmSync(cloneTempRoot, { recursive: true, force: true });
      report.literal_clean_clone.cleanup_actions.push({
        action: `rmSync(${cloneTempRoot})`,
        started_at_utc: startedAt,
        ended_at_utc: new Date().toISOString(),
        exit_code: 0,
        test_count: 0,
        output_sha256: sha256(Buffer.alloc(0)),
      });
    }
    flushReport();
  }

  report.current_main.after = await currentMainSnapshot(report.preflight.commands);
  report.current_main.changed_during_gate = JSON.stringify(report.current_main.before)
    !== JSON.stringify(report.current_main.after);
  if (report.current_main.changed_during_gate) failClosed(null, 'CURRENT_MAIN_REF_CHANGED_DURING_LOCAL_GATE');
  const finalBranch = await capture('git', ['rev-parse', `refs/heads/${BRANCH}`]);
  report.preflight.commands.push(finalBranch.record);
  requirePassing(finalBranch);
  if (finalBranch.stdout.trim() !== candidate) {
    failClosed(finalBranch.record, 'C3_BRANCH_MOVED_DURING_LOCAL_GATE');
  }

  report.all_local_required_commands_passed = report.census.result
      === 'PASS_LIVE_GIT_DERIVED_WITH_REMOVED_SAFE_TOMBSTONES'
    && report.canonical_gate.result === 'PASS'
    && report.literal_clean_clone.result === 'BUILDER_LOCAL_SOURCE_PASS_NOT_FINAL_LIVE_REMOTE'
    && report.canonical_gate.final_clean === true
    && report.literal_clean_clone.final_clean === true
    && report.literal_clean_clone.hardlink_audit?.passed === true
    && report.literal_clean_clone.current_main_ref_present === false
    && report.current_main.changed_during_gate === false;
  if (!report.all_local_required_commands_passed) failClosed(null, 'C3_LOCAL_GATE_AGGREGATE_FALSE');
  report.completed_at_utc = new Date().toISOString();
  report.failure = null;
  flushReport();
  process.stdout.write(`${JSON.stringify({
    c3: candidate,
    c2: C2,
    canonical_gate: report.canonical_gate.result,
    literal_clean_clone: report.literal_clean_clone.result,
    census: report.census.result,
    custody: report.custody.status,
    report: REPORT_RELATIVE,
  })}\n`);
}

main().catch((error) => {
  if (report.failure === null) {
    report.failure = {
      command: 'INTERNAL_EVIDENCE_VALIDATION',
      exit_code: 1,
      first_causal_error: error instanceof Error ? error.message : String(error),
      affected_evidence_path: REPORT_RELATIVE,
      observed_at_utc: new Date().toISOString(),
    };
    flushReport();
  }
  process.stderr.write(`[c3-local] PRECISE_BLOCKED ${JSON.stringify(report.failure)}\n`);
  process.exitCode = 1;
});
