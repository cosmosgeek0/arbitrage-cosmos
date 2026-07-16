#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const REPORT_RELATIVE = 'verification/product-truth-20260716/C3_LIVE_REMOTE_GATE_REPORT.json';
const REPORT_PATH = resolve(ROOT, REPORT_RELATIVE);
const SCRIPT_RELATIVE = 'verification/product-truth-20260716/run-c3-live-remote-gate.mjs';
const BRANCH = 'truth-campaign-20260716';
const C3 = '78f708d6cdb9d1618c53d3f08f71097b4320a63b';
const C3_TREE = '9e54ae92bd3cc4d30d3114590d7da6d81e019f16';
const PRIOR_EVIDENCE_CHILD = 'ca07f5240b1a656cf3e76fcce9eae6064e3d6934';
const CURRENT_MAIN = '9c8c9f98c7fbd491fb97fce70d723b6c8bed2a4d';
const BUNDLE_PATH = resolve(homedir(), 'cosmos-arbitrage-C3-20260717.bundle');
const BUNDLE_SHA256 = 'd98dc3af075f08bb07d382351ad32d8fa46b564cebf03ace347d625dbea396df';
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

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

const report = {
  schema: 'product-truth-c3-live-remote-custody-gate.v1',
  generated_at_utc: new Date().toISOString(),
  actor_role: 'ACCOUNT_A_CANDIDATE_CUSTODIAN',
  actor_write_permission: 'CAMPAIGN_EVIDENCE_ONLY',
  independent_live_remote_and_bundle_reverification: true,
  final_account_b_verification: false,
  candidate: {
    c3: C3,
    expected_tree: C3_TREE,
    immutable: true,
    starting_evidence_child: PRIOR_EVIDENCE_CHILD,
    expected_starting_branch: BRANCH,
  },
  constraints: {
    current_main_write_authorized: false,
    current_main_push_authorized: false,
    campaign_branch_push_authorized: false,
    remote_mutation_commands_performed: [],
    required_sequence: 'npm ci && npm test && npm run test:all',
  },
  evidence_path: REPORT_RELATIVE,
  bundle: {
    path: BUNDLE_PATH,
    expected_sha256: BUNDLE_SHA256,
    command_ids: [],
    clone_command_ids: [],
    result: 'NOT_RUN',
  },
  preflight: { command_ids: [], result: 'NOT_RUN' },
  environment: { command_ids: [], normalized: null, digest_sha256: null },
  live_remote: {
    before_command_ids: [],
    after_command_ids: [],
    result: 'NOT_RUN',
  },
  live_remote_clone: {
    setup_command_ids: [],
    topology_command_ids: [],
    input_command_ids: [],
    battery_command_ids: [],
    diagnostic_command_ids: [],
    final_command_ids: [],
    result: 'NOT_RUN',
  },
  current_main: {
    local_before: null,
    local_after: null,
    live_remote_before: null,
    live_remote_after: null,
    changed_during_gate: null,
  },
  cleanup_actions: [],
  commands: [],
  command_execution_count: 0,
  all_required_checks_passed: false,
  baseline_token_permitted: false,
  failure: null,
};

