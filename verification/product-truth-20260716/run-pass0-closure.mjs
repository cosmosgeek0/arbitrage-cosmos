#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const REPORT_PATH = resolve(OUT, 'C2_GATE_REPORT.json');
const CUSTODY_PATH = resolve(OUT, 'C2_CUSTODY_RECEIPT.json');
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BRANCH = 'truth-campaign-20260716';
const REMOTE = 'origin';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const candidate = argument('--candidate');
const bundlePath = argument('--bundle');
if (!FULL_SHA.test(candidate ?? '')) throw new Error('EXACT_FULL_CANDIDATE_SHA_REQUIRED');
if (bundlePath === null || !existsSync(bundlePath)) throw new Error('EXISTING_BACKUP_BUNDLE_REQUIRED');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileSha256(path) {
  const hash = createHash('sha256');
  await new Promise((accept, reject) => {
    const input = createReadStream(path);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', accept);
  });
  return hash.digest('hex');
}

function shellWord(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandText(command, args) {
  return [command, ...args].map(shellWord).join(' ');
}

function emittedTestEvidence(output) {
  const lines = output.split(/\r?\n/u);
  const explicitSummaries = [];
  const passingRatios = [];
  const skipSummaries = [];
  const unexpectedSkipMarkers = [];

  for (const line of lines) {
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
    passingRatios.map((row) => [`${row.line}\u0000${row.passed}\u0000${row.total}`, row]),
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

function outputTail(text, maximumLines = 80) {
  return text.split(/\r?\n/u).filter(Boolean).slice(-maximumLines);
}

async function capture(command, args, {
  cwd = ROOT,
  kind = 'probe',
  expectedExitCodes = [0],
} = {}) {
  const rendered = commandText(command, args);
  const startedAt = new Date().toISOString();
  process.stderr.write(`[pass0] START ${rendered}\n`);
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
    process.stderr.write(`[pass0] RUNNING ${rendered}\n`);
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
  process.stderr.write(`[pass0] END exit=${exitCode} output=${record.output_sha256} ${rendered}\n`);
  return { record, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
}

function parseSingleSha(output, label) {
  const value = output.trim();
  if (!FULL_SHA.test(value)) throw new Error(`${label}_INVALID:${value}`);
  return value;
}

function parseSingleRemoteRef(output, expectedRef, label) {
  const rows = output.trim().split(/\r?\n/u).filter(Boolean);
  if (rows.length !== 1) throw new Error(`${label}_ROW_COUNT:${rows.length}`);
  const [head, ref, ...extra] = rows[0].split(/\s+/u);
  if (!FULL_SHA.test(head ?? '') || ref !== expectedRef || extra.length !== 0) {
    throw new Error(`${label}_INVALID:${rows[0]}`);
  }
  return head;
}

function parseStatusPaths(output) {
  return output.split('\0').filter(Boolean).map((entry) => {
    const path = entry.slice(3);
    const arrow = path.lastIndexOf(' -> ');
    return arrow >= 0 ? path.slice(arrow + 4) : path;
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
  const objectRoot = resolve(clonePath, '.git/objects');
  const files = listObjectFiles(objectRoot);
  const linked = files.filter((file) => statSync(file).nlink > 1);
  const maxLinkCount = files.reduce((maximum, file) => Math.max(maximum, statSync(file).nlink), 0);
  const alternates = resolve(objectRoot, 'info/alternates');
  return {
    requested_clone_flag: '--no-hardlinks',
    object_files_checked: files.length,
    max_link_count: maxLinkCount,
    hardlinked_object_file_count: linked.length,
    hardlinked_object_files: linked.map((file) => file.slice(clonePath.length + 1)),
    alternates_present: existsSync(alternates),
    passed: files.length > 0 && linked.length === 0 && !existsSync(alternates),
  };
}

function priorAttemptHistory() {
  if (!existsSync(REPORT_PATH)) return [];
  const previous = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  if (previous.schema !== 'product-truth-c2-gate-report.v1'
      || previous.candidate?.commit !== candidate) return [];
  const compact = {
    generated_at_utc: previous.generated_at_utc,
    completed_at_utc: previous.completed_at_utc ?? null,
    failure: previous.failure,
    all_required_commands_passed: previous.all_required_commands_passed,
    canonical_gate_result: previous.canonical_gate_result,
    clean_clone_result: previous.clean_clone_result,
    preflight_commands: previous.preflight?.commands ?? [],
    local_setup_commands: previous.local_checkout?.setup_commands ?? [],
    local_commands: previous.local_checkout?.commands ?? [],
    local_diagnostic_commands: previous.local_checkout?.diagnostic_commands ?? [],
    local_cleanup_commands: previous.local_checkout?.cleanup_commands ?? [],
    fresh_setup_commands: previous.fresh_single_branch_clone?.setup_commands ?? [],
    fresh_commands: previous.fresh_single_branch_clone?.commands ?? [],
    fresh_diagnostic_commands: previous.fresh_single_branch_clone?.diagnostic_commands ?? [],
    fresh_topology_commands: previous.fresh_single_branch_clone?.topology_commands ?? [],
  };
  return [...(previous.prior_attempts ?? []), compact].slice(-5);
}

const report = {
  schema: 'product-truth-c2-gate-report.v1',
  generated_at_utc: new Date().toISOString(),
  actor_role: 'ACCOUNT_A_CANDIDATE_WRITER',
  independent: false,
  independent_token_issued: false,
  candidate: { commit: candidate, tree: null, parent: null, branch: BRANCH },
  evidence_path: 'verification/product-truth-20260716/C2_GATE_REPORT.json',
  prior_attempts: priorAttemptHistory(),
  preflight: { commands: [] },
  custody: null,
  local_checkout: { setup_commands: [], commands: [], diagnostic_commands: [], cleanup_commands: [] },
  fresh_single_branch_clone: {
    setup_commands: [], commands: [], diagnostic_commands: [], topology_commands: [], cleanup_actions: [],
  },
  current_main: {},
  all_required_commands_passed: false,
  canonical_gate_result: 'NOT_RUN',
  clean_clone_result: 'NOT_RUN',
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
    affected_evidence_path: 'verification/product-truth-20260716/C2_GATE_REPORT.json',
    observed_at_utc: new Date().toISOString(),
  };
  flushReport();
  throw new Error(causalError);
}

function requirePassingCommand(result, { requireTestEvidence = false } = {}) {
  const { record, stderr, stdout } = result;
  if (!record.exit_code_expected) failClosed(record, firstCausalError(stderr, stdout));
  if (!SHA256.test(record.output_sha256)) failClosed(record, 'OUTPUT_DIGEST_MISSING_OR_INVALID');
  if (requireTestEvidence && (record.test_count === null || record.test_count <= 0)) {
    failClosed(record, 'MISSING_EXACT_TEST_COUNT_EVIDENCE');
  }
  if (requireTestEvidence && record.unexpected_skip_markers.length > 0) {
    failClosed(record, `UNEXPECTED_TEST_SKIP:${record.unexpected_skip_markers[0]}`);
  }
}

async function snapshotCurrentMain(prefix) {
  const local = await capture('git', ['rev-parse', 'refs/heads/current-main']);
  const cachedOrigin = await capture('git', ['rev-parse', 'refs/remotes/origin/current-main']);
  const liveOrigin = await capture('git', ['ls-remote', '--exit-code', '--refs', REMOTE, 'refs/heads/current-main']);
  report.preflight.commands.push(local.record, cachedOrigin.record, liveOrigin.record);
  requirePassingCommand(local);
  requirePassingCommand(cachedOrigin);
  requirePassingCommand(liveOrigin);
  const snapshot = {
    local: parseSingleSha(local.stdout, `${prefix}_CURRENT_MAIN_LOCAL`),
    cached_origin: parseSingleSha(cachedOrigin.stdout, `${prefix}_CURRENT_MAIN_CACHED_ORIGIN`),
    live_origin: parseSingleRemoteRef(liveOrigin.stdout, 'refs/heads/current-main', `${prefix}_CURRENT_MAIN_LIVE_ORIGIN`),
  };
  return snapshot;
}

async function runTestBattery(directory, commandRows, diagnosticRows, phase) {
  const install = await capture('npm', ['ci'], { cwd: directory, kind: 'install' });
  commandRows.push(install.record);
  requirePassingCommand(install);

  const rootTest = await capture('npm', ['test'], { cwd: directory, kind: 'test' });
  commandRows.push(rootTest.record);
  requirePassingCommand(rootTest, { requireTestEvidence: true });

  const fullTest = await capture('npm', ['run', 'test:all'], { cwd: directory, kind: 'test' });
  commandRows.push(fullTest.record);
  if (!fullTest.record.exit_code_expected) {
    if (phase === 'CANONICAL') report.canonical_gate_result = 'BLOCKED';
    if (phase === 'CLEAN_CLONE') report.clean_clone_result = 'BLOCKED';
    const donorDiagnostic = await capture(
      'node', ['test/i00/donor-equality.mjs', '--candidate-ref', 'HEAD'],
      { cwd: directory, expectedExitCodes: [0, 1] },
    );
    diagnosticRows.push(donorDiagnostic.record);
    let donorFailure = null;
    try {
      const proof = JSON.parse(donorDiagnostic.stdout);
      donorFailure = proof.status === 'BLOCKED' && Array.isArray(proof.failures)
        ? proof.failures[0] ?? null
        : null;
    } catch {
      donorFailure = null;
    }
    failClosed(
      fullTest.record,
      donorFailure === null
        ? firstCausalError(fullTest.stderr, fullTest.stdout)
        : `DONOR_EQUALITY_BLOCKED:${donorFailure}`,
    );
  }
  requirePassingCommand(fullTest, { requireTestEvidence: true });
}

let canonicalTempRoot = null;
let canonicalPath = null;
let cloneTempRoot = null;
let clonePath = null;

async function main() {
  flushReport();

  const branchResult = await capture('git', ['branch', '--show-current']);
  const headResult = await capture('git', ['rev-parse', 'HEAD']);
  const treeResult = await capture('git', ['rev-parse', `${candidate}^{tree}`]);
  const parentResult = await capture('git', ['rev-parse', `${candidate}^`]);
  const statusResult = await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  report.preflight.commands.push(
    branchResult.record, headResult.record, treeResult.record, parentResult.record, statusResult.record,
  );
  for (const result of [branchResult, headResult, treeResult, parentResult, statusResult]) requirePassingCommand(result);

  if (branchResult.stdout.trim() !== BRANCH) failClosed(branchResult.record, `WRONG_BRANCH:${branchResult.stdout.trim()}`);
  if (headResult.stdout.trim() !== candidate) failClosed(headResult.record, `HEAD_NOT_EXACT_C2:${headResult.stdout.trim()}`);
  const dirtyPaths = parseStatusPaths(statusResult.stdout);
  const outOfScopeDirty = dirtyPaths.filter((path) => !path.startsWith('verification/product-truth-20260716/'));
  if (outOfScopeDirty.length > 0) failClosed(statusResult.record, `OUT_OF_SCOPE_DIRTY_PATH:${outOfScopeDirty[0]}`);
  report.preflight.dirty_paths = dirtyPaths;
  report.preflight.out_of_scope_dirty_paths = outOfScopeDirty;
  report.candidate.tree = parseSingleSha(treeResult.stdout, 'CANDIDATE_TREE');
  report.candidate.parent = parseSingleSha(parentResult.stdout, 'CANDIDATE_PARENT');

  const currentMainBefore = await snapshotCurrentMain('BEFORE');
  report.current_main.before_local = currentMainBefore.local;
  report.current_main.before_origin = currentMainBefore.cached_origin;
  report.current_main.before_live_origin = currentMainBefore.live_origin;

  const originUrlResult = await capture('git', ['remote', 'get-url', REMOTE]);
  const remoteCandidateResult = await capture(
    'git', ['ls-remote', '--exit-code', '--refs', REMOTE, `refs/heads/${BRANCH}`],
  );
  const bundleVerifyResult = await capture('git', ['bundle', 'verify', '--quiet', bundlePath]);
  const bundleHeadResult = await capture(
    'git', ['bundle', 'list-heads', bundlePath, `refs/heads/${BRANCH}`],
  );
  for (const result of [originUrlResult, remoteCandidateResult, bundleVerifyResult, bundleHeadResult]) {
    report.preflight.commands.push(result.record);
    requirePassingCommand(result);
  }
  const remoteHead = parseSingleRemoteRef(
    remoteCandidateResult.stdout, `refs/heads/${BRANCH}`, 'LIVE_REMOTE_CANDIDATE',
  );
  const bundleHead = parseSingleRemoteRef(
    bundleHeadResult.stdout, `refs/heads/${BRANCH}`, 'BACKUP_BUNDLE_CANDIDATE',
  );
  if (remoteHead !== candidate) failClosed(remoteCandidateResult.record, `LIVE_REMOTE_NOT_EXACT_C2:${remoteHead}`);
  if (bundleHead !== candidate) failClosed(bundleHeadResult.record, `BACKUP_BUNDLE_NOT_EXACT_C2:${bundleHead}`);

  const bundleStat = statSync(bundlePath);
  const bundleDigest = await fileSha256(bundlePath);
  const custodyReceipt = {
    schema: 'product-truth-c2-custody-receipt.v1',
    generated_at_utc: new Date().toISOString(),
    actor_role: 'ACCOUNT_A_CANDIDATE_WRITER',
    candidate_sha: candidate,
    candidate_tree_sha: report.candidate.tree,
    custody_satisfied: true,
    result: 'VERIFIED_LIVE_REMOTE_BRANCH_AND_BACKUP_BUNDLE_AT_EXACT_C2',
    remote: {
      name: REMOTE,
      url: originUrlResult.stdout.trim(),
      branch: BRANCH,
      ref: `refs/heads/${BRANCH}`,
      observed_head: remoteHead,
      exact_candidate_match: remoteHead === candidate,
      command: remoteCandidateResult.record,
    },
    bundle: {
      path: bundlePath,
      basename: basename(bundlePath),
      byte_length: bundleStat.size,
      modified_at_utc: bundleStat.mtime.toISOString(),
      sha256: bundleDigest,
      verify_result: 'VERIFIED',
      branch_ref: `refs/heads/${BRANCH}`,
      observed_head: bundleHead,
      exact_candidate_match: bundleHead === candidate,
      verify_command: bundleVerifyResult.record,
      list_heads_command: bundleHeadResult.record,
    },
    old_custody_transfer_assumed: false,
    deviations_skips_missing_evidence: [],
  };
  writeFileSync(CUSTODY_PATH, `${JSON.stringify(custodyReceipt, null, 2)}\n`);
  report.custody = {
    result: custodyReceipt.result,
    receipt_path: 'verification/product-truth-20260716/C2_CUSTODY_RECEIPT.json',
    receipt_sha256: sha256(readFileSync(CUSTODY_PATH)),
    remote_head: remoteHead,
    bundle_sha256: bundleDigest,
  };
  flushReport();

  canonicalPath = mkdtempSync(join(resolve(ROOT, '..'), '.truth-a-c2-canonical-'));
  rmSync(canonicalPath, { recursive: true, force: true });
  const worktreeAdd = await capture('git', ['worktree', 'add', '--detach', canonicalPath, candidate]);
  report.local_checkout.setup_commands.push(worktreeAdd.record);
  requirePassingCommand(worktreeAdd);
  try {
    const localHead = await capture('git', ['rev-parse', 'HEAD'], { cwd: canonicalPath });
    report.local_checkout.setup_commands.push(localHead.record);
    requirePassingCommand(localHead);
    if (localHead.stdout.trim() !== candidate) failClosed(localHead.record, `CANONICAL_CHECKOUT_NOT_EXACT_C2:${localHead.stdout.trim()}`);
    report.local_checkout.detached_head = localHead.stdout.trim();
    await runTestBattery(
      canonicalPath,
      report.local_checkout.commands,
      report.local_checkout.diagnostic_commands,
      'CANONICAL',
    );
    const localClean = await capture('git', ['status', '--porcelain=v1'], { cwd: canonicalPath });
    report.local_checkout.setup_commands.push(localClean.record);
    requirePassingCommand(localClean);
    report.local_checkout.final_clean = localClean.stdout.trim() === '';
    if (!report.local_checkout.final_clean) failClosed(localClean.record, 'CANONICAL_CHECKOUT_NOT_CLEAN_AFTER_GATE');
    report.canonical_gate_result = 'PASS';
  } finally {
    if (canonicalPath !== null && existsSync(canonicalPath)) {
      const worktreeRemove = await capture('git', ['worktree', 'remove', '--force', canonicalPath]);
      report.local_checkout.cleanup_commands.push(worktreeRemove.record);
      requirePassingCommand(worktreeRemove);
    }
    if (canonicalTempRoot !== null && existsSync(canonicalTempRoot)) rmSync(canonicalTempRoot, { recursive: true, force: true });
    flushReport();
  }
  flushReport();

  cloneTempRoot = mkdtempSync(join(tmpdir(), 'truth-a-c2-clean-clone-'));
  clonePath = resolve(cloneTempRoot, 'clone');
  const cloneResult = await capture('git', [
    'clone', '--no-hardlinks', '--single-branch', '--branch', BRANCH,
    originUrlResult.stdout.trim(), clonePath,
  ]);
  report.fresh_single_branch_clone.setup_commands.push(cloneResult.record);
  requirePassingCommand(cloneResult);
  try {
    const detach = await capture('git', ['checkout', '--detach', candidate], { cwd: clonePath });
    report.fresh_single_branch_clone.setup_commands.push(detach.record);
    requirePassingCommand(detach);

    const detachedHead = await capture('git', ['rev-parse', 'HEAD'], { cwd: clonePath });
    const localRefs = await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: clonePath });
    const remoteRefs = await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], { cwd: clonePath });
    const allRefs = await capture('git', ['for-each-ref', '--format=%(refname)', 'refs'], { cwd: clonePath });
    const fetchRefspec = await capture('git', ['config', '--get-all', 'remote.origin.fetch'], { cwd: clonePath });
    const localCurrentMain = await capture(
      'git', ['show-ref', '--verify', '--quiet', 'refs/heads/current-main'],
      { cwd: clonePath, expectedExitCodes: [1] },
    );
    const remoteCurrentMain = await capture(
      'git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/current-main'],
      { cwd: clonePath, expectedExitCodes: [1] },
    );
    for (const result of [detachedHead, localRefs, remoteRefs, allRefs, fetchRefspec, localCurrentMain, remoteCurrentMain]) {
      report.fresh_single_branch_clone.topology_commands.push(result.record);
      requirePassingCommand(result);
    }

    const localBranchRefs = localRefs.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const remoteBranchRefs = remoteRefs.stdout.trim().split(/\r?\n/u).filter((ref) => ref !== 'refs/remotes/origin/HEAD');
    const currentMainRefPresent = allRefs.stdout.split(/\r?\n/u).some((ref) => /(?:^|\/)current-main$/u.test(ref));
    const hardlinks = hardlinkAudit(clonePath);
    Object.assign(report.fresh_single_branch_clone, {
      transport: 'LIVE_REMOTE_SINGLE_BRANCH_CLONE_NO_HARDLINKS',
      clone_command: cloneResult.record.command,
      checkout_command: detach.record.command,
      detached_head: detachedHead.stdout.trim(),
      local_branch_refs: localBranchRefs,
      remote_tracking_branch_refs: remoteBranchRefs,
      branch_ref_count: localBranchRefs.length,
      remote_tracking_branch_ref_count: remoteBranchRefs.length,
      fetch_refspec: fetchRefspec.stdout.trim(),
      current_main_ref_present: currentMainRefPresent,
      local_current_main_probe_exit_code: localCurrentMain.record.exit_code,
      remote_current_main_probe_exit_code: remoteCurrentMain.record.exit_code,
      hardlink_audit: hardlinks,
    });
    if (detachedHead.stdout.trim() !== candidate) failClosed(detachedHead.record, `CLEAN_CLONE_NOT_EXACT_C2:${detachedHead.stdout.trim()}`);
    if (localBranchRefs.length !== 1 || localBranchRefs[0] !== `refs/heads/${BRANCH}`) {
      failClosed(localRefs.record, `CLEAN_CLONE_NOT_SINGLE_LOCAL_BRANCH:${localBranchRefs.join(',')}`);
    }
    if (remoteBranchRefs.length !== 1 || remoteBranchRefs[0] !== `refs/remotes/origin/${BRANCH}`) {
      failClosed(remoteRefs.record, `CLEAN_CLONE_NOT_SINGLE_REMOTE_BRANCH:${remoteBranchRefs.join(',')}`);
    }
    if (currentMainRefPresent) failClosed(allRefs.record, 'CLEAN_CLONE_CURRENT_MAIN_PRESENT');
    if (!hardlinks.passed) failClosed(cloneResult.record, 'CLEAN_CLONE_HARDLINK_OR_ALTERNATES_AUDIT_FAILED');

    await runTestBattery(
      clonePath,
      report.fresh_single_branch_clone.commands,
      report.fresh_single_branch_clone.diagnostic_commands,
      'CLEAN_CLONE',
    );
    const cloneClean = await capture('git', ['status', '--porcelain=v1'], { cwd: clonePath });
    report.fresh_single_branch_clone.topology_commands.push(cloneClean.record);
    requirePassingCommand(cloneClean);
    report.fresh_single_branch_clone.final_clean = cloneClean.stdout.trim() === '';
    if (!report.fresh_single_branch_clone.final_clean) failClosed(cloneClean.record, 'CLEAN_CLONE_NOT_CLEAN_AFTER_BATTERY');
    report.clean_clone_result = 'BUILDER_PASS_NOT_INDEPENDENT_WAVE1B';
  } finally {
    if (cloneTempRoot !== null && existsSync(cloneTempRoot)) {
      const startedAt = new Date().toISOString();
      rmSync(cloneTempRoot, { recursive: true, force: true });
      report.fresh_single_branch_clone.cleanup_actions.push({
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

  const currentMainAfter = await snapshotCurrentMain('AFTER');
  report.current_main.after_local = currentMainAfter.local;
  report.current_main.after_origin = currentMainAfter.cached_origin;
  report.current_main.after_live_origin = currentMainAfter.live_origin;
  report.current_main.touched_by_account_a = (
    currentMainBefore.local !== currentMainAfter.local
    || currentMainBefore.cached_origin !== currentMainAfter.cached_origin
    || currentMainBefore.live_origin !== currentMainAfter.live_origin
  );
  if (report.current_main.touched_by_account_a) failClosed(null, 'CURRENT_MAIN_CHANGED_DURING_ACCOUNT_A_GATE');

  report.all_required_commands_passed = report.canonical_gate_result === 'PASS'
    && report.clean_clone_result === 'BUILDER_PASS_NOT_INDEPENDENT_WAVE1B'
    && report.local_checkout.final_clean === true
    && report.fresh_single_branch_clone.final_clean === true
    && report.fresh_single_branch_clone.detached_head === candidate
    && report.fresh_single_branch_clone.current_main_ref_present === false
    && report.fresh_single_branch_clone.hardlink_audit.passed === true
    && report.current_main.touched_by_account_a === false;
  if (!report.all_required_commands_passed) failClosed(null, 'PASS0_GATE_AGGREGATE_FALSE');
  report.completed_at_utc = new Date().toISOString();
  report.failure = null;
  flushReport();
  process.stdout.write(`${JSON.stringify({
    candidate,
    canonical_gate_result: report.canonical_gate_result,
    clean_clone_result: report.clean_clone_result,
    custody_result: report.custody.result,
    report: REPORT_PATH,
  })}\n`);
}

main().catch((error) => {
  if (report.failure === null) {
    report.failure = {
      command: 'INTERNAL_EVIDENCE_VALIDATION',
      exit_code: 1,
      first_causal_error: error instanceof Error ? error.message : String(error),
      affected_evidence_path: 'verification/product-truth-20260716/C2_GATE_REPORT.json',
      observed_at_utc: new Date().toISOString(),
    };
    flushReport();
  }
  process.stderr.write(`[pass0] PRECISE_BLOCKED ${JSON.stringify(report.failure)}\n`);
  process.exitCode = 1;
});
