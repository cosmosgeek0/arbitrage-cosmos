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
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const REPORT_PATH = resolve(OUT, 'C4_LOCAL_GATE_REPORT.json');
const C2 = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
const C4 = '4c9143a0bcc331aa170e9e26b741240b39df8b9e';
const C4_BRANCH = 'codex/truth-campaign-c4-20260717';

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

function outputTail(value, maximumLines = 120) {
  return value.split(/\r?\n/u).filter(Boolean).slice(-maximumLines);
}

function testEvidence(output) {
  const summaries = [];
  const skipMarkers = [];
  for (const line of output.split(/\r?\n/u)) {
    let match = line.match(/^\s*(?:#|ℹ|i)\s*tests\s+(\d+)\s*$/iu);
    if (match !== null) summaries.push({ line: line.trim(), count: Number(match[1]) });
    match = line.match(/^\s*Tests:\s*(\d+)\s+passed(?:,\s*(\d+)\s+total)?/iu);
    if (match !== null) summaries.push({ line: line.trim(), count: Number(match[2] ?? match[1]) });
    match = line.match(/^\s*(?:#|ℹ|i)\s*(skipped|todo)\s+(\d+)\s*$/iu);
    if (match !== null && Number(match[2]) > 0) skipMarkers.push(line.trim());
    if (/^\s*(?:not\s+)?ok\b.*#\s*(?:SKIP|TODO)\b/iu.test(line)) skipMarkers.push(line.trim());
  }
  return {
    test_count: summaries.reduce((total, entry) => total + entry.count, 0) || null,
    test_count_basis: summaries.length > 0 ? 'SUM_OF_EXACT_EMITTED_TEST_SUMMARY_COUNTS' : 'NONE_EMITTED',
    explicit_test_summaries: summaries,
    unexpected_skip_markers: [...new Set(skipMarkers)],
  };
}

function firstCausalError(stdout, stderr) {
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
  process.stderr.write(`[c4-local] START ${rendered}\n`);
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
    process.stderr.write(`[c4-local] RUNNING ${rendered}\n`);
  }, 30_000);
  const { exitCode, signal } = await new Promise((accept, reject) => {
    child.on('error', reject);
    child.on('close', (code, closeSignal) => accept({ exitCode: code ?? 1, signal: closeSignal }));
  });
  clearInterval(heartbeat);
  const stdoutBytes = Buffer.concat(stdoutChunks);
  const stderrBytes = Buffer.concat(stderrChunks);
  const stdout = stdoutBytes.toString('utf8');
  const stderr = stderrBytes.toString('utf8');
  const evidence = kind === 'test' ? testEvidence(`${stdout}\n${stderr}`) : {
    test_count: 0,
    test_count_basis: 'NOT_A_TEST_COMMAND',
    explicit_test_summaries: [],
    unexpected_skip_markers: [],
  };
  const record = {
    command: rendered,
    argv: [command, ...args],
    cwd,
    kind,
    started_at_utc: startedAt,
    ended_at_utc: new Date().toISOString(),
    exit_code: exitCode,
    signal,
    expected_exit_codes: expectedExitCodes,
    exit_code_expected: expectedExitCodes.includes(exitCode),
    stdout_sha256: sha256(stdoutBytes),
    stderr_sha256: sha256(stderrBytes),
    output_sha256: sha256(Buffer.concat([stdoutBytes, stderrBytes])),
    output_digest_rule: 'SHA256_OF_STDOUT_BYTES_THEN_STDERR_BYTES',
    stdout_byte_length: stdoutBytes.length,
    stderr_byte_length: stderrBytes.length,
    ...evidence,
  };
  if (!record.exit_code_expected) {
    record.first_causal_error = firstCausalError(stdout, stderr);
    record.stdout_tail = outputTail(stdout);
    record.stderr_tail = outputTail(stderr);
  }
  process.stderr.write(`[c4-local] END exit=${exitCode} output=${record.output_sha256} ${rendered}\n`);
  return { record, stdout, stderr };
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
  const objectRoot = resolve(clonePath, '.git/objects');
  const files = listObjectFiles(objectRoot);
  const linked = files.filter((file) => statSync(file).nlink > 1);
  const alternatesPath = resolve(objectRoot, 'info/alternates');
  return {
    clone_flags: ['--no-local', '--no-hardlinks', '--single-branch'],
    object_files_checked: files.length,
    max_link_count: files.reduce((maximum, file) => Math.max(maximum, statSync(file).nlink), 0),
    hardlinked_object_file_count: linked.length,
    alternates_present: existsSync(alternatesPath),
    passed: files.length > 0 && linked.length === 0 && !existsSync(alternatesPath),
  };
}

function statusPaths(output) {
  return output.split('\0').filter(Boolean).map((entry) => {
    const pathValue = entry.slice(3);
    const arrow = pathValue.lastIndexOf(' -> ');
    return arrow === -1 ? pathValue : pathValue.slice(arrow + 4);
  }).sort();
}

function commandPass(record) {
  return record.exit_code_expected === true
    && (record.kind !== 'test' || record.unexpected_skip_markers.length === 0);
}

async function runBattery(directory, target) {
  const commands = [
    ['npm', ['ci'], 'install'],
    ['npm', ['run', 'typecheck'], 'check'],
    ['npm', ['run', 'build'], 'check'],
    ['npm', ['run', 'test:product-integration:built'], 'test'],
    ['npm', ['run', 'test:product-control:built'], 'test'],
    ['npm', ['run', 'test:i00:commands'], 'test'],
    ['npm', ['test'], 'test'],
    ['npm', ['run', 'test:all'], 'test'],
  ];
  for (const [command, args, kind] of commands) {
    const result = await capture(command, args, { cwd: directory, kind });
    target.commands.push(result.record);
  }
  target.command_count = target.commands.length;
  target.passed_command_count = target.commands.filter(commandPass).length;
  target.failed_commands = target.commands.filter((record) => !commandPass(record)).map((record) => ({
    command: record.command,
    exit_code: record.exit_code,
    first_causal_error: record.first_causal_error ?? null,
    output_sha256: record.output_sha256,
  }));
  target.result = target.failed_commands.length === 0 ? 'PASS' : 'FAIL';
}

async function refSnapshot() {
  const local = await capture('git', ['rev-parse', 'refs/heads/current-main'], { expectedExitCodes: [0, 128] });
  const remote = await capture('git', ['rev-parse', 'refs/remotes/origin/current-main'], { expectedExitCodes: [0, 128] });
  return {
    local: local.record.exit_code === 0 ? local.stdout.trim() : null,
    cached_origin: remote.record.exit_code === 0 ? remote.stdout.trim() : null,
    commands: [local.record, remote.record],
  };
}

const report = {
  schema: 'product-truth-c4-pre-custody-local-gate.v1',
  generated_at_utc: new Date().toISOString(),
  actor_role: 'ACCOUNT_A_CANDIDATE_WRITER',
  independent: false,
  independent_token_issued: false,
  source_candidate: {
    c4: C4,
    c4_tree: null,
    immutable_c2: C2,
    expected_direct_parent: C2,
    observed_parents: [],
    parent_count: null,
    direct_parent_equality: false,
    source_branch: C4_BRANCH,
  },
  preflight: { commands: [], result: 'NOT_RUN' },
  census: { commands: [], result: 'NOT_RUN' },
  canonical_gate: { setup_commands: [], commands: [], cleanup_commands: [], result: 'NOT_RUN' },
  literal_local_single_branch: {
    setup_commands: [],
    topology_commands: [],
    commands: [],
    cleanup_actions: [],
    result: 'NOT_RUN',
  },
  current_main: { before: null, after: null, changed_during_gate: null },
  all_local_required_commands_passed: false,
  custody: {
    status: 'WITHHELD_PENDING_LOCAL_GATE',
    token_issued: false,
    c2_or_c3_custody_transfers_to_c4: false,
    live_remote_clean_clone_run: false,
    bundle_receipt_recorded: false,
  },
  blockers: [],
};

function flush() {
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

let canonicalPath = null;
let cloneTempRoot = null;

async function main() {
  flush();
  const tree = await capture('git', ['rev-parse', `${C4}^{tree}`]);
  const parents = await capture('git', ['show', '-s', '--format=%P', C4]);
  const sourceBranch = await capture('git', ['rev-parse', `refs/heads/${C4_BRANCH}`]);
  const dirty = await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  report.preflight.commands.push(tree.record, parents.record, sourceBranch.record, dirty.record);
  report.source_candidate.c4_tree = tree.stdout.trim();
  report.source_candidate.observed_parents = parents.stdout.trim().split(/\s+/u).filter(Boolean);
  report.source_candidate.parent_count = report.source_candidate.observed_parents.length;
  report.source_candidate.direct_parent_equality = report.source_candidate.parent_count === 1
    && report.source_candidate.observed_parents[0] === C2;
  report.source_candidate.source_branch_exact = sourceBranch.stdout.trim() === C4;
  report.preflight.dirty_paths = statusPaths(dirty.stdout);
  report.preflight.out_of_scope_dirty_paths = report.preflight.dirty_paths.filter((pathValue) => (
    !pathValue.startsWith('verification/product-truth-20260716/')
  ));
  report.preflight.result = report.source_candidate.direct_parent_equality
    && report.source_candidate.source_branch_exact
    && report.preflight.out_of_scope_dirty_paths.length === 0
    ? 'PASS'
    : 'FAIL';
  report.current_main.before = await refSnapshot();
  flush();

  const census = await capture('node', [
    'verification/product-truth-20260716/generate-worktree-census.mjs',
    C4,
  ]);
  report.census.commands.push(census.record);
  if (census.record.exit_code === 0) {
    const censusPath = resolve(OUT, 'WORKTREE_CENSUS.json');
    const bytes = readFileSync(censusPath);
    const parsed = JSON.parse(bytes.toString('utf8'));
    report.census.artifact = {
      path: 'verification/product-truth-20260716/WORKTREE_CENSUS.json',
      sha256: sha256(bytes),
      byte_length: bytes.length,
      candidate_sha: parsed.candidate_sha,
      candidate_tree_sha: parsed.candidate_tree_sha,
      registered_worktree_count: parsed.registered_worktree_count,
      expected_registered_worktree_count: parsed.expected_registered_worktree_count,
      unknown_count: parsed.unknown_count,
      classification_counts: parsed.classification_counts,
    };
    report.census.result = parsed.candidate_sha === C4
      && parsed.candidate_tree_sha === report.source_candidate.c4_tree
      && parsed.registered_worktree_count === parsed.expected_registered_worktree_count
      && parsed.unknown_count === 0
      ? 'PASS_LIVE_GIT_DERIVED'
      : 'FAIL';
  } else {
    report.census.result = 'FAIL';
  }
  flush();

  canonicalPath = mkdtempSync(resolve(dirname(ROOT), '.truth-a-c4-canonical-'));
  rmSync(canonicalPath, { recursive: true, force: true });
  const addWorktree = await capture('git', ['worktree', 'add', '--detach', canonicalPath, C4]);
  report.canonical_gate.setup_commands.push(addWorktree.record);
  if (addWorktree.record.exit_code === 0) {
    try {
      const head = await capture('git', ['rev-parse', 'HEAD'], { cwd: canonicalPath });
      const cleanBefore = await capture('git', ['status', '--porcelain=v1'], { cwd: canonicalPath });
      report.canonical_gate.setup_commands.push(head.record, cleanBefore.record);
      report.canonical_gate.detached_head = head.stdout.trim();
      report.canonical_gate.initial_clean = cleanBefore.stdout.trim() === '';
      await runBattery(canonicalPath, report.canonical_gate);
      const cleanAfter = await capture('git', ['status', '--porcelain=v1'], { cwd: canonicalPath });
      report.canonical_gate.setup_commands.push(cleanAfter.record);
      report.canonical_gate.final_clean = cleanAfter.stdout.trim() === '';
      if (head.stdout.trim() !== C4 || !report.canonical_gate.initial_clean || !report.canonical_gate.final_clean) {
        report.canonical_gate.result = 'FAIL';
      }
    } finally {
      const removeWorktree = await capture('git', ['worktree', 'remove', '--force', canonicalPath]);
      report.canonical_gate.cleanup_commands.push(removeWorktree.record);
      flush();
    }
  } else {
    report.canonical_gate.result = 'FAIL_SETUP';
  }

  cloneTempRoot = mkdtempSync(resolve(tmpdir(), 'truth-a-c4-local-single-branch-'));
  const clonePath = resolve(cloneTempRoot, 'clone');
  const clone = await capture('git', [
    'clone',
    '--no-local',
    '--no-hardlinks',
    '--single-branch',
    '--branch',
    C4_BRANCH,
    ROOT,
    clonePath,
  ]);
  report.literal_local_single_branch.setup_commands.push(clone.record);
  if (clone.record.exit_code === 0) {
    try {
      const detach = await capture('git', ['checkout', '--detach', C4], { cwd: clonePath });
      report.literal_local_single_branch.setup_commands.push(detach.record);
      const probes = [
        await capture('git', ['rev-parse', 'HEAD'], { cwd: clonePath }),
        await capture('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: clonePath, expectedExitCodes: [1] }),
        await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: clonePath }),
        await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], { cwd: clonePath }),
        await capture('git', ['config', '--get-all', 'remote.origin.fetch'], { cwd: clonePath }),
        await capture('git', ['rev-parse', '--is-shallow-repository'], { cwd: clonePath }),
        await capture('git', ['show-ref', '--verify', '--quiet', 'refs/heads/current-main'], { cwd: clonePath, expectedExitCodes: [1] }),
        await capture('git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/current-main'], { cwd: clonePath, expectedExitCodes: [1] }),
      ];
      report.literal_local_single_branch.topology_commands.push(...probes.map((result) => result.record));
      const [head, symbolic, localRefsResult, remoteRefsResult, fetchResult, shallowResult,
        localCurrentMain, remoteCurrentMain] = probes;
      const localRefs = localRefsResult.stdout.trim().split(/\r?\n/u).filter(Boolean);
      const remoteRefs = remoteRefsResult.stdout.trim().split(/\r?\n/u)
        .filter((ref) => ref !== 'refs/remotes/origin/HEAD' && ref !== '');
      const hardlinks = hardlinkAudit(clonePath);
      Object.assign(report.literal_local_single_branch, {
        transport: 'LOCAL_SOURCE_NO_LOCAL_NO_HARDLINKS_SINGLE_BRANCH',
        source_repository: ROOT,
        detached_head: head.stdout.trim(),
        detached_symbolic_ref_probe_exit_code: symbolic.record.exit_code,
        local_branch_refs: localRefs,
        remote_tracking_branch_refs: remoteRefs,
        fetch_refspec: fetchResult.stdout.trim(),
        shallow: shallowResult.stdout.trim() === 'true',
        current_main_ref_present: localCurrentMain.record.exit_code === 0
          || remoteCurrentMain.record.exit_code === 0,
        hardlink_audit: hardlinks,
      });
      report.literal_local_single_branch.topology_passed = head.stdout.trim() === C4
        && symbolic.record.exit_code === 1
        && JSON.stringify(localRefs) === JSON.stringify([`refs/heads/${C4_BRANCH}`])
        && JSON.stringify(remoteRefs) === JSON.stringify([`refs/remotes/origin/${C4_BRANCH}`])
        && fetchResult.stdout.trim() === `+refs/heads/${C4_BRANCH}:refs/remotes/origin/${C4_BRANCH}`
        && shallowResult.stdout.trim() === 'false'
        && !report.literal_local_single_branch.current_main_ref_present
        && hardlinks.passed === true;
      await runBattery(clonePath, report.literal_local_single_branch);
      const clean = await capture('git', ['status', '--porcelain=v1'], { cwd: clonePath });
      report.literal_local_single_branch.topology_commands.push(clean.record);
      report.literal_local_single_branch.final_clean = clean.stdout.trim() === '';
      if (!report.literal_local_single_branch.topology_passed
          || !report.literal_local_single_branch.final_clean
          || report.literal_local_single_branch.failed_commands.length > 0) {
        report.literal_local_single_branch.result = 'FAIL';
      } else {
        report.literal_local_single_branch.result = 'PASS_BUILDER_LOCAL_SOURCE_NOT_LIVE_REMOTE';
      }
    } finally {
      const startedAt = new Date().toISOString();
      rmSync(cloneTempRoot, { recursive: true, force: true });
      report.literal_local_single_branch.cleanup_actions.push({
        action: 'REMOVE_CONTROLLED_TEMP_CLONE',
        path: cloneTempRoot,
        started_at_utc: startedAt,
        ended_at_utc: new Date().toISOString(),
        exit_code: 0,
      });
      flush();
    }
  } else {
    report.literal_local_single_branch.result = 'FAIL_SETUP';
  }

  report.current_main.after = await refSnapshot();
  report.current_main.changed_during_gate = JSON.stringify({
    local: report.current_main.before.local,
    cached_origin: report.current_main.before.cached_origin,
  }) !== JSON.stringify({
    local: report.current_main.after.local,
    cached_origin: report.current_main.after.cached_origin,
  });
  report.all_local_required_commands_passed = report.preflight.result === 'PASS'
    && report.census.result === 'PASS_LIVE_GIT_DERIVED'
    && report.canonical_gate.result === 'PASS'
    && report.literal_local_single_branch.result === 'PASS_BUILDER_LOCAL_SOURCE_NOT_LIVE_REMOTE'
    && report.current_main.changed_during_gate === false;
  report.blockers = [
    ...report.canonical_gate.failed_commands.map((entry) => ({ phase: 'CANONICAL', ...entry })),
    ...report.literal_local_single_branch.failed_commands.map((entry) => ({ phase: 'LOCAL_SINGLE_BRANCH', ...entry })),
  ];
  if (report.preflight.result !== 'PASS') report.blockers.push({ phase: 'PREFLIGHT', code: 'PREFLIGHT_FAILED' });
  if (report.census.result !== 'PASS_LIVE_GIT_DERIVED') report.blockers.push({ phase: 'CENSUS', code: 'CENSUS_FAILED' });
  if (report.current_main.changed_during_gate) report.blockers.push({ phase: 'CURRENT_MAIN', code: 'REF_CHANGED' });
  report.custody.status = report.all_local_required_commands_passed
    ? 'C4_CUSTODY_REQUIRED_NOT_ATTEMPTED'
    : 'WITHHELD_C4_LOCAL_GATE_REJECTED';
  report.custody.token_issued = false;
  report.completed_at_utc = new Date().toISOString();
  flush();

  process.stdout.write(`${JSON.stringify({
    c4: C4,
    c2: C2,
    canonical_gate: report.canonical_gate.result,
    literal_local_single_branch: report.literal_local_single_branch.result,
    census: report.census.result,
    all_local_required_commands_passed: report.all_local_required_commands_passed,
    custody: report.custody.status,
    blockers: report.blockers.length,
    report: 'verification/product-truth-20260716/C4_LOCAL_GATE_REPORT.json',
  })}\n`);
  if (!report.all_local_required_commands_passed) process.exitCode = 1;
}

main().catch((error) => {
  report.blockers.push({
    phase: 'INTERNAL',
    code: error instanceof Error ? error.message : String(error),
  });
  report.custody.status = 'WITHHELD_C4_LOCAL_GATE_ERROR';
  report.custody.token_issued = false;
  report.completed_at_utc = new Date().toISOString();
  flush();
  process.stderr.write(`[c4-local] PRECISE_BLOCKED ${JSON.stringify(report.blockers.at(-1))}\n`);
  process.exitCode = 1;
});