function flushReport() {
  report.command_execution_count = report.commands.length;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function capture(command, args, {
  cwd = ROOT,
  kind = 'probe',
  expectedExitCodes = [0],
} = {}) {
  const rendered = commandText(command, args);
  const startedAt = new Date().toISOString();
  process.stderr.write(`[c3-live] START ${rendered}\n`);
  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      LC_ALL: 'C',
      TZ: 'UTC',
      GIT_OPTIONAL_LOCKS: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const heartbeat = setInterval(() => {
    process.stderr.write(`[c3-live] RUNNING ${rendered}\n`);
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
  const outputText = `${stdout.toString('utf8')}\n${stderr.toString('utf8')}`;
  const testEvidence = kind === 'test' ? emittedTestEvidence(outputText) : {
    test_count: 0,
    test_count_basis: 'NOT_A_TEST_COMMAND',
    explicit_test_summaries: [],
    passing_ratio_evidence: [],
    skip_summaries: [],
    unexpected_skip_markers: [],
  };
  const record = {
    command_id: `command-${String(report.commands.length + 1).padStart(3, '0')}`,
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
  report.commands.push(record);
  flushReport();
  process.stderr.write(`[c3-live] END exit=${exitCode} output=${record.output_sha256} ${rendered}\n`);
  return {
    record,
    stdout: stdout.toString('utf8'),
    stderr: stderr.toString('utf8'),
    combinedText: outputText,
  };
}

function addCommand(bucket, result) {
  bucket.push(result.record.command_id);
  flushReport();
  return result;
}

function failClosed(record, causalError) {
  report.failure = {
    command_id: record?.command_id ?? null,
    command: record?.command ?? 'INTERNAL_EVIDENCE_VALIDATION',
    exit_code: record?.exit_code ?? 1,
    first_causal_error: causalError,
    affected_evidence_path: REPORT_RELATIVE,
    observed_at_utc: new Date().toISOString(),
  };
  report.all_required_checks_passed = false;
  report.baseline_token_permitted = false;
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
  const parsed = value.trim();
  if (!FULL_SHA.test(parsed)) failClosed(null, `${label}_INVALID:${parsed}`);
  return parsed;
}

function parseSingleInteger(value, label) {
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) failClosed(null, `${label}_INVALID:${value.trim()}`);
  return parsed;
}

function parseLsRemote(output, ref, label) {
  const matches = output.split(/\r?\n/u).filter(Boolean).map((line) => line.split(/\s+/u))
    .filter((parts) => parts[1] === ref);
  if (matches.length !== 1 || !FULL_SHA.test(matches[0][0] ?? '')) {
    failClosed(null, `${label}_INVALID`);
  }
  return matches[0][0];
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

function hardlinkAudit(clonePath, label) {
  const startedAt = new Date().toISOString();
  const objectRoot = resolve(clonePath, '.git/objects');
  const files = listObjectFiles(objectRoot);
  const linked = files.filter((file) => statSync(file).nlink > 1);
  const maxLinkCount = files.reduce((maximum, file) => Math.max(maximum, statSync(file).nlink), 0);
  const alternatesPath = resolve(objectRoot, 'info/alternates');
  const evidence = {
    label,
    clone_flag: '--no-hardlinks',
    object_files_checked: files.length,
    max_link_count: maxLinkCount,
    hardlinked_object_file_count: linked.length,
    hardlinked_object_files: linked.map((file) => file.slice(clonePath.length + 1)),
    alternates_path: alternatesPath,
    alternates_present: existsSync(alternatesPath),
    passed: files.length > 0 && linked.length === 0 && !existsSync(alternatesPath),
  };
  const row = {
    action: `HARDLINK_AUDIT:${label}`,
    started_at_utc: startedAt,
    ended_at_utc: new Date().toISOString(),
    exit_code: evidence.passed ? 0 : 1,
    test_count: files.length,
    test_count_basis: 'GIT_OBJECT_FILES_INSPECTED',
    evidence,
    evidence_sha256: sha256(Buffer.from(JSON.stringify(evidence))),
  };
  report.cleanup_actions.push(row);
  flushReport();
  if (!evidence.passed) failClosed(null, `${label}_HARDLINK_AUDIT_FAILED`);
  return evidence;
}

function worktreeCount(output) {
  return output.split('\0').filter((field) => field.startsWith('worktree ')).length;
}

const MODE_DIAGNOSTIC = [
  'import { collectDonorEqualityEvidence, evaluateDonorEquality } from "./test/i00/donor-equality.mjs";',
  'const observation = collectDonorEqualityEvidence({ candidateRef: "HEAD" });',
  'const proof = evaluateDonorEquality(observation);',
  'const receiptBound = observation.receiptBound ?? null;',
  'process.stdout.write(`${JSON.stringify({ candidate: proof.candidate, evidence_mode: observation.evidenceMode, counts: proof.counts, status: proof.status, failures: proof.failures, receipt_authority: receiptBound?.authority ?? null, clone_boundary: receiptBound?.cloneBoundary ?? null, unavailable_donor_ids: receiptBound?.unavailableDonorIds ?? [], unavailable_exclusion_ids: receiptBound?.unavailableExclusionIds ?? [] })}\\n`);',
  'if (proof.status !== "PASS") process.exitCode = 1;',
].join(' ');

async function localCurrentMainSnapshot(bucket) {
  const local = addCommand(bucket, await capture('git', ['rev-parse', 'refs/heads/current-main']));
  const cached = addCommand(bucket, await capture('git', ['rev-parse', 'refs/remotes/origin/current-main']));
  requirePassing(local);
  requirePassing(cached);
  return {
    local: parseSingleSha(local.stdout, 'LOCAL_CURRENT_MAIN'),
    cached_origin: parseSingleSha(cached.stdout, 'CACHED_ORIGIN_CURRENT_MAIN'),
  };
}

async function liveRemoteSnapshot(remoteUrl, bucket) {
  const campaign = addCommand(bucket, await capture('git', [
    'ls-remote', '--exit-code', '--heads', remoteUrl, `refs/heads/${BRANCH}`,
  ]));
  const currentMain = addCommand(bucket, await capture('git', [
    'ls-remote', '--exit-code', '--heads', remoteUrl, 'refs/heads/current-main',
  ]));
  requirePassing(campaign);
  requirePassing(currentMain);
  return {
    campaign: parseLsRemote(campaign.stdout, `refs/heads/${BRANCH}`, 'LIVE_CAMPAIGN_REF'),
    current_main: parseLsRemote(currentMain.stdout, 'refs/heads/current-main', 'LIVE_CURRENT_MAIN_REF'),
  };
}

async function verifyBundleClone(bundleClonePath) {
  const bucket = report.bundle.clone_command_ids;
  const head = addCommand(bucket, await capture('git', ['rev-parse', 'HEAD'], { cwd: bundleClonePath }));
  const branch = addCommand(bucket, await capture('git', ['branch', '--show-current'], { cwd: bundleClonePath }));
  const candidate = addCommand(bucket, await capture('git', ['rev-parse', `${C3}^{commit}`], { cwd: bundleClonePath }));
  const tree = addCommand(bucket, await capture('git', ['rev-parse', `${C3}^{tree}`], { cwd: bundleClonePath }));
  const headParent = addCommand(bucket, await capture('git', ['rev-parse', 'HEAD^'], { cwd: bundleClonePath }));
  const ancestor = addCommand(bucket, await capture('git', ['merge-base', '--is-ancestor', C3, 'HEAD'], { cwd: bundleClonePath }));
  const commitPayload = addCommand(bucket, await capture('git', ['cat-file', '-p', C3], { cwd: bundleClonePath }));
  const localRefs = addCommand(bucket, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: bundleClonePath }));
  const remoteRefs = addCommand(bucket, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], { cwd: bundleClonePath }));
  const allRefs = addCommand(bucket, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs'], { cwd: bundleClonePath }));
  const fetchRefspec = addCommand(bucket, await capture('git', ['config', '--get-all', 'remote.origin.fetch'], { cwd: bundleClonePath }));
  const shallow = addCommand(bucket, await capture('git', ['rev-parse', '--is-shallow-repository'], { cwd: bundleClonePath }));
  const worktrees = addCommand(bucket, await capture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: bundleClonePath }));
  const localCurrentMain = addCommand(bucket, await capture('git', ['show-ref', '--verify', '--quiet', 'refs/heads/current-main'], { cwd: bundleClonePath, expectedExitCodes: [1] }));
  const remoteCurrentMain = addCommand(bucket, await capture('git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/current-main'], { cwd: bundleClonePath, expectedExitCodes: [1] }));
  const fsck = addCommand(bucket, await capture('git', ['fsck', '--full', '--strict'], { cwd: bundleClonePath }));
  const clean = addCommand(bucket, await capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: bundleClonePath }));
  for (const result of [head, branch, candidate, tree, headParent, ancestor, commitPayload,
    localRefs, remoteRefs, allRefs, fetchRefspec, shallow, worktrees, localCurrentMain,
    remoteCurrentMain, fsck, clean]) requirePassing(result);

  const localRefList = localRefs.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const remoteRefList = remoteRefs.stdout.trim().split(/\r?\n/u)
    .filter((ref) => ref !== 'refs/remotes/origin/HEAD' && ref !== '');
  const currentMainPresent = allRefs.stdout.split(/\r?\n/u).some((ref) => (
    ref === 'refs/heads/current-main' || ref === 'refs/remotes/origin/current-main'
  ));
  const hardlinks = hardlinkAudit(bundleClonePath, 'BUNDLE_CLONE');
  const valid = head.stdout.trim() === PRIOR_EVIDENCE_CHILD
    && branch.stdout.trim() === BRANCH
    && candidate.stdout.trim() === C3
    && tree.stdout.trim() === C3_TREE
    && headParent.stdout.trim() === C3
    && localRefList.length === 1
    && localRefList[0] === `refs/heads/${BRANCH}`
    && remoteRefList.length === 1
    && remoteRefList[0] === `refs/remotes/origin/${BRANCH}`
    && fetchRefspec.stdout.trim() === `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`
    && shallow.stdout.trim() === 'false'
    && worktreeCount(worktrees.stdout) === 1
    && !currentMainPresent
    && clean.stdout.trim() === ''
    && hardlinks.passed;
  if (!valid) failClosed(head.record, 'BUNDLE_CLONE_EXACT_C3_OR_TOPOLOGY_INVALID');
  report.bundle.clone = {
    initial_head: PRIOR_EVIDENCE_CHILD,
    c3: C3,
    c3_tree: C3_TREE,
    initial_head_parent: C3,
    c3_commit_payload_sha256: commitPayload.record.stdout_sha256,
    local_branch_refs: localRefList,
    remote_tracking_branch_refs: remoteRefList,
    current_main_ref_present: currentMainPresent,
    shallow: false,
    worktree_count: 1,
    hardlink_audit: hardlinks,
    final_clean: true,
  };
  flushReport();
  return commitPayload.record.stdout_sha256;
}

async function verifyLiveClone(liveClonePath, remoteUrl, bundleCommitPayloadSha256) {
  const target = report.live_remote_clone;
  const initialHead = addCommand(target.setup_command_ids, await capture('git', ['rev-parse', 'HEAD'], { cwd: liveClonePath }));
  const initialSymbolic = addCommand(target.setup_command_ids, await capture('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: liveClonePath }));
  const detach = addCommand(target.setup_command_ids, await capture('git', ['checkout', '--detach', C3], { cwd: liveClonePath }));
  for (const result of [initialHead, initialSymbolic, detach]) requirePassing(result);
  if (initialHead.stdout.trim() !== PRIOR_EVIDENCE_CHILD
    || initialSymbolic.stdout.trim() !== `refs/heads/${BRANCH}`) {
    failClosed(initialHead.record, 'LIVE_REMOTE_CLONE_INITIAL_REF_INVALID');
  }

  const head = addCommand(target.topology_command_ids, await capture('git', ['rev-parse', 'HEAD'], { cwd: liveClonePath }));
  const symbolic = addCommand(target.topology_command_ids, await capture('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: liveClonePath, expectedExitCodes: [1] }));
  const candidateType = addCommand(target.topology_command_ids, await capture('git', ['cat-file', '-t', C3], { cwd: liveClonePath }));
  const tree = addCommand(target.topology_command_ids, await capture('git', ['rev-parse', `${C3}^{tree}`], { cwd: liveClonePath }));
  const parent = addCommand(target.topology_command_ids, await capture('git', ['rev-parse', `${C3}^`], { cwd: liveClonePath }));
  const remoteTip = addCommand(target.topology_command_ids, await capture('git', ['rev-parse', `refs/remotes/origin/${BRANCH}`], { cwd: liveClonePath }));
  const remoteTipParent = addCommand(target.topology_command_ids, await capture('git', ['rev-parse', `refs/remotes/origin/${BRANCH}^`], { cwd: liveClonePath }));
  const ancestor = addCommand(target.topology_command_ids, await capture('git', ['merge-base', '--is-ancestor', C3, `refs/remotes/origin/${BRANCH}`], { cwd: liveClonePath }));
  const commitPayload = addCommand(target.topology_command_ids, await capture('git', ['cat-file', '-p', C3], { cwd: liveClonePath }));
  const localRefs = addCommand(target.topology_command_ids, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: liveClonePath }));
  const remoteRefs = addCommand(target.topology_command_ids, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], { cwd: liveClonePath }));
  const allRefs = addCommand(target.topology_command_ids, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs'], { cwd: liveClonePath }));
  const fetchRefspec = addCommand(target.topology_command_ids, await capture('git', ['config', '--get-all', 'remote.origin.fetch'], { cwd: liveClonePath }));
  const cloneRemote = addCommand(target.topology_command_ids, await capture('git', ['remote', 'get-url', 'origin'], { cwd: liveClonePath }));
  const worktrees = addCommand(target.topology_command_ids, await capture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: liveClonePath }));
  const shallow = addCommand(target.topology_command_ids, await capture('git', ['rev-parse', '--is-shallow-repository'], { cwd: liveClonePath }));
  const localCurrentMain = addCommand(target.topology_command_ids, await capture('git', ['show-ref', '--verify', '--quiet', 'refs/heads/current-main'], { cwd: liveClonePath, expectedExitCodes: [1] }));
  const remoteCurrentMain = addCommand(target.topology_command_ids, await capture('git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/current-main'], { cwd: liveClonePath, expectedExitCodes: [1] }));
  const dashboardObject = addCommand(target.topology_command_ids, await capture('git', ['cat-file', '-e', '692501587617d4880303fbd747d93e63c376f088^{commit}'], { cwd: liveClonePath, expectedExitCodes: [128] }));
  const preverifyObject = addCommand(target.topology_command_ids, await capture('git', ['cat-file', '-e', '46b2f1e31edf9f75aec7203e952a56f9869a2971^{commit}'], { cwd: liveClonePath, expectedExitCodes: [128] }));
  const mergeDonorObject = addCommand(target.topology_command_ids, await capture('git', ['cat-file', '-e', 'a0c0c2e5ef3180aa720488463643433cefeb65e5^{commit}'], { cwd: liveClonePath }));
  const fsck = addCommand(target.topology_command_ids, await capture('git', ['fsck', '--full', '--strict'], { cwd: liveClonePath }));
  for (const result of [head, symbolic, candidateType, tree, parent, remoteTip,
    remoteTipParent, ancestor, commitPayload, localRefs, remoteRefs, allRefs,
    fetchRefspec, cloneRemote, worktrees, shallow, localCurrentMain, remoteCurrentMain,
    dashboardObject, preverifyObject, mergeDonorObject, fsck]) requirePassing(result);

  const localRefList = localRefs.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const remoteRefList = remoteRefs.stdout.trim().split(/\r?\n/u)
    .filter((ref) => ref !== 'refs/remotes/origin/HEAD' && ref !== '');
  const currentMainPresent = allRefs.stdout.split(/\r?\n/u).some((ref) => (
    ref === 'refs/heads/current-main' || ref === 'refs/remotes/origin/current-main'
  ));
  const hardlinks = hardlinkAudit(liveClonePath, 'LIVE_REMOTE_CLONE');
  const topologyValid = head.stdout.trim() === C3
    && symbolic.record.exit_code === 1
    && candidateType.stdout.trim() === 'commit'
    && tree.stdout.trim() === C3_TREE
    && FULL_SHA.test(parent.stdout.trim())
    && remoteTip.stdout.trim() === PRIOR_EVIDENCE_CHILD
    && remoteTipParent.stdout.trim() === C3
    && commitPayload.record.stdout_sha256 === bundleCommitPayloadSha256
    && localRefList.length === 1
    && localRefList[0] === `refs/heads/${BRANCH}`
    && remoteRefList.length === 1
    && remoteRefList[0] === `refs/remotes/origin/${BRANCH}`
    && fetchRefspec.stdout.trim() === `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`
    && cloneRemote.stdout.trim() === remoteUrl
    && worktreeCount(worktrees.stdout) === 1
    && shallow.stdout.trim() === 'false'
    && !currentMainPresent
    && localCurrentMain.record.exit_code === 1
    && remoteCurrentMain.record.exit_code === 1
    && dashboardObject.record.exit_code === 128
    && preverifyObject.record.exit_code === 128
    && mergeDonorObject.record.exit_code === 0
    && hardlinks.passed;
  if (!topologyValid) failClosed(head.record, 'LIVE_REMOTE_LITERAL_CLONE_TOPOLOGY_INVALID');

  Object.assign(target, {
    source_transport: 'LIVE_REMOTE_SSH',
    clone_flags: ['--no-hardlinks', '--single-branch', '--branch', BRANCH],
    initial_head: PRIOR_EVIDENCE_CHILD,
    detached_head: C3,
    c3_tree: C3_TREE,
    c3_parent: parent.stdout.trim(),
    remote_tracking_tip: PRIOR_EVIDENCE_CHILD,
    remote_tracking_tip_parent: C3,
    bundle_and_remote_c3_commit_payload_match: true,
    c3_commit_payload_sha256: commitPayload.record.stdout_sha256,
    local_branch_refs: localRefList,
    remote_tracking_branch_refs: remoteRefList,
    current_main_ref_present: currentMainPresent,
    shallow: false,
    worktree_count: 1,
    hardlink_audit: hardlinks,
  });
  flushReport();

  const locks = addCommand(target.input_command_ids, await capture('git', ['ls-files', '*package-lock.json'], { cwd: liveClonePath }));
  const lockDigest = addCommand(target.input_command_ids, await capture('shasum', ['-a', '256', 'package-lock.json'], { cwd: liveClonePath }));
  const lockBlob = addCommand(target.input_command_ids, await capture('git', ['rev-parse', `${C3}:package-lock.json`], { cwd: liveClonePath }));
  for (const result of [locks, lockDigest, lockBlob]) requirePassing(result);
  const lockPaths = locks.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const lockSha = lockDigest.stdout.trim().split(/\s+/u)[0] ?? '';
  if (JSON.stringify(lockPaths) !== JSON.stringify(['package-lock.json']) || !SHA256.test(lockSha)) {
    failClosed(lockDigest.record, 'DEPENDENCY_LOCK_EVIDENCE_INVALID');
  }
  target.dependency_lock = {
    paths: lockPaths,
    package_lock_sha256: lockSha,
    package_lock_git_blob: parseSingleSha(lockBlob.stdout, 'PACKAGE_LOCK_GIT_BLOB'),
  };
  flushReport();

  for (const [command, args, kind] of [
    ['npm', ['ci'], 'install'],
    ['npm', ['test'], 'test'],
    ['npm', ['run', 'test:all'], 'test'],
  ]) {
    const result = addCommand(target.battery_command_ids, await capture(command, args, { cwd: liveClonePath, kind }));
    requirePassing(result, { requireTestEvidence: kind === 'test' });
  }

  const donor = addCommand(target.diagnostic_command_ids, await capture(
    'node', ['--input-type=module', '-e', MODE_DIAGNOSTIC], { cwd: liveClonePath },
  ));
  requirePassing(donor);
  let donorParsed;
  try {
    donorParsed = JSON.parse(donor.stdout);
  } catch {
    failClosed(donor.record, 'LIVE_REMOTE_DONOR_DIAGNOSTIC_JSON_INVALID');
  }
  donor.record.test_count = donorParsed?.counts?.expected ?? null;
  donor.record.test_count_basis = 'DONOR_EQUALITY_EXPECTED_COUNT';
  const donorValid = donorParsed?.candidate?.sha === C3
    && donorParsed?.status === 'PASS'
    && donorParsed?.evidence_mode === 'TRACKED_RECEIPT_SINGLE_BRANCH'
    && JSON.stringify(donorParsed?.counts) === JSON.stringify({
      expected: 16,
      discovered: 16,
      accepted: 16,
      integrated: 16,
    })
    && Array.isArray(donorParsed?.failures)
    && donorParsed.failures.length === 0
    && donorParsed?.clone_boundary?.qualifiesForReceiptBoundMode === true
    && JSON.stringify(donorParsed?.unavailable_donor_ids) === JSON.stringify(['DASHBOARD-SHELL'])
    && JSON.stringify(donorParsed?.unavailable_exclusion_ids) === JSON.stringify(['PREVERIFY']);
  if (!donorValid) failClosed(donor.record, 'LIVE_REMOTE_DONOR_DIAGNOSTIC_INVALID');
  target.donor_equality = donorParsed;

  const finalClean = addCommand(target.final_command_ids, await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: liveClonePath }));
  const finalHead = addCommand(target.final_command_ids, await capture('git', ['rev-parse', 'HEAD'], { cwd: liveClonePath }));
  requirePassing(finalClean);
  requirePassing(finalHead);
  target.final_clean = finalClean.stdout === '';
  target.final_head = finalHead.stdout.trim();
  if (!target.final_clean || target.final_head !== C3) {
    failClosed(finalClean.record, 'LIVE_REMOTE_CLONE_FINAL_STATE_INVALID');
  }
  target.result = 'PASS_EXACT_C3_LIVE_REMOTE_LITERAL_CLEAN_CLONE';
  flushReport();
}

let tempRoot = null;

async function main() {
  flushReport();
  try {
    const branch = addCommand(report.preflight.command_ids, await capture('git', ['branch', '--show-current']));
    const head = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', 'HEAD']));
    const candidateType = addCommand(report.preflight.command_ids, await capture('git', ['cat-file', '-t', C3]));
    const candidateTree = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', `${C3}^{tree}`]));
    const evidenceParent = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', `${PRIOR_EVIDENCE_CHILD}^`]));
    const evidenceDistance = addCommand(report.preflight.command_ids, await capture('git', ['rev-list', '--count', `${C3}..${PRIOR_EVIDENCE_CHILD}`]));
    const evidencePaths = addCommand(report.preflight.command_ids, await capture('git', ['diff', '--name-only', `${C3}..${PRIOR_EVIDENCE_CHILD}`]));
    const status = addCommand(report.preflight.command_ids, await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    const remoteUrlResult = addCommand(report.preflight.command_ids, await capture('git', ['remote', 'get-url', 'origin']));
    for (const result of [branch, head, candidateType, candidateTree, evidenceParent,
      evidenceDistance, evidencePaths, status, remoteUrlResult]) requirePassing(result);

    const dirtyPaths = parseStatusPaths(status.stdout);
    const allowedDirtyPaths = [REPORT_RELATIVE, SCRIPT_RELATIVE].sort();
    const evidenceOnlyPaths = evidencePaths.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const remoteUrl = remoteUrlResult.stdout.trim();
    const preflightValid = branch.stdout.trim() === BRANCH
      && head.stdout.trim() === PRIOR_EVIDENCE_CHILD
      && candidateType.stdout.trim() === 'commit'
      && candidateTree.stdout.trim() === C3_TREE
      && evidenceParent.stdout.trim() === C3
      && parseSingleInteger(evidenceDistance.stdout, 'EVIDENCE_DISTANCE') === 1
      && evidenceOnlyPaths.length > 0
      && evidenceOnlyPaths.every((pathValue) => pathValue.startsWith('verification/product-truth-20260716/'))
      && JSON.stringify(dirtyPaths) === JSON.stringify(allowedDirtyPaths)
      && remoteUrl.length > 0
      && !/https?:\/\/[^/@]+@/iu.test(remoteUrl);
    if (!preflightValid) failClosed(head.record, 'SOURCE_PREFLIGHT_INVALID');
    report.preflight.result = 'PASS_EVIDENCE_ONLY_STARTING_CHILD';
    report.preflight.dirty_paths = dirtyPaths;
    report.preflight.prior_evidence_paths = evidenceOnlyPaths;
    report.preflight.remote_url = remoteUrl;
    report.current_main.local_before = await localCurrentMainSnapshot(report.preflight.command_ids);
    if (report.current_main.local_before.local !== CURRENT_MAIN
      || report.current_main.local_before.cached_origin !== CURRENT_MAIN) {
      failClosed(null, 'CURRENT_MAIN_LOCAL_OR_CACHED_ORIGIN_DRIFT_BEFORE_GATE');
    }

    const gitVersion = addCommand(report.environment.command_ids, await capture('git', ['--version']));
    const nodeVersion = addCommand(report.environment.command_ids, await capture('node', ['--version']));
    const npmVersion = addCommand(report.environment.command_ids, await capture('npm', ['--version']));
    const osVersion = addCommand(report.environment.command_ids, await capture('sw_vers', ['-productVersion']));
    const architecture = addCommand(report.environment.command_ids, await capture('uname', ['-m']));
    for (const result of [gitVersion, nodeVersion, npmVersion, osVersion, architecture]) requirePassing(result);
    report.environment.normalized = {
      git: gitVersion.stdout.trim(),
      node: nodeVersion.stdout.trim(),
      npm: npmVersion.stdout.trim(),
      macos: osVersion.stdout.trim(),
      architecture: architecture.stdout.trim(),
    };
    report.environment.digest_sha256 = sha256(Buffer.from(JSON.stringify(report.environment.normalized)));
    flushReport();

    const liveBefore = await liveRemoteSnapshot(remoteUrl, report.live_remote.before_command_ids);
    report.live_remote.before = liveBefore;
    report.current_main.live_remote_before = liveBefore.current_main;
    if (liveBefore.campaign !== PRIOR_EVIDENCE_CHILD || liveBefore.current_main !== CURRENT_MAIN) {
      failClosed(null, 'LIVE_REMOTE_REF_MISMATCH_BEFORE_GATE');
    }

    if (!existsSync(BUNDLE_PATH)) failClosed(null, `BUNDLE_MISSING:${BUNDLE_PATH}`);
    const bundleDigest = addCommand(report.bundle.command_ids, await capture('shasum', ['-a', '256', BUNDLE_PATH]));
    const bundleStat = addCommand(report.bundle.command_ids, await capture('stat', ['-f', '%z', BUNDLE_PATH]));
    const bundleVerify = addCommand(report.bundle.command_ids, await capture('git', ['bundle', 'verify', BUNDLE_PATH]));
    const bundleHeads = addCommand(report.bundle.command_ids, await capture('git', [
      'bundle', 'list-heads', BUNDLE_PATH,
      `refs/heads/${BRANCH}`,
      'refs/heads/current-main',
    ]));
    for (const result of [bundleDigest, bundleStat, bundleVerify, bundleHeads]) requirePassing(result);
    const observedBundleSha = bundleDigest.stdout.trim().split(/\s+/u)[0] ?? '';
    const bundleCampaign = parseLsRemote(bundleHeads.stdout, `refs/heads/${BRANCH}`, 'BUNDLE_CAMPAIGN_REF');
    const bundleCurrentMain = parseLsRemote(bundleHeads.stdout, 'refs/heads/current-main', 'BUNDLE_CURRENT_MAIN_REF');
    const bundleComplete = /records a complete history/iu.test(bundleVerify.combinedText);
    if (observedBundleSha !== BUNDLE_SHA256
      || bundleCampaign !== PRIOR_EVIDENCE_CHILD
      || bundleCurrentMain !== CURRENT_MAIN
      || !bundleComplete) {
      failClosed(bundleDigest.record, 'BUNDLE_DIGEST_OR_REF_OR_COMPLETENESS_INVALID');
    }
    Object.assign(report.bundle, {
      observed_sha256: observedBundleSha,
      byte_length: parseSingleInteger(bundleStat.stdout, 'BUNDLE_BYTE_LENGTH'),
      complete_history: true,
      campaign_head: bundleCampaign,
      current_main_head: bundleCurrentMain,
    });
    flushReport();

    tempRoot = mkdtempSync(join(tmpdir(), 'truth-a-c3-live-custody-'));
    const bundleClonePath = resolve(tempRoot, 'bundle-clone');
    const liveClonePath = resolve(tempRoot, 'live-remote-clone');
    const bundleClone = addCommand(report.bundle.clone_command_ids, await capture('git', [
      'clone', '--no-hardlinks', '--single-branch', '--branch', BRANCH, BUNDLE_PATH, bundleClonePath,
    ]));
    requirePassing(bundleClone);
    const bundleCommitPayloadSha256 = await verifyBundleClone(bundleClonePath);
    report.bundle.result = 'PASS_DIGEST_COMPLETE_HISTORY_EXACT_C3_INDEPENDENT_CLONE';
    flushReport();

    const liveClone = addCommand(report.live_remote_clone.setup_command_ids, await capture('git', [
      'clone', '--no-hardlinks', '--single-branch', '--branch', BRANCH, remoteUrl, liveClonePath,
    ]));
    requirePassing(liveClone);
    await verifyLiveClone(liveClonePath, remoteUrl, bundleCommitPayloadSha256);

    const liveAfter = await liveRemoteSnapshot(remoteUrl, report.live_remote.after_command_ids);
    report.live_remote.after = liveAfter;
    report.current_main.live_remote_after = liveAfter.current_main;
    if (JSON.stringify(liveAfter) !== JSON.stringify(liveBefore)) {
      failClosed(null, 'LIVE_REMOTE_REFS_CHANGED_DURING_GATE');
    }
    report.live_remote.result = 'PASS_LIVE_REF_STABLE_C3_REACHABLE_THROUGH_EVIDENCE_CHILD';

    report.current_main.local_after = await localCurrentMainSnapshot(report.preflight.command_ids);
    report.current_main.changed_during_gate = JSON.stringify(report.current_main.local_before)
      !== JSON.stringify(report.current_main.local_after)
      || report.current_main.live_remote_before !== report.current_main.live_remote_after;
    if (report.current_main.changed_during_gate) failClosed(null, 'CURRENT_MAIN_CHANGED_DURING_GATE');

    const finalHead = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', 'HEAD']));
    const finalStatus = addCommand(report.preflight.command_ids, await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    requirePassing(finalHead);
    requirePassing(finalStatus);
    if (finalHead.stdout.trim() !== PRIOR_EVIDENCE_CHILD
      || JSON.stringify(parseStatusPaths(finalStatus.stdout)) !== JSON.stringify(allowedDirtyPaths)) {
      failClosed(finalStatus.record, 'SOURCE_WORKTREE_CHANGED_OUTSIDE_EVIDENCE_OUTPUTS');
    }

    report.all_required_checks_passed = report.preflight.result === 'PASS_EVIDENCE_ONLY_STARTING_CHILD'
      && report.bundle.result === 'PASS_DIGEST_COMPLETE_HISTORY_EXACT_C3_INDEPENDENT_CLONE'
      && report.live_remote.result === 'PASS_LIVE_REF_STABLE_C3_REACHABLE_THROUGH_EVIDENCE_CHILD'
      && report.live_remote_clone.result === 'PASS_EXACT_C3_LIVE_REMOTE_LITERAL_CLEAN_CLONE'
      && report.live_remote_clone.final_clean === true
      && report.live_remote_clone.current_main_ref_present === false
      && report.current_main.changed_during_gate === false
      && report.failure === null;
    report.baseline_token_permitted = report.all_required_checks_passed;
    if (!report.all_required_checks_passed) failClosed(null, 'C3_LIVE_REMOTE_GATE_AGGREGATE_FALSE');
    report.completed_at_utc = new Date().toISOString();
    flushReport();
  } finally {
    if (tempRoot !== null && existsSync(tempRoot)) {
      const startedAt = new Date().toISOString();
      rmSync(tempRoot, { recursive: true, force: true });
      const evidence = { path: tempRoot, removed: !existsSync(tempRoot) };
      report.cleanup_actions.push({
        action: 'REMOVE_TEMPORARY_BUNDLE_AND_LIVE_REMOTE_CLONES',
        started_at_utc: startedAt,
        ended_at_utc: new Date().toISOString(),
        exit_code: evidence.removed ? 0 : 1,
        test_count: 0,
        evidence,
        evidence_sha256: sha256(Buffer.from(JSON.stringify(evidence))),
      });
      flushReport();
      if (!evidence.removed && report.failure === null) {
        failClosed(null, 'TEMPORARY_CLONE_CLEANUP_FAILED');
      }
    }
  }
  process.stdout.write(`${JSON.stringify({
    c3: C3,
    live_remote: report.live_remote.result,
    bundle: report.bundle.result,
    literal_clean_clone: report.live_remote_clone.result,
    npm_test_count: report.commands.find((row) => row.command === 'npm test')?.test_count ?? null,
    npm_test_all_count: report.commands.find((row) => row.command === 'npm run test:all')?.test_count ?? null,
    report: REPORT_RELATIVE,
    gate: `BASELINE_TRUTH_ACCEPTED:${C3}`,
  })}\n`);
}

main().catch((error) => {
  if (report.failure === null) {
    report.failure = {
      command_id: null,
      command: 'INTERNAL_EVIDENCE_VALIDATION',
      exit_code: 1,
      first_causal_error: error instanceof Error ? error.message : String(error),
      affected_evidence_path: REPORT_RELATIVE,
      observed_at_utc: new Date().toISOString(),
    };
    report.all_required_checks_passed = false;
    report.baseline_token_permitted = false;
    flushReport();
  }
  process.stderr.write(`[c3-live] PRECISE_BLOCKED ${JSON.stringify(report.failure)}\n`);
  process.exitCode = 1;
});
